import dotenv from 'dotenv'
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', override: true, quiet: true })
import fs from 'node:fs'
import { load } from './_lib'
const T = process.env.GHL_AGENCY_API_KEY!, C = process.env.GHL_COMPANY_ID!, HQ = process.env.GHL_HQ_LOCATION_ID!
const BASE = 'https://services.leadconnectorhq.com'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function page(skip: number, locationId?: string) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`${BASE}/saas/companies/${C}/wallet-transactions`, { method: 'POST', headers: { Authorization: `Bearer ${T}`, Version: 'v3', Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ skip, limit: 1000, timezone: 'UTC', filters: { settlementTime: { from: '2026-09-01 00:00:00', to: '2026-09-30 23:59:59.999' }, ...(locationId ? { locationId } : {}) } }) })
    if (r.status === 429) { await sleep(2000 * 2 ** a); continue }
    const t = await r.text()
    if (!r.ok) { console.error('HTTP', r.status, t.replaceAll(T, '<k>').replaceAll(C, '<c>').slice(0, 300)); process.exit(1) }
    return JSON.parse(t).data.transactions as any[]
  }
  throw new Error('429')
}
async function pullAll(loc?: string) { const out: any[] = []; for (let skip = 0; ; skip += 1000) { const t = await page(skip, loc); out.push(...t); if (t.length < 1000) break; await sleep(250) } return out }
async function main() {
  const re = /\/location\/([A-Za-z0-9]+)/
  const ids = [...new Set(load().filter((x) => x.entitySourceSubType === 'saas_one_time').map((x) => re.exec(x.entitySourceMeta?.description ?? '')?.[1]).filter(Boolean) as string[])]
  if (!ids.includes(HQ)) ids.push(HQ)
  const perLoc: Record<string, any[]> = {}
  for (const id of ids) { perLoc[id] = await pullAll(id); console.log(id.slice(0, 4) + '…', perLoc[id].length); await sleep(250) }
  const unf = await pullAll(); console.log('unfiltered', unf.length)
  fs.writeFileSync(__dirname + '/output/wallet_sep_perloc.json', JSON.stringify(perLoc))
  fs.writeFileSync(__dirname + '/output/wallet_sep_unfiltered.json', JSON.stringify(unf))
}
main()
