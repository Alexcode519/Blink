import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { messageRoutes } from './routes/messages.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(jwt, { secret: process.env.JWT_SECRET })

await app.register(authRoutes, { prefix: '/auth' })
await app.register(userRoutes)
await app.register(messageRoutes)

app.get('/health', () => ({ ok: true }))

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
