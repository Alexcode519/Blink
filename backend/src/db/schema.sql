CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username    TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  public_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Encrypted blobs waiting to be picked up by the recipient.
-- Deleted immediately after delivery.
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id     UUID NOT NULL REFERENCES users(id),
  recipient_id  UUID NOT NULL REFERENCES users(id),
  ciphertext    TEXT NOT NULL,   -- base64-encoded encrypted payload
  nonce         TEXT NOT NULL,   -- base64-encoded NaCl nonce
  content_type  TEXT NOT NULL,   -- 'text' | 'image' | 'video' | 'document'
  delivered     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Save requests from recipient to sender.
CREATE TABLE IF NOT EXISTS save_requests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES messages(id),
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
