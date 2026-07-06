import { pool, migrationsReady } from './pool.js'

await migrationsReady
console.log('Migration complete.')
await pool.end()
