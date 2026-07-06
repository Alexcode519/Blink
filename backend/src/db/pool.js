import pg from 'pg'
import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Run migrations on startup, in dependency order. Each statement awaits the
// previous one so a table is never touched before the tables/columns it
// depends on exist.
async function runMigrations() {
  const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(schemaSql)

  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`)
  await pool.query(`CREATE TABLE IF NOT EXISTS contact_invites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_public_key TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  UNIQUE (sender_id, recipient_id)
)`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS view_once BOOLEAN DEFAULT FALSE`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS burn_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS disappearing_hours INTEGER`)
  await pool.query(`ALTER TABLE save_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`)
  await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS extend_requests (
  id SERIAL PRIMARY KEY,
  library_item_id TEXT NOT NULL,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`)
  await pool.query(`ALTER TABLE extend_requests ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL`)
  console.log('extend_requests table ready')

  await pool.query(`CREATE TABLE IF NOT EXISTS accepted_contacts (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, contact_id)
)`)
  await pool.query(`ALTER TABLE accepted_contacts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`)
  console.log('accepted_contacts table ready')
  // Backfill: anyone who has ever sent a message to someone already implicitly
  // "accepted" them — without this, every pre-existing conversation would
  // suddenly look like a pending message request on first load.
  await pool.query(`
    INSERT INTO accepted_contacts (user_id, contact_id)
    SELECT DISTINCT sender_id, recipient_id FROM messages
    ON CONFLICT DO NOTHING
  `)
  console.log('accepted_contacts backfilled from message history')

  await pool.query(`CREATE TABLE IF NOT EXISTS pinned_messages (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, other_user_id)
)`)
  console.log('pinned_messages table ready')

  await pool.query(`CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
)`)
  console.log('blocked_users table ready')

  await pool.query(`CREATE TABLE IF NOT EXISTS qr_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,
  claimed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  created_at   TIMESTAMPTZ DEFAULT NOW()
)`)
  console.log('qr_invites table ready')

  // groups/group_members/group_reads/group_messages/group_message_reactions/
  // group_save_requests all have FKs chaining into each other, so each must
  // finish before the next one starts.
  await pool.query(`CREATE TABLE IF NOT EXISTS groups (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS group_members (
  group_id              UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_group_key   TEXT NOT NULL,
  key_nonce             TEXT NOT NULL,
  key_sender_public_key TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'member',
  joined_at             TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
)`)
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS avatar TEXT`)
  await pool.query(`CREATE TABLE IF NOT EXISTS group_reads (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (group_id, user_id)
)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS group_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext   TEXT NOT NULL,
  nonce        TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  created_at   TIMESTAMPTZ DEFAULT NOW()
)`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES group_messages(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_preview_ciphertext TEXT`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_preview_nonce TEXT`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS reply_sender TEXT`)
  await pool.query(`CREATE TABLE IF NOT EXISTS group_message_reactions (
  message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
)`)

  // 1:1 reply + reaction support
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview_ciphertext TEXT`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview_nonce TEXT`)
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_sender TEXT`)
  await pool.query(`CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
)`)

  // Group save requests (depends on group_messages)
  await pool.query(`CREATE TABLE IF NOT EXISTS group_save_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, requester_id)
)`)
}

export const migrationsReady = runMigrations().then(
  () => console.log('All migrations complete.'),
  (e) => {
    console.error('Migration failed:', e.message)
    throw e
  }
)
