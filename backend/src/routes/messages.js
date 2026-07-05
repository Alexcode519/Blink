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
          recipientUsername:      { type: 'string' },
          ciphertext:             { type: 'string' },
          nonce:                  { type: 'string' },
          contentType:            { type: 'string', enum: ['text', 'image', 'video', 'document', 'audio'] },
          viewOnce:               { type: 'boolean' },
          replyToId:              { type: 'string', nullable: true },
          replyPreviewCiphertext: { type: 'string', nullable: true },
          replyPreviewNonce:      { type: 'string', nullable: true },
          replySender:            { type: 'string', nullable: true },
        },
      },
    },
  }, async (req, reply) => {
    const {
      recipientUsername, ciphertext, nonce, contentType, viewOnce,
      replyToId, replyPreviewCiphertext, replyPreviewNonce, replySender,
    } = req.body
    const { rows: recipients } = await pool.query(
      'SELECT id, fcm_token FROM users WHERE username = $1',
      [recipientUsername.toLowerCase()]
    )
    if (!recipients.length) return reply.code(404).send({ error: 'Recipient not found' })

    const recipient = recipients[0]

    // Check if recipient has blocked sender
    const { rows: blockCheck } = await pool.query(
      'SELECT 1 FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
      [recipient.id, req.user.userId]
    )
    if (blockCheck.length) return reply.code(403).send({ error: 'Message could not be delivered' })
    const { rows: senders } = await pool.query(
      'SELECT username, fcm_token FROM users WHERE id = $1',
      [req.user.userId]
    )

    const { rows } = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, ciphertext, nonce, content_type, view_once, reply_to_id, reply_preview_ciphertext, reply_preview_nonce, reply_sender)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at`,
      [req.user.userId, recipient.id, ciphertext, nonce, contentType, viewOnce ?? false, replyToId ?? null, replyPreviewCiphertext ?? null, replyPreviewNonce ?? null, replySender ?? null]
    )

    // Sending a message implicitly accepts that contact from the sender's
    // side — clears the "message request" pending state if they reply.
    await pool.query(
      `INSERT INTO accepted_contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.userId, recipient.id]
    )

    // Send push notification to recipient — skip if their token matches the sender's
    // (stale token in DB would cause sender to receive their own notification)
    const typeLabel = { text: 'message', image: 'image', video: 'video', document: 'document', audio: 'voice note' }[contentType] ?? contentType
    const recipientToken = (recipient.fcm_token && recipient.fcm_token !== senders[0]?.fcm_token) ? recipient.fcm_token : null
    await sendPushNotification(
      recipientToken,
      senders[0]?.username ?? 'Someone',
      contentType === 'text' ? 'Sent you a message' : `Sent you a ${typeLabel}`,
      { type: 'new_message', senderUsername: senders[0]?.username ?? '', recipientUsername: recipientUsername.toLowerCase(), messageId: rows[0].id, contentType, viewOnce: String(viewOnce ?? false) }
    )

    return { messageId: rows[0].id, createdAt: rows[0].created_at }
  })

  // Get recent conversations (distinct users this user has chatted with)
  app.get('/messages/conversations', async (req, reply) => {
    try {
      const uid = req.user.userId

      // Query 1: users this person has exchanged messages with
      const { rows: msgRows } = await pool.query(
        `SELECT DISTINCT ON (other_user)
           CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS other_user,
           CASE WHEN m.sender_id = $1 THEN ru.username ELSE su.username END AS other_username,
           CASE WHEN m.sender_id = $1 THEN ru.public_key ELSE su.public_key END AS other_public_key,
           CASE WHEN m.sender_id = $1 THEN ru.avatar ELSE su.avatar END AS other_avatar,
           m.created_at AS last_at
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN users ru ON ru.id = m.recipient_id
         WHERE m.sender_id = $1 OR m.recipient_id = $1
         ORDER BY other_user, m.created_at DESC`,
        [uid]
      )

      // Query 1b: blocked users (exclude from conversations)
      const { rows: blockedRows } = await pool.query(
        `SELECT blocked_id FROM blocked_users WHERE blocker_id = $1`,
        [uid]
      )
      const blockedSet = new Set(blockedRows.map(r => r.blocked_id))

      // Query 2: unread counts per sender
      const { rows: unreadRows } = await pool.query(
        `SELECT sender_id AS other_user, COUNT(*)::int AS cnt
         FROM messages
         WHERE recipient_id = $1 AND read_at IS NULL
         GROUP BY sender_id`,
        [uid]
      )
      const unreadMap = {}
      for (const r of unreadRows) unreadMap[r.other_user] = r.cnt

      // Query 3: accepted contacts (to mark requested=false and include contacts with no messages)
      const { rows: contactRows } = await pool.query(
        `SELECT ac.contact_id, u2.username, u2.public_key, u2.avatar, ac.created_at
         FROM accepted_contacts ac
         JOIN users u2 ON u2.id = ac.contact_id
         WHERE ac.user_id = $1`,
        [uid]
      )
      const contactSet = new Set(contactRows.map(r => r.contact_id))

      // Query 4: check if requester (message sender who isn't a contact) has pending request
      const { rows: reqRows } = await pool.query(
        `SELECT DISTINCT sender_id FROM messages
         WHERE recipient_id = $1
           AND sender_id NOT IN (
             SELECT contact_id FROM accepted_contacts WHERE user_id = $1
           )`,
        [uid]
      )
      const requestedSet = new Set(reqRows.map(r => r.sender_id))

      // Build conversation list from messages (exclude blocked)
      const messagedIds = new Set()
      const conversations = msgRows.filter(row => !blockedSet.has(row.other_user)).map(row => {
        messagedIds.add(row.other_user)
        return {
          other_user: row.other_user,
          other_username: row.other_username,
          other_public_key: row.other_public_key,
          other_avatar: row.other_avatar,
          last_at: row.last_at,
          unread_count: unreadMap[row.other_user] ?? 0,
          requested: requestedSet.has(row.other_user),
        }
      })

      // Add accepted contacts with no messages (exclude blocked)
      for (const c of contactRows) {
        if (!messagedIds.has(c.contact_id) && !blockedSet.has(c.contact_id)) {
          conversations.push({
            other_user: c.contact_id,
            other_username: c.username,
            other_public_key: c.public_key,
            other_avatar: c.avatar,
            last_at: c.created_at,
            unread_count: 0,
            requested: false,
          })
        }
      }

      // Sort by most recent first
      conversations.sort((a, b) => new Date(b.last_at) - new Date(a.last_at))

      return { conversations }
    } catch (e) {
      console.error('[conversations] error:', e.message, '| userId:', req.user.userId)
      return reply.code(500).send({ error: e.message })
    }
  })

  // Receive messages that arrived via BLE mesh relay and bridge them into the
  // normal server-backed message store. The relaying device (req.user) passes
  // the original sender's username and recipient's username so we can resolve
  // their UUIDs and store the message exactly like a normal send.
  app.post('/messages/mesh-relay', {
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'senderUsername', 'recipientUsername', 'ciphertext', 'nonce', 'contentType'],
              properties: {
                id:               { type: 'string' },
                senderUsername:   { type: 'string' },
                recipientUsername:{ type: 'string' },
                ciphertext:       { type: 'string' },
                nonce:            { type: 'string' },
                contentType:      { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const results = []
    for (const msg of req.body.messages) {
      try {
        const { rows: sRows } = await pool.query('SELECT id FROM users WHERE username = $1', [msg.senderUsername.toLowerCase()])
        const { rows: rRows } = await pool.query('SELECT id, fcm_token FROM users WHERE username = $1', [msg.recipientUsername.toLowerCase()])
        if (!sRows.length || !rRows.length) { results.push({ id: msg.id, ok: false, error: 'user not found' }); continue }

        await pool.query(
          `INSERT INTO messages (id, sender_id, recipient_id, ciphertext, nonce, content_type)
           VALUES ($1::uuid, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [msg.id, sRows[0].id, rRows[0].id, msg.ciphertext, msg.nonce, msg.contentType]
        )
        await pool.query('INSERT INTO accepted_contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sRows[0].id, rRows[0].id])
        if (rRows[0].fcm_token) {
          await sendPushNotification(rRows[0].fcm_token, msg.senderUsername, 'Sent you a message (via mesh relay)', { type: 'new_message', senderUsername: msg.senderUsername })
        }
        results.push({ id: msg.id, ok: true })
      } catch (e) {
        results.push({ id: msg.id, ok: false, error: e.message })
      }
    }
    return { results }
  })

  // Whether this contact is still a pending "message request" for the current user
  app.get('/messages/requests/:username/status', async (req, reply) => {
    const { rows: other } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!other.length) return reply.code(404).send({ error: 'User not found' })
    const { rows } = await pool.query(
      `SELECT 1 FROM messages
       WHERE sender_id = $2 AND recipient_id = $1
       AND NOT EXISTS (SELECT 1 FROM accepted_contacts WHERE user_id = $1 AND contact_id = $2)
       LIMIT 1`,
      [req.user.userId, other[0].id]
    )
    return { requested: rows.length > 0 }
  })

  // Explicitly accept a message request without having to reply first
  app.post('/messages/requests/:username/accept', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const { rows: other } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!other.length) return reply.code(404).send({ error: 'User not found' })
    await pool.query(
      'INSERT INTO accepted_contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.userId, other[0].id]
    )
    return { ok: true }
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
      `SELECT m.id, su.username AS senderUsername,
              CASE WHEN m.view_once AND m.viewed_at IS NOT NULL THEN NULL ELSE m.ciphertext END AS ciphertext,
              CASE WHEN m.view_once AND m.viewed_at IS NOT NULL THEN NULL ELSE m.nonce END AS nonce,
              m.content_type, m.created_at, m.view_once, m.viewed_at, m.burn_at,
              m.reply_to_id, m.reply_preview_ciphertext, m.reply_preview_nonce, m.reply_sender,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', mr.ciphertext, 'nonce', mr.nonce)), '[]')
                 FROM message_reactions mr JOIN users ru ON ru.id = mr.user_id WHERE mr.message_id = m.id) AS reactions
       FROM messages m
       JOIN users su ON su.id = m.sender_id
       WHERE (m.sender_id = $1 AND m.recipient_id = $2)
          OR (m.sender_id = $2 AND m.recipient_id = $1)
         AND (m.burn_at IS NULL OR m.burn_at > NOW())
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.userId, otherId]
    )
    // Mark all messages from the other user as read
    pool.query(
      `UPDATE messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [otherId, req.user.userId]
    ).catch(() => {})
    return { messages: rows }
  })

  // Poll for undelivered messages — returns them and marks as delivered
  app.get('/messages/inbox', async (req) => {
    const { rows } = await pool.query(
      `SELECT m.id, u.username AS senderUsername,
              CASE WHEN m.view_once AND m.viewed_at IS NOT NULL THEN NULL ELSE m.ciphertext END AS ciphertext,
              CASE WHEN m.view_once AND m.viewed_at IS NOT NULL THEN NULL ELSE m.nonce END AS nonce,
              m.content_type, m.created_at, m.view_once, m.viewed_at, m.burn_at,
              m.reply_to_id, m.reply_preview_ciphertext, m.reply_preview_nonce, m.reply_sender,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', mr.ciphertext, 'nonce', mr.nonce)), '[]')
                 FROM message_reactions mr JOIN users ru ON ru.id = mr.user_id WHERE mr.message_id = m.id) AS reactions
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.recipient_id = $1 AND m.delivered = FALSE
         AND (m.burn_at IS NULL OR m.burn_at > NOW())
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
      { type: 'save_request', requesterUsername: msgs[0].recipientUsername }
    )

    return { requestId: rows[0]?.id }
  })

  // Sender polls for pending save requests on their sent messages
  app.get('/messages/save-requests/pending', async (req) => {
    const { rows } = await pool.query(
      `SELECT sr.id, sr.message_id, u.username AS "requesterUsername", m.content_type
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
        properties: {
          decision:    { type: 'string', enum: ['approved', 'denied'] },
          expiresHours: { type: 'number', nullable: true },
        },
      },
    },
  }, async (req, reply) => {
    const { decision, expiresHours } = req.body
    const expiresAt = decision === 'approved' && expiresHours
      ? new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString()
      : null

    const { rows } = await pool.query(
      `UPDATE save_requests sr SET status = $1, expires_at = $4
       FROM messages m JOIN users u ON u.id = m.recipient_id
       WHERE sr.id = $2 AND sr.message_id = m.id AND m.sender_id = $3
       RETURNING sr.id, u.fcm_token, u.username AS recipientUsername`,
      [decision, req.params.requestId, req.user.userId, expiresAt]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Request not found' })

    const label = decision === 'approved' ? 'approved ✓' : 'denied'
    const bodyText = decision === 'approved'
      ? expiresHours
        ? `Your save request was approved — expires in ${expiresHours}h`
        : 'Your save request was approved'
      : 'Your save request was denied'

    await sendPushNotification(
      rows[0].fcm_token,
      'Save request ' + label,
      bodyText,
      { type: 'save_decision', decision, expiresAt: expiresAt ?? '' }
    )

    return { status: decision, expiresAt }
  })

  // Recipient marks all messages from a sender as read
  app.post('/messages/read/:senderUsername', async (req, reply) => {
    const { rows: sender } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.senderUsername.toLowerCase()]
    )
    if (!sender.length) return reply.code(404).send({ error: 'User not found' })
    await pool.query(
      `UPDATE messages SET read_at = NOW()
       WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
      [sender[0].id, req.user.userId]
    )
    return { ok: true }
  })

  // Sender checks which of their sent messages have been read
  app.get('/messages/read-receipts/:recipientUsername', async (req, reply) => {
    const { rows: recipient } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.recipientUsername.toLowerCase()]
    )
    if (!recipient.length) return reply.code(404).send({ error: 'User not found' })
    const { rows } = await pool.query(
      `SELECT id FROM messages
       WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NOT NULL`,
      [req.user.userId, recipient[0].id]
    )
    return { readIds: rows.map(r => r.id) }
  })

  // Set (or replace) the current user's reaction on a message
  app.put('/messages/:messageId/reaction', {
    schema: {
      body: {
        type: 'object',
        required: ['ciphertext', 'nonce'],
        properties: {
          ciphertext: { type: 'string' },
          nonce:      { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { messageId } = req.params
    const { ciphertext, nonce } = req.body
    const { rows: msg } = await pool.query(
      'SELECT 1 FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)',
      [messageId, req.user.userId]
    )
    if (!msg.length) return reply.code(404).send({ error: 'Message not found' })
    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, ciphertext, nonce)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO UPDATE SET ciphertext = $3, nonce = $4, created_at = NOW()`,
      [messageId, req.user.userId, ciphertext, nonce]
    )
    return { ok: true }
  })

  // Remove the current user's reaction on a message
  app.delete('/messages/:messageId/reaction', async (req, reply) => {
    await pool.query(
      'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
      [req.params.messageId, req.user.userId]
    )
    return { ok: true }
  })

  // Poll for reaction changes across an entire conversation
  app.get('/messages/reactions/:username', async (req, reply) => {
    const { rows: other } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!other.length) return reply.code(404).send({ error: 'User not found' })
    const otherId = other[0].id
    const { rows } = await pool.query(
      `SELECT m.id AS message_id,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', mr.ciphertext, 'nonce', mr.nonce)), '[]')
                 FROM message_reactions mr JOIN users ru ON ru.id = mr.user_id WHERE mr.message_id = m.id) AS reactions
       FROM messages m
       WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
         AND EXISTS (SELECT 1 FROM message_reactions mr2 WHERE mr2.message_id = m.id)`,
      [req.user.userId, otherId]
    )
    return { reactions: rows }
  })

  // Delete a single sent message (sender only)
  app.delete('/messages/:messageId', async (req, reply) => {
    const { rows } = await pool.query(
      `DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id`,
      [req.params.messageId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Message not found or not yours' })
    return { ok: true }
  })

  // Delete all messages between current user and another user (for this user only)
  app.delete('/messages/conversation/:username', async (req, reply) => {
    try {
      const { rows: other } = await pool.query(
        'SELECT id FROM users WHERE username = $1',
        [req.params.username.toLowerCase()]
      )
      if (!other.length) return reply.code(404).send({ error: 'User not found' })
      const otherId = other[0].id

      // Delete save_requests first (FK constraint), then messages
      await pool.query(
        `DELETE FROM save_requests WHERE message_id IN (
          SELECT id FROM messages
          WHERE (sender_id = $1 AND recipient_id = $2)
             OR (sender_id = $2 AND recipient_id = $1)
        )`,
        [req.user.userId, otherId]
      )
      const { rowCount } = await pool.query(
        `DELETE FROM messages
         WHERE (sender_id = $1 AND recipient_id = $2)
            OR (sender_id = $2 AND recipient_id = $1)`,
        [req.user.userId, otherId]
      )
      await pool.query(
        `DELETE FROM accepted_contacts WHERE user_id = $1 AND contact_id = $2`,
        [req.user.userId, otherId]
      )
      return { ok: true, deleted: rowCount }
    } catch (e) {
      console.error('[delete conversation] error:', e.message)
      return reply.code(500).send({ error: e.message })
    }
  })

  // Recipient requests a time extension on a saved library item
  app.post('/messages/extend-requests', {
    schema: {
      body: {
        type: 'object',
        required: ['libraryItemId', 'senderUsername'],
        properties: {
          libraryItemId: { type: 'string' },
          senderUsername: { type: 'string' },
          messageId: { type: 'string', nullable: true },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const { libraryItemId, senderUsername, messageId } = req.body
      const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [senderUsername.toLowerCase()])
      if (!rows.length) return reply.code(404).send({ error: 'Sender not found' })
      const senderId = rows[0].id
      // Check no pending request already
      const { rows: existing } = await pool.query(
        `SELECT id FROM extend_requests WHERE library_item_id = $1 AND requester_id = $2 AND status = 'pending'`,
        [libraryItemId, req.user.userId]
      )
      if (existing.length) return reply.code(409).send({ error: 'Request already pending' })
      const { rows: inserted } = await pool.query(
        `INSERT INTO extend_requests (library_item_id, message_id, requester_id, sender_id)
         VALUES ($1, $2::uuid, $3, $4) RETURNING id`,
        [libraryItemId, messageId ?? null, req.user.userId, senderId]
      )
      // Notify sender via push
      const { rows: senderRow } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [senderId])
      const { rows: requesterRow } = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId])
      if (senderRow[0]?.fcm_token) {
        await sendPushNotification(senderRow[0].fcm_token, `${requesterRow[0].username} wants more time`, 'Time extension request', { type: 'extend_request' })
      }
      return { id: inserted[0].id }
    } catch (err) {
      console.error('extend-request POST error:', err.message)
      return reply.code(500).send({ error: err.message })
    }
  })

  // Sender polls for pending extend requests they need to decide on
  app.get('/messages/extend-requests/pending', async (req) => {
    const { rows } = await pool.query(
      `SELECT er.id, er.library_item_id, er.message_id, u.username AS requester_username,
              m.content_type
       FROM extend_requests er
       JOIN users u ON u.id = er.requester_id
       LEFT JOIN messages m ON m.id = er.message_id
       WHERE er.sender_id = $1 AND er.status = 'pending'
       ORDER BY er.created_at ASC`,
      [req.user.userId]
    )
    return { requests: rows }
  })

  // Sender decides on an extend request
  app.patch('/messages/extend-requests/:requestId', {
    schema: {
      body: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['approved', 'denied'] },
          expiresHours: { type: 'number', nullable: true },
        },
      },
    },
  }, async (req, reply) => {
    const { decision, expiresHours } = req.body
    const expiresAt = decision === 'approved' && expiresHours
      ? new Date(Date.now() + expiresHours * 3600000).toISOString()
      : null
    const { rows } = await pool.query(
      `UPDATE extend_requests SET status = $1, expires_at = $2
       WHERE id = $3 AND sender_id = $4 RETURNING requester_id, library_item_id`,
      [decision, expiresAt, req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })
    // Notify requester
    const { rows: rRow } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [rows[0].requester_id])
    const { rows: sRow } = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId])
    if (rRow[0]?.fcm_token) {
      const body = decision === 'approved'
        ? expiresHours ? `Approved — ${expiresHours}h extension` : 'Approved — no time limit'
        : 'Extension request denied'
      await sendPushNotification(rRow[0].fcm_token, sRow[0].username, body, { type: 'extend_decision', decision, expiresAt: expiresAt ?? '', libraryItemId: rows[0].library_item_id })
    }
    return { ok: true, expiresAt }
  })

  // Requester polls for outcome of their extend request
  app.get('/messages/extend-requests/:requestId/status', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT status, expires_at FROM extend_requests WHERE id = $1 AND requester_id = $2`,
      [req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })
    return { status: rows[0].status, expiresAt: rows[0].expires_at ?? null }
  })

  // Set a burn timer on a message the sender owns — server deletes it at burn_at
  app.post('/messages/:messageId/burn', {
    schema: { body: { type: 'object', required: ['burnAfterSeconds'], properties: { burnAfterSeconds: { type: 'number' } } } },
  }, async (req, reply) => {
    const { rows } = await pool.query(
      `UPDATE messages SET burn_at = NOW() + ($1 || ' seconds')::interval
       WHERE id = $2 AND sender_id = $3 RETURNING id, burn_at`,
      [req.body.burnAfterSeconds, req.params.messageId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found or not yours' })
    return { ok: true, burnAt: rows[0].burn_at }
  })

  // Fetch ciphertext for a view-once message (recipient only, unviewed only)
  app.get('/messages/:messageId/ciphertext', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT ciphertext, nonce FROM messages
       WHERE id = $1 AND recipient_id = $2 AND view_once = TRUE AND viewed_at IS NULL`,
      [req.params.messageId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found or already viewed' })
    return { ciphertext: rows[0].ciphertext, nonce: rows[0].nonce }
  })

  // Recipient confirms they've opened a view-once message — wipes ciphertext server-side
  app.post('/messages/:messageId/viewed', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const { rows } = await pool.query(
      `UPDATE messages
       SET viewed_at = NOW(), ciphertext = '', nonce = ''
       WHERE id = $1 AND recipient_id = $2 AND view_once = TRUE AND viewed_at IS NULL
       RETURNING id`,
      [req.params.messageId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found or already viewed' })
    return { ok: true }
  })

  // Pin a message in a conversation
  app.post('/messages/:messageId/pin', async (req, reply) => {
    const uid = req.user.userId
    const { rows: msgRows } = await pool.query(
      'SELECT sender_id, recipient_id FROM messages WHERE id = $1',
      [req.params.messageId]
    )
    if (!msgRows.length) return reply.code(404).send({ error: 'Message not found' })
    const { sender_id, recipient_id } = msgRows[0]
    if (sender_id !== uid && recipient_id !== uid) return reply.code(403).send({ error: 'Forbidden' })
    const otherId = sender_id === uid ? recipient_id : sender_id
    await pool.query(
      `INSERT INTO pinned_messages (user_id, other_user_id, message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, other_user_id) DO UPDATE SET message_id = $3, pinned_at = NOW()`,
      [uid, otherId, req.params.messageId]
    )
    return { ok: true }
  })

  // Unpin conversation
  app.delete('/messages/:username/pin', async (req, reply) => {
    const uid = req.user.userId
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.username.toLowerCase()])
    if (!rows.length) return reply.code(404).send({ error: 'User not found' })
    await pool.query('DELETE FROM pinned_messages WHERE user_id = $1 AND other_user_id = $2', [uid, rows[0].id])
    return { ok: true }
  })

  // Get pinned message id for a conversation
  app.get('/messages/:username/pinned', async (req, reply) => {
    const uid = req.user.userId
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.username.toLowerCase()])
    if (!userRows.length) return reply.code(404).send({ error: 'User not found' })
    const { rows } = await pool.query(
      `SELECT message_id FROM pinned_messages WHERE user_id = $1 AND other_user_id = $2`,
      [uid, userRows[0].id]
    )
    return { pinnedId: rows[0]?.message_id ?? null }
  })

  // Recipient polls for the outcome of their save request
  app.get('/messages/save-requests/:requestId/status', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT sr.status, sr.expires_at FROM save_requests sr
       JOIN messages m ON m.id = sr.message_id
       WHERE sr.id = $1 AND m.recipient_id = $2`,
      [req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })
    return { status: rows[0].status, expiresAt: rows[0].expires_at ?? null }
  })
}
