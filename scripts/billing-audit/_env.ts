import dotenv from 'dotenv'
dotenv.config({ path: '.env', quiet: true })
dotenv.config({ path: '.env.local', override: true, quiet: true })
export const BASE = 'https://services.leadconnectorhq.com'
export const HQ = process.env.GHL_HQ_LOCATION_ID!
export const HQ_KEY = process.env.GHL_HQ_API_KEY!
