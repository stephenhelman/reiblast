import fs from 'node:fs'
const out = __dirname + '/output/'
const den = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Denver' }).replace(' ', 'T')
const d = JSON.parse(fs.readFileSync(out + 'tx_2026-08-19_2026-09-30.json', 'utf8')).data as any[]
// full-window rows per Denver date vs single-day pulls
for (const day of ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-30']) console.log(day, 'in full pull by Denver createdAt date:', d.filter((x) => den(x.createdAt).slice(0, 10) === day).length, ' by UTC date:', d.filter((x) => x.createdAt.slice(0, 10) === day).length)
// charge id prefixes
const pre = new Map<string, number>(); d.forEach((x) => { const k = String(x.chargeId).length + ':' + String(x.chargeId).slice(0, 4); pre.set(k, (pre.get(k) ?? 0) + 1) }); console.log('chargeId len:prefix', [...pre].sort())
const short = d.filter((x) => String(x.chargeId).length < 12 && x.chargeId !== '0'); console.log('short ids dates', short.map((x) => x.createdAt.slice(0, 10) + ' ' + x.chargeSnapshot.transactionType + ' ' + x.status).slice(0, 20))
// ids by date (monotonic?)
const byDate = d.filter((x) => String(x.chargeId).length === 12).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); console.log('first/last 12-digit ids', byDate[0].createdAt.slice(0, 10), byDate[0].chargeId, byDate.at(-1)!.createdAt.slice(0, 10), byDate.at(-1)!.chargeId)
// amount vs settle
const diff = d.filter((x) => x.chargeSnapshot?.settleAmount !== undefined && Math.abs(x.amount - x.chargeSnapshot.settleAmount) > 0.0001)
const kinds = new Map<string, number>(); diff.forEach((x) => { const k = x.chargeSnapshot.transactionType + '|' + x.status + '| amount=' + (x.amount === 0 ? '0' : x.amount % 1 === 0 ? 'int' : 'frac') + ' settle=' + x.chargeSnapshot.settleAmount + (x.chargeSnapshot.transactionType === 'authCaptureTransaction' ? '(rounded)' : ''); const kk = x.chargeSnapshot.transactionType === 'authCaptureTransaction' ? x.chargeSnapshot.transactionType + '|' + x.status + '|rounding' : k; kinds.set(kk, (kinds.get(kk) ?? 0) + 1) }); console.log('amount != settle:', [...kinds])
const ao = d.filter((x) => x.chargeSnapshot?.transactionType === 'authOnlyTransaction'); console.log('authOnly authAmount/settleAmount values', JSON.stringify([...new Set(ao.map((x) => x.chargeSnapshot.authAmount + '/' + x.chargeSnapshot.settleAmount))]))
const ac = d.filter((x) => x.chargeSnapshot?.transactionType === 'authCaptureTransaction' && x.status === 'succeeded')
console.log('succ authCapture: max |amount - settle|', Math.max(...ac.map((x) => Math.abs(x.amount - x.chargeSnapshot.settleAmount))).toFixed(4), ' settle==round2(amount)', ac.filter((x) => Math.abs(x.chargeSnapshot.settleAmount - Math.round(x.amount * 100) / 100) < 1e-9).length, '/', ac.length)
// settled status by age
const old = d.filter((x) => x.createdAt < '2026-09-01'); console.log('rows created before Sep 1:', old.length, 'statuses', JSON.stringify([...new Set(old.map((x) => x.chargeSnapshot?.transactionStatus))]))
const lag = d.filter((x) => (+new Date(x.updatedAt) - +new Date(x.createdAt)) / 1000 > 5); console.log('rows updated >5s after create:', lag.map((x) => ((+new Date(x.updatedAt) - +new Date(x.createdAt)) / 1000).toFixed(0) + 's ' + x.status + ' ' + (x.chargeSnapshot?.transactionType ?? '-')))
// failures: reason descriptions (no PII)
const f = new Map<string, number>(); d.filter((x) => x.status === 'failed').forEach((x) => { const k = x.chargeSnapshot?.responseReasonCode + ' ' + x.chargeSnapshot?.responseReasonDescription; f.set(k, (f.get(k) ?? 0) + 1) }); console.log([...f])
// aug 19 oddities
console.log('Aug19 succeeded authCapture:', d.filter((x) => den(x.createdAt).slice(0, 10) === '2026-08-19' && x.status === 'succeeded').map((x) => `${x.chargeId} $${x.amount} ${x.chargeSnapshot?.transactionType ?? '-'} ${x.chargeSnapshot?.transactionStatus ?? '-'} ${x.chargeSnapshot?.failedToFetchTxnDet ?? ''}`))
console.log('settleAmount missing', d.filter((x) => x.chargeSnapshot?.settleAmount === undefined).length)
