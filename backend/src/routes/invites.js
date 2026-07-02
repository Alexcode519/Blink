import { pool } from '../db/pool.js'
import { sendPushNotification } from '../firebase.js'

export async function inviteRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    try { await req.jwtVerify() }
    catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  // Send a verified contact invite to another user
  app.post('/invites', {
    schema: {
      body: {
        type: 'object',
        required: ['recipientUsername'],
        properties: { recipientUsername: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { recipientUsername } = req.body

    const { rows: me } = await pool.query(
      'SELECT username, public_key FROM users WHERE id = $1',
      [req.user.userId]
    )
    if (!me.length) return reply.code(404).send({ error: 'Sender not found' })

    const { rows: recipient } = await pool.query(
      'SELECT id, fcm_token, username FROM users WHERE username = $1',
      [recipientUsername.toLowerCase()]
    )
    if (!recipient.length) return reply.code(404).send({ error: 'User not found' })
    if (recipient[0].id === req.user.userId) return reply.code(400).send({ error: 'Cannot invite yourself' })

    // Upsert invite (reset if previously declined and re-sending)
    const { rows } = await pool.query(
      `INSERT INTO contact_invites (sender_id, recipient_id, sender_public_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (sender_id, recipient_id)
       DO UPDATE SET status = 'pending', created_at = NOW(),
                     expires_at = NOW() + INTERVAL '7 days',
                     sender_public_key = $3
       RETURNING id`,
      [req.user.userId, recipient[0].id, me[0].public_key]
    )

    // Push notification to recipient
    if (recipient[0].fcm_token) {
      await sendPushNotification(
        recipient[0].fcm_token,
        me[0].username,
        'wants to start a verified conversation with you',
        { type: 'contact_invite', senderUsername: me[0].username }
      )
    }

    return { ok: true, inviteId: rows[0].id }
  })

  // Get pending invites addressed to me
  app.get('/invites/pending', async (req) => {
    const { rows } = await pool.query(
      `SELECT ci.id, u.username AS "senderUsername", u.public_key AS "senderPublicKey",
              ci.created_at, ci.expires_at
       FROM contact_invites ci
       JOIN users u ON u.id = ci.sender_id
       WHERE ci.recipient_id = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
       ORDER BY ci.created_at DESC`,
      [req.user.userId]
    )
    return { invites: rows }
  })

  // Get invites I sent + their status
  app.get('/invites/sent', async (req) => {
    const { rows } = await pool.query(
      `SELECT ci.id, u.username AS "recipientUsername", ci.status, ci.created_at
       FROM contact_invites ci
       JOIN users u ON u.id = ci.recipient_id
       WHERE ci.sender_id = $1
       ORDER BY ci.created_at DESC`,
      [req.user.userId]
    )
    return { invites: rows }
  })

  // Accept invite + mutually verify
  app.post('/invites/:inviteId/accept', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const { rows } = await pool.query(
      `UPDATE contact_invites SET status = 'accepted'
       WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
       RETURNING sender_id`,
      [req.params.inviteId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Invite not found or already handled' })

    const senderId = rows[0].sender_id

    // Mark both sides as accepted + verified
    await pool.query(
      `INSERT INTO accepted_contacts (user_id, contact_id, verified_at)
       VALUES ($1, $2, NOW()), ($2, $1, NOW())
       ON CONFLICT (user_id, contact_id)
       DO UPDATE SET verified_at = COALESCE(accepted_contacts.verified_at, NOW())`,
      [req.user.userId, senderId]
    )

    // Notify sender
    const { rows: me } = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId])
    const { rows: sender } = await pool.query('SELECT fcm_token, username FROM users WHERE id = $1', [senderId])
    if (sender[0]?.fcm_token) {
      await sendPushNotification(
        sender[0].fcm_token,
        me[0]?.username ?? 'Someone',
        'accepted and verified your contact invite ✓',
        { type: 'invite_accepted', acceptorUsername: me[0]?.username ?? '' }
      )
    }

    return { ok: true }
  })

  // Decline invite
  app.post('/invites/:inviteId/decline', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const { rows } = await pool.query(
      `UPDATE contact_invites SET status = 'declined'
       WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
       RETURNING sender_id`,
      [req.params.inviteId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })

    const { rows: me } = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.userId])
    const { rows: sender } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [rows[0].sender_id])
    if (sender[0]?.fcm_token) {
      await sendPushNotification(
        sender[0].fcm_token,
        me[0]?.username ?? 'Someone',
        'declined your contact invite',
        { type: 'invite_declined' }
      )
    }
    return { ok: true }
  })

  // ── QR invite: generate a single-use token ──────────────────────────────
  app.post('/invites/qr', async (req, reply) => {
    const { rows: me } = await pool.query(
      'SELECT public_key FROM users WHERE id = $1',
      [req.user.userId]
    )
    if (!me.length) return reply.code(404).send({ error: 'User not found' })
    const { rows } = await pool.query(
      `INSERT INTO qr_invites (owner_id, public_key)
       VALUES ($1, $2) RETURNING id, expires_at`,
      [req.user.userId, me[0].public_key]
    )
    return { token: rows[0].id, expiresAt: rows[0].expires_at }
  })

  // ── QR invite: claim — mutual verify + create accepted_contacts ──────────
  app.post('/invites/qr/claim', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { token } = req.body
    const claimerId = req.user.userId

    const { rows } = await pool.query(
      `UPDATE qr_invites
       SET claimed_by = $1, claimed_at = NOW()
       WHERE id = $2
         AND claimed_by IS NULL
         AND expires_at > NOW()
         AND owner_id <> $1
       RETURNING owner_id, public_key`,
      [claimerId, token]
    )
    if (!rows.length) return reply.code(400).send({ error: 'QR code is invalid, expired, or already used.' })

    const ownerId = rows[0].owner_id
    const ownerPublicKey = rows[0].public_key

    // Mutual verified contact
    await pool.query(
      `INSERT INTO accepted_contacts (user_id, contact_id, verified_at)
       VALUES ($1, $2, NOW()), ($2, $1, NOW())
       ON CONFLICT (user_id, contact_id)
       DO UPDATE SET verified_at = COALESCE(accepted_contacts.verified_at, NOW())`,
      [claimerId, ownerId]
    )

    const { rows: owner } = await pool.query(
      'SELECT username, fcm_token FROM users WHERE id = $1',
      [ownerId]
    )
    const { rows: claimer } = await pool.query(
      'SELECT username, public_key FROM users WHERE id = $1',
      [claimerId]
    )

    // Notify the QR owner that someone scanned and verified them
    if (owner[0]?.fcm_token) {
      await sendPushNotification(
        owner[0].fcm_token,
        claimer[0]?.username ?? 'Someone',
        'scanned your QR code and is now a verified contact ✓',
        { type: 'qr_claimed', claimerUsername: claimer[0]?.username ?? '' }
      )
    }

    return {
      ownerUsername: owner[0]?.username,
      ownerPublicKey,
      claimerPublicKey: claimer[0]?.public_key,
    }
  })

  // Check verification status for a specific contact
  app.get('/invites/verified/:username', async (req) => {
    const { rows: other } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!other.length) return { verified: false }
    const { rows } = await pool.query(
      'SELECT verified_at FROM accepted_contacts WHERE user_id = $1 AND contact_id = $2',
      [req.user.userId, other[0].id]
    )
    return { verified: !!(rows[0]?.verified_at), verifiedAt: rows[0]?.verified_at ?? null }
  })
}
