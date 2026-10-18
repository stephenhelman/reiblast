import { load, batchDate, cents, usd, isCapOk } from './_lib'
const d = load()
const ok = d.filter(isCapOk)
const m = new Map<string, { n: number; c: number; ids: string[] }>()
for (const x of ok) { const k = batchDate(x.chargeSnapshot.submitTimeUTC); const o = m.get(k) ?? { n: 0, c: 0, ids: [] }; o.n++; o.c += cents(x.chargeSnapshot.settleAmount); m.set(k, o) }
const days = [...m.keys()].sort()
let n = 0, c = 0
for (const k of days) { if (k >= '2026-08-19' && k <= '2026-09-30') { n += m.get(k)!.n; c += m.get(k)!.c } }
console.log('successful authCapture (excluding chargeId 0), batch date 08-19..09-30:', n, '$' + usd(c))
console.log('all successful authCapture incl. after 09-30 batch:', ok.length, '$' + usd(ok.reduce((s, x) => s + cents(x.chargeSnapshot.settleAmount), 0)))
for (const k of days.filter((k) => k >= '2026-09-15' && k <= '2026-10-02')) console.log(k, new Date(k + 'T00:00:00Z').toUTCString().slice(0, 3), m.get(k)!.n, '$' + usd(m.get(k)!.c))
const sum = (ks: string[]) => ks.reduce((a, k) => ({ n: a.n + (m.get(k)?.n ?? 0), c: a.c + (m.get(k)?.c ?? 0) }), { n: 0, c: 0 })
console.log('Sep20', sum(['2026-09-20']), 'Sep21', sum(['2026-09-21']), 'Sep22', sum(['2026-09-22']))
// also with amount (unrounded) and without exclusions
const amt = ok.filter((x) => batchDate(x.chargeSnapshot.submitTimeUTC) <= '2026-09-30').reduce((s, x) => s + x.amount, 0)
console.log('sum of raw amount (fractional) same set:', amt.toFixed(4))
// the zero-id and Aug 19
console.log('chargeId0 rows', d.filter((x) => x.chargeId === '0').map((x) => `${x.createdAt.slice(0,16)} $${x.amount} ${x.status}`))
// also who's in Aug 19 batch
for (const k of days.slice(0, 3)) console.log(k, m.get(k))
// 12-digit vs short ids in ok
console.log('ok rows with 11-digit id', ok.filter((x) => String(x.chargeId).length === 11).length)
