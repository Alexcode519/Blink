import { pool } from '../db/pool.js'
import { sendPushNotification } from '../firebase.js'

export async function messageRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    try { await req.jwtVerify() }
    catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  // Send an encrypted message to a recipient
  app.post('/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['recipientUsername', 'ciphertext', 'nonce', 'contentType'],
        properties: {
          recipientUsername: { type: 'string' },
          ciphertext:        { type: 'string' },
          nonce:             { type: 'string' },
          contentType:       { type: 'string', enum: ['text', 'image', 'video', 'document'] },
        },
      },
    },
  }, async (req, reply) => {
    const { recipientUsername, ciphertext, nonce, contentType } = req.body
    const { rows: recipients } = await pool.query(
      'SELECT id, fcm_token FROM users WHERE username = $1',
      [recipientUsername.toLowerCase()]
    )
    if (!recipients.length) return reply.code(404).send({ error: 'Recipient not found' })

    const recipient = recipients[0]
    const { rows: senders } = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.userId]
    )

    const { rows } = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, ciphertext, nonce, content_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [req.user.userId, recipient.id, ciphertext, nonce, contentType]
    )

    // Send push notification to recipient if they have a token
    const typeLabel = contentType === 'text' ? 'message' : contentType
    await sendPushNotification(
      recipient.fcm_token,
      senders[0]?.username ?? 'Someone',
      contentType === 'text' ? 'Sent you a message' : `Sent you a ${typeLabel}`,
      { type: 'new_message', senderUsername: senders[0]?.username ?? '' }
    )

    return { messageId: rows[0].id, createdAt: rows[0].created_at }
  })

  // Get recent conversations (distinct users this user has chatted with)
  app.get('/messages/conversations', async (req) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (other_user)
        other_user,
        other_username,
        other_public_key,
        last_at
       FROM (
         SELECT
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_user,
           CASE WHEN m.sender_id = $1 THEN ru.username ELSE su.username END AS other_username,
           CASE WHEN m.sender_id = $1 THEN ru.public_key ELSE su.public_key END AS other_public_key,
           m.created_at AS last_at
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN users ru ON ru.id = m.recipient_id
         WHERE m.sender_id = $1 OR m.recipient_id = $1
       ) t
       ORDER BY other_user, last_at DESC`,
      [req.user.userId]
    )
    return { conversations: rows }
  })

  // Get full message history between current user and another user
  app.get('/messages/history/:username', async (req, reply) => {
    const { rows: other } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!other.length) return reply.code(404).send({ error: 'User not found' })
    const otherId = other[0].id

    const { rows } = await pool.query(
      `SELECT m.id, su.username AS senderUsername, m.ciphertext, m.nonce, m.content_type, m.created_at
       FROM messages m
       JOIN users su ON su.id = m.sender_id
       WHERE (m.sender_id = $1 AND m.recipient_id = $2)
          OR (m.sender_id = $2 AND m.recipient_id = $1)
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.userId, otherId]
    )
    return { messages: rows }
  })

  // Poll for undelivered messages — returns them and marks as delivered
  app.get('/messages/inbox', async (req) => {
    const { rows } = await pool.query(
      `SELECT m.id, u.username AS senderUsername, m.ciphertext, m.nonce, m.content_type, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.recipient_id = $1 AND m.delivered = FALSE
       ORDER BY m.created_at ASC`,
      [req.user.userId]
    )

    if (rows.length) {
      const ids = rows.map(r => r.id)
      await pool.query(
        'UPDATE messages SET delivered = TRUE WHERE id = ANY($1::uuid[])',
        [ids]
      )
    }

    return { messages: rows }
  })

  // Recipient requests permission to save a message
  app.post('/messages/:messageId/save-request', async (req, reply) => {
    const { rows: msgs } = await pool.query(
      'SELECT m.id, m.recipient_id, m.sender_id, u.fcm_token, r.username AS recipientUsername FROM messages m JOIN users u ON u.id = m.sender_id JOIN users r ON r.id = m.recipient_id WHERE m.id = $1',
      [req.params.messageId]
    )
    if (!msgs.length) return reply.code(404).send({ error: 'Message not found' })
    if (msgs[0].recipient_id !== req.user.userId) return reply.code(403).send({ error: 'Forbidden' })

    const { rows } = await pool.query(
      `INSERT INTO save_requests (message_id) VALUES ($1)
       ON CONFLICT DO NOTHING RETURNING id`,
      [req.params.messageId]
    )

    // Notify sender someone wants to save their content
    await sendPushNotification(
      msgs[0].fcm_token,
      'Save request',
      `${msgs[0].recipientUsername} wants to save something you sent`,
      { type: 'save_request' }
    )

    return { requestId: rows[0]?.id }
  })

  // Sender polls for pending save requests on their sent messages
  app.get('/messages/save-requests/pending', async (req) => {
    const { rows } = await pool.query(
      `SELECT sr.id, sr.message_id, u.username AS requesterUsername, m.content_type
       FROM save_requests sr
       JOIN messages m ON m.id = sr.message_id
       JOIN users u ON u.id = m.recipient_id
       WHERE m.sender_id = $1 AND sr.status = 'pending'`,
      [req.user.userId]
    )
    return { requests: rows }
  })

  // Sender approves or denies a save request
  app.patch('/messages/save-requests/:requestId', {
    schema: {
      body: {
        type: 'object',
        required: ['decision'],
        properties: { decision: { type: 'string', enum: ['approved', 'denied'] } },
      },
    },
  }, async (req, reply) => {
    const { rows } = await pool.query(
      `UPDATE save_requests sr SET status = $1
       FROM messages m JOIN users u ON u.id = m.recipient_id
       WHERE sr.id = $2 AND sr.message_id = m.id AND m.sender_id = $3
       RETURNING sr.id, u.fcm_token, u.username AS recipientUsername`,
      [req.body.decision, req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Request not found' })

    // Notify recipient of the decision
    const label = req.body.decision === 'approved' ? 'approved ✓' : 'denied'
    await sendPushNotification(
      rows[0].fcm_token,
      'Save request ' + label,
      req.body.decision === 'approved'
        ? 'Your save request was approved'
        : 'Your save request was denied',
      { type: 'save_decision', decision: req.body.decision }
    )

    return { status: req.body.decision }
  })

  // Recipient polls for the outcome of their save request
  app.get('/messages/save-requests/:requestId/status', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT sr.status FROM save_requests sr
       JOIN messages m ON m.id = sr.message_id
       WHERE sr.id = $1 AND m.recipient_id = $2`,
      [req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })
    return { status: rows[0].status }
  })
}
