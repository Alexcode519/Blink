import { pool } from '../db/pool.js'

// Deletes messages once they've outlived the disappearing-messages window
// either party (1:1) or the sender (groups) has configured for themselves.
export async function runDisappearingSweep() {
  try {
    await pool.query(`
      DELETE FROM messages m
      USING users s, users r
      WHERE m.sender_id = s.id AND m.recipient_id = r.id
        AND (
          (s.disappearing_hours IS NOT NULL AND m.created_at < NOW() - (s.disappearing_hours || ' hours')::interval)
          OR
          (r.disappearing_hours IS NOT NULL AND m.created_at < NOW() - (r.disappearing_hours || ' hours')::interval)
        )
    `)
    await pool.query(`
      DELETE FROM group_messages gm
      USING users s
      WHERE gm.sender_id = s.id
        AND s.disappearing_hours IS NOT NULL
        AND gm.created_at < NOW() - (s.disappearing_hours || ' hours')::interval
    `)
  } catch (e) {
    console.error('disappearing sweep failed:', e.message)
  }
}

export function startDisappearingSweep(intervalMs = 5 * 60 * 1000) {
  runDisappearingSweep()
  setInterval(runDisappearingSweep, intervalMs)
}
