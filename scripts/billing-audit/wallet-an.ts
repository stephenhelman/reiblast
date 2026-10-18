import fs from 'node:fs'
import { load, cents, usd } from './_lib'
import { parseWalletCategory } from '../../lib/billing/walletCategories'
const per: Record<string, any[]> = JSON.parse(fs.readFileSync(__dirname + '/output/wallet_sep_perloc.json', 'utf8'))
const unf: any[] = JSON.parse(fs.readFileSync(__dirname + '/output/wallet_sep_unfiltered.json', 'utf8'))
const HQ = process.env.GHL_HQ_LOCATION_ID ?? 'KU2rSHDxTfZjZV1CxBkY'
const keys = new Map<string, number>(); unf.forEach((r) => Object.keys(r).forEach((k) => keys.set(k, (keys.get(k) ?? 0) + 1))); console.log('fields', [...keys])
console.log('unfiltered rows', unf.length, 'unique ids', new Set(unf.map((r) => r.id)).size, 'has locationId field:', unf.some((r) => 'locationId' in r))
const n = (v: any) => (typeof v === 'object' && v?.$numberDecimal ? Number(v.$numberDecimal) : Number(v))
// one-wallet chain test: prevWalletBalance of row vs balance of next-newer row, across different locationNames
const s = [...unf].sort((a, b) => a.settlementTime.localeCompare(b.settlementTime))
let chainOk = 0, chainTot = 0, crossLoc = 0
for (let i = 1; i < s.length; i++) { const prev = s[i - 1], cur = s[i]; chainTot++; if (Math.abs(n(cur.prevWalletBalance) - n(prev.balance)) < 0.011) { chainOk++; if (cur.locationName !== prev.locationName) crossLoc++ } }
console.log('prevWalletBalance == previous row balance:', chainOk, '/', chainTot, '(cross-location links:', crossLoc, ')')
console.log('balance range', n(s[0].balance), '..', n(s.at(-1)!.balance))
// category totals, all rows
const cat = new Map<string, { n: number; amt: number; orig: number; disc: number }>()
for (const r of unf) { const c = parseWalletCategory(r.description); const o = cat.get(c) ?? { n: 0, amt: 0, orig: 0, disc: 0 }; o.n++; o.amt += n(r.amount); o.orig += n(r.originalAmount); o.disc += n(r.discountAmount); cat.set(c, o) }
for (const [c, o] of [...cat].sort((a, b) => a[1].amt - b[1].amt)) console.log(c.padEnd(26), String(o.n).padStart(7), 'amount', o.amt.toFixed(2).padStart(10), 'original', o.orig.toFixed(2).padStart(10), 'discount', o.disc.toFixed(2).padStart(8))
const sumAll = unf.reduce((a, r) => a + n(r.amount), 0); console.log('net of all amounts', sumAll.toFixed(2))
// scope split
const perIds = Object.keys(per); let perRows = 0; const seen = new Set<string>(); for (const id of perIds) for (const r of per[id]) { perRows++; seen.add(r.id) }
console.log('per-location pulls: locations', perIds.length, 'rows', perRows, 'unique', seen.size, 'rows in unfiltered not in any per-location pull:', unf.filter((r) => !seen.has(r.id)).length)
const rest = unf.filter((r) => !seen.has(r.id)); const restBlank = rest.filter((r) => (r.locationName ?? '-').trim() === '-'); console.log('  remainder blank-name (agency-level):', restBlank.length, ' named non-listed:', rest.length - restBlank.length)
// per-location: locationName stable? usage sum
const re = /\/location\/([A-Za-z0-9]+)/
const tx = load().filter((x) => x.entitySourceSubType === 'saas_one_time' && x.status === 'succeeded')
const sep = (x: any) => x.chargeSnapshot?.submitTimeUTC?.slice(0, 7) === '2026-09'
const rech = new Map<string, number>(), rechN = new Map<string, number>()
for (const x of tx.filter(sep)) { const id = re.exec(x.entitySourceMeta?.description ?? '')?.[1]; if (!id) continue; rech.set(id, (rech.get(id) ?? 0) + cents(x.chargeSnapshot?.settleAmount ?? x.amount)); rechN.set(id, (rechN.get(id) ?? 0) + 1) }
let nameOk = 0, withRows = 0, equal = 0, close = 0; const diffs: string[] = []
let usageTot = 0, cashTot = 0
for (const id of perIds) {
  const rows = per[id]; if (!rows.length) continue; withRows++
  const names = new Set(rows.map((r) => r.locationName)); if (names.size === 1) nameOk++
  const usage = rows.filter((r) => n(r.amount) < 0 && !/recharge/i.test(r.description)).reduce((a, r) => a + n(r.amount), 0)
  const walletRecharge = rows.filter((r) => n(r.amount) > 0).reduce((a, r) => a + n(r.amount), 0)
  usageTot += usage; const gc = (rech.get(id) ?? 0) / 100; cashTot += gc
  if (Math.abs(walletRecharge - gc) < 0.02) equal++; else if (Math.abs(walletRecharge - gc) < 1) close++; else diffs.push(`${id.slice(0, 4)}: wallet +${walletRecharge.toFixed(2)} vs GHL card ${gc.toFixed(2)} (n=${rechN.get(id) ?? 0})`)
}
console.log('\nlocations with Sep rows', withRows, '; single locationName across rows', nameOk, '; wallet recharge == GHL card recharge (<$0.02)', equal, ' (<$1)', close, ' other', diffs.length)
console.log(diffs.slice(0, 12).join('\n'))
console.log('member+HQ usage (negative non-recharge rows) Sep:', usageTot.toFixed(2), ' GHL card recharges parsed Sep:', cashTot.toFixed(2))
console.log('desc samples of positive rows (redacted prefix):', [...new Set(unf.filter((r) => n(r.amount) > 0).map((r) => String(r.description).replace(/\d.*/, '#').slice(0, 45)))].slice(0, 8))
// mismatch: rows with location-name but positive (recharge) in agency scope
const agency = unf.filter((r) => (r.locationName ?? '-').trim() === '-')
console.log('agency-level (blank name) rows', agency.length, 'sum', agency.reduce((a, r) => a + n(r.amount), 0).toFixed(2), 'categories', [...new Set(agency.map((r) => parseWalletCategory(r.description)))].join(','))
const ar = unf.filter((r) => /Recharge for Agency/i.test(r.description)); console.log('agency recharge rows', ar.length, 'sum', ar.reduce((a, r) => a + n(r.amount), 0).toFixed(2))
// original vs amount relationship
const rel = new Map<string, number>(); unf.filter((r) => n(r.amount) < 0).forEach((r) => { const o = n(r.originalAmount), a = -n(r.amount), d = n(r.discountAmount); const k = Math.abs(o - d - a) < 1e-4 ? 'amount = original - discount' : Math.abs(o - a) < 1e-4 ? 'amount = original' : 'other'; rel.set(k, (rel.get(k) ?? 0) + 1) }); console.log([...rel])
