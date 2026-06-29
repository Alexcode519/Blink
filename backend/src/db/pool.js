import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Run migrations on startup
pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`).catch(() => {})
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`).catch(() => {})
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`).catch(() => {})
pool.query(`ALTER TABLE save_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS extend_requests (
  id SERIAL PRIMARY KEY,
  library_item_id TEXT NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
)`).catch(() => {})
