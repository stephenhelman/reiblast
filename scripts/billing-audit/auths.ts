import { load, denver } from './_lib'
const d = load().filter((x) => x.chargeId !== '0')
const mon = (x: any, tz: 'utc' | 'den') => (tz === 'utc' ? x.chargeSnapshot.submitTimeUTC.slice(0, 7) : denver(x.chargeSnapshot.submitTimeUTC).date.slice(0, 7))
for (const tz of ['utc', 'den'] as const) for (const mo of ['2026-08', '2026-09']) {
  const r = d.filter((x) => mon(x, tz) === mo)
  const cap = r.filter((x) => x.chargeSnapshot.transactionType === 'authCaptureTransaction')
  const ao = r.filter((x) => x.chargeSnapshot.transactionType === 'authOnlyTransaction')
  const capOk = cap.filter((x) => x.status === 'succeeded'), capFail = cap.filter((x) => x.status === 'failed')
  const avsReal = (xs: any[]) => xs.filter((x) => x.chargeSnapshot.AVSResponse && x.chargeSnapshot.AVSResponse !== '-').length
  const amexAll = r.filter((x) => x.chargeSnapshot.payment.creditCard.cardType === 'AmericanExpress').length
  console.log(tz, mo, '| capture attempts', cap.length, '(ok', capOk.length, 'fail', capFail.length, ') authOnly', ao.length, '=> cap+2*ao', cap.length + 2 * ao.length, '| cap+ao', cap.length + ao.length, '| AVS present: cap', avsReal(cap), 'ao', avsReal(ao), 'all', avsReal(r), '| rows', r.length, 'amex rows', amexAll)
}
// AVS code distribution by type
const t = new Map<string, number>(); d.forEach((x) => { const k = x.chargeSnapshot.transactionType + '|' + x.status + '|' + (x.chargeSnapshot.AVSResponse ?? '-'); t.set(k, (t.get(k) ?? 0) + 1) }); console.log([...t].sort())
