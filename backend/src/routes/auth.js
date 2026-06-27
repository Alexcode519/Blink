import { pool } from '../db/pool.js'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

function hashPassword(password, salt) {
  return createHash('sha256').update(salt + password).digest('hex')
}

export async function authRoutes(app) {
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password', 'publicKey'],
        properties: {
          username:  { type: 'string', minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9_]+$' },
          password:  { type: 'string', minLength: 8 },
          publicKey: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password, publicKey } = req.body
    const salt = randomBytes(16).toString('hex')
    const hash = hashPassword(password, salt)

    try {
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash, public_key) VALUES ($1, $2, $3) RETURNING id, username',
        [username.toLowerCase(), `${salt}:${hash}`, publicKey]
      )
      const token = app.jwt.sign({ userId: rows[0].id, username: rows[0].username })
      return { token, username: rows[0].username }
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Username already taken' })
      throw err
    }
  })

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body
    const { rows } = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username.toLowerCase()]
    )
    if (!rows.length) return reply.code(401).send({ error: 'Invalid credentials' })

    const [salt, storedHash] = rows[0].password_hash.split(':')
    const attemptHash = hashPassword(password, salt)

    // Constant-time comparison to prevent timing attacks
    const match = timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(attemptHash, 'hex'))
    if (!match) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ userId: rows[0].id, username: rows[0].username })
    return { token, username: rows[0].username }
  })
}
