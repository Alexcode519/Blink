import { pool } from '../db/pool.js'
import { sendPushNotification } from '../firebase.js'

// In-memory typing state: Map<groupId, Map<userId, expiresAt>>
const groupTypingState = new Map()

export async function groupRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    try { await req.jwtVerify() }
    catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  // Create a group. Creator sends encrypted group key for every initial member (incl. themselves).
  app.post('/groups', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'members'],
        properties: {
          name:    { type: 'string', minLength: 1, maxLength: 50 },
          members: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['username', 'encryptedGroupKey', 'keyNonce'],
              properties: {
                username:         { type: 'string' },
                encryptedGroupKey:{ type: 'string' },
                keyNonce:         { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { name, members } = req.body

    // Resolve all member usernames → user ids, and grab the creator's public key
    const { rows: creatorRows } = await pool.query(
      'SELECT username, public_key FROM users WHERE id = $1',
      [req.user.userId]
    )
    if (!creatorRows.length) return reply.code(404).send({ error: 'Creator not found' })
    const creatorPublicKey = creatorRows[0].public_key
    const creatorUsername  = creatorRows[0].username

    // Ensure creator is in the members list
    const memberUsernames = members.map(m => m.username.toLowerCase())
    if (!memberUsernames.includes(creatorUsername.toLowerCase())) {
      return reply.code(400).send({ error: 'Creator must be included in members list' })
    }

    const { rows: userRows } = await pool.query(
      `SELECT id, username FROM users WHERE username = ANY($1)`,
      [memberUsernames]
    )
    if (userRows.length !== memberUsernames.length) {
      return reply.code(404).send({ error: 'One or more members not found' })
    }

    const usernameToId = Object.fromEntries(userRows.map(u => [u.username.toLowerCase(), u.id]))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: groupRows } = await client.query(
        'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id',
        [name, req.user.userId]
      )
      const groupId = groupRows[0].id

      for (const member of members) {
        const userId = usernameToId[member.username.toLowerCase()]
        const role   = userId === req.user.userId ? 'admin' : 'member'
        await client.query(
          `INSERT INTO group_members (group_id, user_id, encrypted_group_key, key_nonce, key_sender_public_key, role)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [groupId, userId, member.encryptedGroupKey, member.keyNonce, creatorPublicKey, role]
        )
      }

      await client.query('COMMIT')
      return { groupId }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // List my groups
  app.get('/groups', async (req) => {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.avatar,
              (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM group_messages gms
               WHERE gms.group_id = g.id
                 AND gms.created_at > COALESCE(
                   (SELECT last_read FROM group_reads WHERE group_id = g.id AND user_id = $1),
                   '1970-01-01'
                 )
                 AND gms.sender_id != $1
              ) AS unread_count,
              (SELECT gms2.created_at FROM group_messages gms2 WHERE gms2.group_id = g.id ORDER BY gms2.created_at DESC LIMIT 1) AS last_message_at
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
        ORDER BY last_message_at DESC NULLS LAST, g.created_at DESC`,
      [req.user.userId]
    )
    return { groups: rows }
  })

  // Get group details + my encrypted key
  app.get('/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params

    const { rows: myRows } = await pool.query(
      `SELECT gm.encrypted_group_key, gm.key_nonce, gm.key_sender_public_key, gm.role
         FROM group_members gm WHERE gm.group_id = $1 AND gm.user_id = $2`,
      [groupId, req.user.userId]
    )
    if (!myRows.length) return reply.code(403).send({ error: 'Not a member' })

    const { rows: groupRows } = await pool.query(
      'SELECT id, name, avatar FROM groups WHERE id = $1',
      [groupId]
    )
    if (!groupRows.length) return reply.code(404).send({ error: 'Group not found' })

    const { rows: memberRows } = await pool.query(
      `SELECT u.username, u.public_key, gm.role, gr.last_read AS "lastRead"
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN group_reads gr ON gr.group_id = gm.group_id AND gr.user_id = gm.user_id
        WHERE gm.group_id = $1`,
      [groupId]
    )

    return {
      ...groupRows[0],
      myEncryptedGroupKey:   myRows[0].encrypted_group_key,
      myKeyNonce:            myRows[0].key_nonce,
      keySenderPublicKey:    myRows[0].key_sender_public_key,
      myRole:                myRows[0].role,
      members:               memberRows,
    }
  })

  // Get message history
  app.get('/groups/:groupId/messages', async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })

    const { rows } = await pool.query(
      `SELECT gm.id, u.username AS sender_username, gm.ciphertext, gm.nonce, gm.content_type, gm.created_at,
              gm.reply_to_id, gm.reply_preview_ciphertext, gm.reply_preview_nonce, gm.reply_sender,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', gmr.ciphertext, 'nonce', gmr.nonce)), '[]')
                 FROM group_message_reactions gmr JOIN users ru ON ru.id = gmr.user_id WHERE gmr.message_id = gm.id) AS reactions
         FROM group_messages gm
         JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = $1
        ORDER BY gm.created_at ASC
        LIMIT 200`,
      [groupId]
    )

    // Mark as read
    await pool.query(
      `INSERT INTO group_reads (group_id, user_id, last_read)
       VALUES ($1, $2, NOW())
       ON CONFLICT (group_id, user_id) DO UPDATE SET last_read = NOW()`,
      [groupId, req.user.userId]
    )

    return { messages: rows }
  })

  // Send a message to a group
  app.post('/groups/:groupId/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['ciphertext', 'nonce', 'contentType'],
        properties: {
          ciphertext:             { type: 'string' },
          nonce:                  { type: 'string' },
          contentType:            { type: 'string', enum: ['text', 'image', 'video', 'document', 'audio'] },
          replyToId:              { type: 'string', nullable: true },
          replyPreviewCiphertext: { type: 'string', nullable: true },
          replyPreviewNonce:      { type: 'string', nullable: true },
          replySender:            { type: 'string', nullable: true },
        },
      },
    },
  }, async (req, reply) => {
    const { groupId } = req.params
    const { ciphertext, nonce, contentType, replyToId, replyPreviewCiphertext, replyPreviewNonce, replySender } = req.body

    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })

    const { rows: senderRows } = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [req.user.userId]
    )
    const senderUsername = senderRows[0]?.username ?? 'Someone'

    const { rows } = await pool.query(
      `INSERT INTO group_messages (group_id, sender_id, ciphertext, nonce, content_type, reply_to_id, reply_preview_ciphertext, reply_preview_nonce, reply_sender)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
      [groupId, req.user.userId, ciphertext, nonce, contentType, replyToId ?? null, replyPreviewCiphertext ?? null, replyPreviewNonce ?? null, replySender ?? null]
    )

    // Get group name and notify all other members
    const { rows: groupRows } = await pool.query('SELECT name FROM groups WHERE id = $1', [groupId])
    const groupName = groupRows[0]?.name ?? 'Group'

    const { rows: memberRows } = await pool.query(
      `SELECT u.fcm_token FROM group_members gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 AND gm.user_id != $2`,
      [groupId, req.user.userId]
    )
    const typeLabel = { text: 'message', image: 'image', video: 'video', document: 'document', audio: 'voice note' }[contentType] ?? contentType
    await Promise.all(memberRows.map(m =>
      sendPushNotification(
        m.fcm_token,
        groupName,
        contentType === 'text' ? `${senderUsername}: New message` : `${senderUsername} sent a ${typeLabel}`,
        { type: 'new_group_message', groupId }
      ).catch(() => {})
    ))

    return { messageId: rows[0].id, createdAt: rows[0].created_at }
  })

  // Poll for new messages since a timestamp
  app.get('/groups/:groupId/messages/since/:since', async (req, reply) => {
    const { groupId, since } = req.params
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })

    const { rows } = await pool.query(
      `SELECT gm.id, u.username AS sender_username, gm.ciphertext, gm.nonce, gm.content_type, gm.created_at,
              gm.reply_to_id, gm.reply_preview_ciphertext, gm.reply_preview_nonce, gm.reply_sender,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', gmr.ciphertext, 'nonce', gmr.nonce)), '[]')
                 FROM group_message_reactions gmr JOIN users ru ON ru.id = gmr.user_id WHERE gmr.message_id = gm.id) AS reactions
         FROM group_messages gm
         JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = $1 AND gm.created_at > $2
        ORDER BY gm.created_at ASC`,
      [groupId, since]
    )

    if (rows.length) {
      await pool.query(
        `INSERT INTO group_reads (group_id, user_id, last_read)
         VALUES ($1, $2, NOW())
         ON CONFLICT (group_id, user_id) DO UPDATE SET last_read = NOW()`,
        [groupId, req.user.userId]
      )
    }

    return { messages: rows }
  })

  // Set (or replace) the current user's reaction on a group message
  app.put('/groups/:groupId/messages/:messageId/reaction', {
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
    const { groupId, messageId } = req.params
    const { ciphertext, nonce } = req.body
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    await pool.query(
      `INSERT INTO group_message_reactions (message_id, user_id, ciphertext, nonce)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id) DO UPDATE SET ciphertext = $3, nonce = $4, created_at = NOW()`,
      [messageId, req.user.userId, ciphertext, nonce]
    )
    return { ok: true }
  })

  // Remove the current user's reaction on a group message
  app.delete('/groups/:groupId/messages/:messageId/reaction', async (req, reply) => {
    await pool.query(
      'DELETE FROM group_message_reactions WHERE message_id = $1 AND user_id = $2',
      [req.params.messageId, req.user.userId]
    )
    return { ok: true }
  })

  // Poll for reaction changes across the whole group
  app.get('/groups/:groupId/reactions', async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    const { rows } = await pool.query(
      `SELECT gm.id AS message_id,
              (SELECT COALESCE(json_agg(json_build_object('username', ru.username, 'ciphertext', gmr.ciphertext, 'nonce', gmr.nonce)), '[]')
                 FROM group_message_reactions gmr JOIN users ru ON ru.id = gmr.user_id WHERE gmr.message_id = gm.id) AS reactions
         FROM group_messages gm
        WHERE gm.group_id = $1
          AND EXISTS (SELECT 1 FROM group_message_reactions gmr2 WHERE gmr2.message_id = gm.id)`,
      [groupId]
    )
    return { reactions: rows }
  })

  // Poll member read timestamps for "seen by" indicators
  app.get('/groups/:groupId/reads', async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    const { rows } = await pool.query(
      `SELECT u.username, gr.last_read AS "lastRead"
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN group_reads gr ON gr.group_id = gm.group_id AND gr.user_id = gm.user_id
        WHERE gm.group_id = $1`,
      [groupId]
    )
    return { reads: rows }
  })

  // Update group photo (any member, base64 — not E2E content, same model as profile avatars)
  app.put('/groups/:groupId/avatar', {
    schema: {
      body: {
        type: 'object',
        required: ['avatar'],
        properties: { avatar: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.userId]
    )
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    await pool.query('UPDATE groups SET avatar = $1 WHERE id = $2', [req.body.avatar, groupId])
    return { ok: true }
  })

  // Set typing indicator for a group (expires after 4s)
  app.post('/groups/:groupId/typing', async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.userId])
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    if (!groupTypingState.has(groupId)) groupTypingState.set(groupId, new Map())
    groupTypingState.get(groupId).set(req.user.userId, Date.now() + 4000)
    return { ok: true }
  })

  // Poll who's currently typing in a group (excluding yourself)
  app.get('/groups/:groupId/typing', async (req, reply) => {
    const { groupId } = req.params
    const { rows: mem } = await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.userId])
    if (!mem.length) return reply.code(403).send({ error: 'Not a member' })
    const now = Date.now()
    const map = groupTypingState.get(groupId)
    if (!map) return { typing: [] }
    const typingIds = [...map.entries()].filter(([uid, exp]) => exp > now && uid !== req.user.userId).map(([uid]) => uid)
    if (!typingIds.length) return { typing: [] }
    const { rows } = await pool.query('SELECT username FROM users WHERE id = ANY($1)', [typingIds])
    return { typing: rows.map(r => r.username) }
  })

  // Add a member (admin only) — caller must supply the group key encrypted for the new member
  app.post('/groups/:groupId/members', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'encryptedGroupKey', 'keyNonce'],
        properties: {
          username:          { type: 'string' },
          encryptedGroupKey: { type: 'string' },
          keyNonce:          { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { groupId } = req.params
    const { username, encryptedGroupKey, keyNonce } = req.body

    const { rows: adminRows } = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, req.user.userId]
    )
    if (!adminRows.length || adminRows[0].role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can add members' })
    }

    const { rows: adminPkRows } = await pool.query(
      'SELECT public_key FROM users WHERE id = $1',
      [req.user.userId]
    )
    const adminPublicKey = adminPkRows[0].public_key

    const { rows: userRows } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    )
    if (!userRows.length) return reply.code(404).send({ error: 'User not found' })

    try {
      await pool.query(
        `INSERT INTO group_members (group_id, user_id, encrypted_group_key, key_nonce, key_sender_public_key, role)
         VALUES ($1, $2, $3, $4, $5, 'member')`,
        [groupId, userRows[0].id, encryptedGroupKey, keyNonce, adminPublicKey]
      )
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'User is already a member' })
      throw e
    }

    return { ok: true }
  })

  // Remove a member (admin only)
  app.delete('/groups/:groupId/members/:username', async (req, reply) => {
    const { groupId, username } = req.params

    const { rows: adminRows } = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, req.user.userId]
    )
    if (!adminRows.length || adminRows[0].role !== 'admin') {
      return reply.code(403).send({ error: 'Only admins can remove members' })
    }

    const { rows: userRows } = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    )
    if (!userRows.length) return reply.code(404).send({ error: 'User not found' })
    if (userRows[0].id === req.user.userId) {
      return reply.code(400).send({ error: 'Use the leave endpoint to remove yourself' })
    }

    const { rows } = await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING role',
      [groupId, userRows[0].id]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not a member' })
    return { ok: true }
  })

  // ── Group save requests ────────────────────────────────────────────────────

  // Member requests to save another member's message
  app.post('/groups/:groupId/messages/:messageId/save-request', async (req, reply) => {
    const { messageId } = req.params
    // Verify message exists in this group and requester is not the sender
    const { rows: msgs } = await pool.query(
      `SELECT gm.id, gm.sender_id, gm.content_type, u.fcm_token, u.username AS sender_username,
              r.username AS requester_username
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       JOIN users r ON r.id = $2
       WHERE gm.id = $1`,
      [messageId, req.user.userId]
    )
    if (!msgs.length) return reply.code(404).send({ error: 'Message not found' })
    if (msgs[0].sender_id === req.user.userId) return reply.code(400).send({ error: 'Cannot request to save your own message' })

    const { rows } = await pool.query(
      `INSERT INTO group_save_requests (message_id, requester_id)
       VALUES ($1, $2)
       ON CONFLICT (message_id, requester_id) DO UPDATE SET status = 'pending', expires_at = NULL
       RETURNING id`,
      [messageId, req.user.userId]
    )

    await sendPushNotification(
      msgs[0].fcm_token,
      'Save request',
      `${msgs[0].requester_username} wants to save something you sent in a group`,
      { type: 'group_save_request', groupId: req.params.groupId, requesterUsername: msgs[0].requester_username }
    ).catch(() => {})

    return { requestId: rows[0].id }
  })

  // Sender polls for pending group save requests on their sent messages
  app.get('/groups/save-requests/pending', async (req) => {
    const { rows } = await pool.query(
      `SELECT gsr.id, gsr.message_id, gm.content_type, u.username AS requester_username
       FROM group_save_requests gsr
       JOIN group_messages gm ON gm.id = gsr.message_id
       JOIN users u ON u.id = gsr.requester_id
       WHERE gm.sender_id = $1 AND gsr.status = 'pending'`,
      [req.user.userId]
    )
    return { requests: rows }
  })

  // Sender approves or denies a group save request
  app.patch('/groups/save-requests/:requestId', {
    schema: { body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approved', 'denied'] }, expiresHours: { type: 'number', nullable: true } } } },
  }, async (req, reply) => {
    const { decision, expiresHours } = req.body
    const expiresAt = expiresHours ? new Date(Date.now() + expiresHours * 3600 * 1000).toISOString() : null

    const { rows } = await pool.query(
      `UPDATE group_save_requests gsr SET status = $1, expires_at = $4
       FROM group_messages gm JOIN users u ON u.id = gsr.requester_id
       WHERE gsr.id = $2 AND gsr.message_id = gm.id AND gm.sender_id = $3
       RETURNING gsr.id, u.fcm_token, u.username AS requester_username`,
      [decision, req.params.requestId, req.user.userId, expiresAt]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })

    await sendPushNotification(
      rows[0].fcm_token,
      decision === 'approved' ? 'Save approved' : 'Save denied',
      decision === 'approved' ? 'Your save request was approved' : 'Your save request was denied',
      { type: 'group_save_response', requestId: req.params.requestId, decision }
    ).catch(() => {})

    return { ok: true }
  })

  // Requester polls for the outcome of their group save request
  app.get('/groups/save-requests/:requestId/status', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT gsr.status, gsr.expires_at
       FROM group_save_requests gsr
       WHERE gsr.id = $1 AND gsr.requester_id = $2`,
      [req.params.requestId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not found' })
    return rows[0]
  })

  // Leave a group
  app.delete('/groups/:groupId/members/me', async (req, reply) => {
    const { groupId } = req.params
    const { rows } = await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING role',
      [groupId, req.user.userId]
    )
    if (!rows.length) return reply.code(404).send({ error: 'Not a member' })
    // If group has no members left, delete it
    const { rows: remaining } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = $1',
      [groupId]
    )
    if (parseInt(remaining[0].cnt) === 0) {
      await pool.query('DELETE FROM groups WHERE id = $1', [groupId])
    }
    return { ok: true }
  })
}
