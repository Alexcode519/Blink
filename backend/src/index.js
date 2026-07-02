import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { authRoutes } from './routes/auth.js'
import { landingPage } from './web.js'
import { userRoutes } from './routes/users.js'
import { messageRoutes } from './routes/messages.js'
import { groupRoutes } from './routes/groups.js'
import { inviteRoutes } from './routes/invites.js'
import { startDisappearingSweep } from './jobs/disappearingSweep.js'

const app = Fastify({
  logger: true,
  bodyLimit: 20 * 1024 * 1024, // 20MB to handle photo/video base64
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
await app.register(groupRoutes)
await app.register(inviteRoutes)

app.get('/', (req, reply) => reply.type('text/html').send(landingPage))
app.get('/health', () => ({ ok: true }))

// QR invite redirect — opens app if installed, Play Store if not
app.get('/invite/:token', (req, reply) => {
  const { token } = req.params
  const storeLink   = 'https://play.google.com/store/apps/details?id=com.blink'
  const encodedStore = encodeURIComponent(storeLink)
  // intent:// URL is the only scheme Chrome on Android will follow from JS redirect
  const intentLink  = `intent://invite/${token}#Intent;scheme=blink;package=com.blink;S.browser_fallback_url=${encodedStore};end`
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Blink Invite</title>
  <style>
    body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;font-family:sans-serif;color:#fff;text-align:center;padding:24px;box-sizing:border-box}
    h1{font-size:28px;margin-bottom:8px}
    p{color:#888;margin-bottom:32px;line-height:1.5}
    a{display:inline-block;background:#4f6ef7;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:16px;margin-bottom:12px}
    .store{background:#1f1f1f;font-size:14px;color:#aaa}
  </style>
</head>
<body>
  <h1>🔐 Blink Invite</h1>
  <p>You've been invited to connect on Blink,<br/>an end-to-end encrypted messenger.</p>
  <a href="${intentLink}" id="appLink">Open in Blink</a><br/>
  <a class="store" href="${storeLink}">Don't have Blink? Download it</a>
  <script>
    window.location.href = '${intentLink}'
  </script>
</body>
</html>`
  reply.type('text/html').send(html)
})
app.get('/version', () => ({ version: 'v3' }))

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
startDisappearingSweep()
// Sun Jun 28 21:50:03 SAST 2026
