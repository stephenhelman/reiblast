import fs from 'node:fs'
import path from 'node:path'
import { BASE, HQ, HQ_KEY } from './_env'
const OUT = path.join(__dirname, 'output')
const [start, end] = [process.argv[2] ?? '2026-08-19', process.argv[3] ?? '2026-09-30']
const tag = process.argv[4] ?? 'tx'
async function main() {
  const all: any[] = []
  let offset = 0, total = Infinity
  while (offset < total) {
    const u = new URL(`${BASE}/payments/transactions`)
    u.search = new URLSearchParams({ altId: HQ, altType: 'location', paymentMode: 'live', startAt: start, endAt: end, limit: '100', offset: String(offset) }).toString()
    const r = await fetch(u, { headers: { Authorization: `Bearer ${HQ_KEY}`, Version: 'v3', Accept: 'application/json' } })
    const t = await r.text()
    if (!r.ok) { console.error('HTTP', r.status, t.replaceAll(HQ_KEY, '<key>').slice(0, 500)); process.exit(1) }
    const j = JSON.parse(t)
    total = j.totalCount ?? 0
    all.push(...j.data)
    console.log(`offset=${offset} got=${j.data.length} totalCount=${total}`)
    if (j.data.length === 0) break
    offset += j.data.length
    await new Promise((x) => setTimeout(x, 250))
  }
  fs.writeFileSync(path.join(OUT, `${tag}_${start}_${end}.json`), JSON.stringify({ totalCount: total, data: all }))
  console.log('saved', all.length, 'unique ids', new Set(all.map((x) => x._id)).size)
}
main()
