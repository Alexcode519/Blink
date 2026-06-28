import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { messageRoutes } from './routes/messages.js'

const app = Fastify({
  logger: true,
  schemaErrorFormatter: (errors) => {
    const first = errors[0]
    const field = first.instancePath?.replace('/', '') || first.params?.missingProperty || 'field'
    const msg = first.message ?? 'Invalid input'

    if (field === 'password' && msg.includes('fewer')) return new Error('Password must be at least 8 characters')
    if (field === 'password' && msg.includes('length')) return new Error('Password must be at least 8 characters')
    if (field === 'username' && msg.includes('fewer')) return new Error('Username must be at least 3 characters')
    if (field === 'username' && msg.includes('pattern')) return new Error('Username can only contain letters, numbers and underscores')
    return new Error(`${field}: ${msg}`)
  },
})

await app.register(cors, { origin: true })
await app.register(jwt, { secret: process.env.JWT_SECRET })
await app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '1 minute',
  // Stricter limit on auth endpoints
  keyGenerator: (req) => req.ip,
})

await app.register(authRoutes, { prefix: '/auth', config: { rateLimit: { max: 10, timeWindow: '1 minute' } } })
await app.register(userRoutes)
await app.register(messageRoutes)

app.get('/health', () => ({ ok: true }))

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
