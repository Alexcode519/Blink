import { pool } from '../db/pool.js'

export async function userRoutes(app) {
  // Auth guard for all routes in this plugin
  app.addHook('onRequest', async (req, reply) => {
    try { await req.jwtVerify() }
    catch { reply.code(401).send({ error: 'Unauthorized' }) }
  })

  // Search for a user by exact username and return their public key
  app.get('/users/:username', async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT username, public_key FROM users WHERE username = $1',
      [req.params.username.toLowerCase()]
    )
    if (!rows.length) return reply.code(404).send({ error: 'User not found' })
    return { username: rows[0].username, publicKey: rows[0].public_key }
  })
}
