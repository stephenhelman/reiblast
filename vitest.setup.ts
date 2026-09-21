import path from 'node:path'
import dotenv from 'dotenv'

// Load .env.local into the test process so SEED_DATABASE_URL and
// TOOLS_SESSION_SECRET come from the file, not whatever the invoking shell
// happens to have exported.
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
