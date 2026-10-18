import fs from 'node:fs'
const per: Record<string, any[]> = JSON.parse(fs.readFileSync(__dirname + '/output/wallet_sep_perloc.json', 'utf8'))
const unf: any[] = JSON.parse(fs.readFileSync(__dirname + '/output/wallet_sep_unfiltered.json', 'utf8'))
const n = (v: any) => (typeof v === 'object' && v?.$numberDecimal ? Number(v.$numberDecimal) : Number(v))
const seen = new Set<string>(); Object.values(per).forEach((rs) => rs.forEach((r) => seen.add(r.id)))
const rest = unf.filter((r) => !seen.has(r.id) && (r.locationName ?? '-').trim() !== '-')
console.log('named non-listed rows', rest.length, 'sum', rest.reduce((a, r) => a + n(r.amount), 0).toFixed(2), 'distinct names', new Set(rest.map((r) => r.locationName)).size)
const HQ = 'KU2rSHDxTfZjZV1CxBkY'; const hq = per[HQ]; console.log('HQ rows', hq.length, 'sum', hq.reduce((a, r) => a + n(r.amount), 0).toFixed(2))
const mem = Object.entries(per).filter(([k]) => k !== HQ).flatMap(([, v]) => v); console.log('listed members rows', mem.length, 'sum', mem.reduce((a, r) => a + n(r.amount), 0).toFixed(2))
const tot = [...unf].reduce((a, r) => a + n(r.amount), 0)
// day-edge: does UTC month cut matter
console.log('settlementTime range', unf.map((r) => r.settlementTime).sort()[0], unf.map((r) => r.settlementTime).sort().at(-1))
// ledger reachable: top 5 locations by cost (ids truncated)
console.log(Object.entries(per).map(([k, v]) => [k.slice(0, 4), v.reduce((a, r) => a + n(r.amount), 0)] as [string, number]).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, v]) => `${k}…:${v.toFixed(2)}`).join(' '))
