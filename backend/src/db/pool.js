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

// Chained sequentially: group_members/group_reads/group_messages have FKs into
// groups, and unchained pool.query() calls can land on different pool
// connections and race ahead of the table they depend on.
pool.query(`CREATE TABLE IF NOT EXISTS groups (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
)`)
  .catch(e => console.error('groups migration failed:', e.message))
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS group_members (
  group_id              UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_group_key   TEXT NOT NULL,
  key_nonce             TEXT NOT NULL,
  key_sender_public_key TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'member',
  joined_at             TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
)`).catch(e => console.error('group_members migration failed:', e.message)))
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS group_reads (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (group_id, user_id)
)`).catch(e => console.error('group_reads migration failed:', e.message)))
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS group_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext   TEXT NOT NULL,
  nonce        TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  created_at   TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.error('group_messages migration failed:', e.message)))
