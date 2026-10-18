import dotenv from 'dotenv'
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', override: true, quiet: true })
import fs from 'node:fs'
const T = process.env.GHL_AGENCY_API_KEY!, C = process.env.GHL_COMPANY_ID!
const BASE = 'https://services.leadconnectorhq.com'
async function page(skip: number, from: string, to: string, limit = 1000) {
  const r = await fetch(`${BASE}/saas/companies/${C}/wallet-transactions`, { method: 'POST', headers: { Authorization: `Bearer ${T}`, Version: 'v3', Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ skip, limit, timezone: 'UTC', filters: { settlementTime: { from, to } } }) })
  const t = await r.text()
  if (!r.ok) { console.error('HTTP', r.status, t.replaceAll(T, '<k>').replaceAll(C, '<c>').slice(0, 400)); process.exit(1) }
  return JSON.parse(t)
}
async function main() {
  const mode = process.argv[2]
  if (mode === 'shape') {
    const j = await page(0, '2026-09-21 00:00:00', '2026-09-21 23:59:59', 5)
    console.log('top-level keys', Object.keys(j), 'data keys', Object.keys(j.data ?? {}))
    const redact = JSON.parse(JSON.stringify(j, (k, v) => (/name|email|description/i.test(k) && typeof v === 'string' && !/^locationName$/.test(k) ? '<r>' : v)))
    console.log(JSON.stringify(redact, null, 1).slice(0, 3500))
    return
  }
  const out: any[] = []
  let skip = 0
  for (;;) {
    const j = await page(skip, '2026-09-01 00:00:00', '2026-09-30 23:59:59.999')
    const t = j.data.transactions
    out.push(...t); console.log('skip', skip, 'got', t.length, 'total so far', out.length)
    if (t.length < 1000) break
    skip += 1000; await new Promise((r) => setTimeout(r, 300))
  }
  fs.writeFileSync(__dirname + '/output/wallet_2026-09.json', JSON.stringify(out))
  console.log('saved', out.length)
}
main()
