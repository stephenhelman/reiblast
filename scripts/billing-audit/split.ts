import { load, batchDate, cents, usd, isCapOk } from './_lib'
const d = load().filter(isCapOk)
const m = new Map<string, { n: number; c: number }>()
for (const x of d) { const k = batchDate(x.chargeSnapshot.submitTimeUTC); const o = m.get(k) ?? { n: 0, c: 0 }; o.n++; o.c += cents(x.chargeSnapshot.settleAmount); m.set(k, o) }
let n = 0, c = 0
for (const k of [...m.keys()].sort()) { n += m.get(k)!.n; c += m.get(k)!.c; const wd = new Date(k + 'T00:00:00Z').toUTCString().slice(0, 3); if (k >= '2026-08-18' && k <= '2026-09-03') console.log(k, wd, 'batch', m.get(k)!.n, usd(m.get(k)!.c), '| cumulative', n, usd(c)) }
console.log('target Aug deposits: 47 / 949.71 ; Sep: 194 / 4195.12 ; sum 241 / 5144.83')
