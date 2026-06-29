import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Run migrations on startup
pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`).catch(() => {})
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`).catch(() => {})
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`).catch(() => {})
pool.query(`ALTER TABLE save_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS extend_requests (
  id SERIAL PRIMARY KEY,
  library_item_id TEXT NOT NULL,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).then(() => console.log('extend_requests table ready')).catch(e => console.error('extend_requests migration failed:', e.message))
pool.query(`CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
)`).then(() => console.log('blocked_users table ready')).catch(e => console.error('blocked_users migration failed:', e.message))
