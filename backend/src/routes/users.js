import { pool } from '../db/pool.js'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

function hashPassword(password, salt) {
  return createHash('sha256').update(salt + password).digest('hex')
}

export async function userRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    try { await req.jwtVerify() }
    catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  app.get('/users/:username', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT username, public_key FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!rows.length) return reply.code(404).send({ error: 'User not found' })
    return { username: rows[0].username, publicKey: rows[0].public_key }
  })

  app.post('/users/fcm-token', {
    schema: {
      body: {
        type: 'object',
        required: ['fcmToken'],
        properties: { fcmToken: { type: 'string' } },
      },
    },
  }, async (req) => {
    await pool.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [req.body.fcmToken, req.user.userId]
    )
    return { ok: true }
  })

  // Get own profile
  app.get('/users/me/profile', async (req) => {
    const { rows } = await pool.query(
      'SELECT username, created_at FROM users WHERE id = $1',
      [req.user.userId]
    )
    return rows[0]
  })

  // Update username
  app.patch('/users/me/username', {
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9_]+$' },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const { rows } = await pool.query(
        'UPDATE users SET username = $1 WHERE id = $2 RETURNING username',
        [req.body.username.toLowerCase(), req.user.userId]
      )
      const token = app.jwt.sign({ userId: req.user.userId, username: rows[0].username }, { expiresIn: '30d' })
      return { token, username: rows[0].username }
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Username already taken' })
      throw err
    }
  })

  // Change password
  app.patch('/users/me/password', {
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.userId]
    )
    const [salt, storedHash] = rows[0].password_hash.split(':')
    const match = timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(hashPassword(req.body.currentPassword, salt), 'hex')
    )
    if (!match) return reply.code(401).send({ error: 'Current password is incorrect' })

    const newSalt = randomBytes(16).toString('hex')
    const newHash = hashPassword(req.body.newPassword, newSalt)
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [`${newSalt}:${newHash}`, req.user.userId]
    )
    return { ok: true }
  })
}
