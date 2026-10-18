import { load, batchDate, denver, cents, usd, isCapOk } from './_lib'
const all = load().filter((x) => x.chargeId !== '0')
const UNSETTLED = '121785351029' // one of the two Aug 19 $57 charges (ambiguous which; both Visa/MC, fee effect identical unless brands differ)
const ok = all.filter(isCapOk).filter((x) => x.chargeId !== UNSETTLED)
const depMonth = (b: string) => (b <= '2026-08-30' ? 'Aug' : b <= '2026-09-29' ? 'Sep' : null)
const actual: any = {
  Aug: { sales: 47, vol: 949.71, discount: 27.55, daily: 15.87, monthly: 66.07, authFees: 56.8, brandAuths: 201, avs: 166, reserve: 94.98 },
  Sep: { sales: 194, vol: 4195.12, discount: 121.67, daily: 66.67, monthly: 176.56, authFees: 109.6, brandAuths: 408, avs: 280, reserve: 419.53 },
}
const f2 = (n: number) => n.toFixed(2)
console.log('Amex among succeeded:', ok.filter((x) => x.chargeSnapshot.payment.creditCard.cardType === 'AmericanExpress').length)
for (const mo of ['Aug', 'Sep'] as const) {
  const rows = ok.filter((x) => depMonth(batchDate(x.chargeSnapshot.submitTimeUTC)) === mo)
  const V = rows.reduce((s, x) => s + x.chargeSnapshot.settleAmount, 0)
  const N = rows.length, Nam = rows.filter((x) => x.chargeSnapshot.payment.creditCard.cardType === 'AmericanExpress').length
  const B = new Set(rows.map((x) => batchDate(x.chargeSnapshot.submitTimeUTC))).size
  const a = actual[mo]
  console.log(`\n=== ${mo} deposits ===  sales ${N} (actual ${a.sales}) volume ${f2(V)} (actual ${a.vol}) batches ${B} amex ${Nam}`)
  const row = (name: string, pred: number, act: number) => console.log(name.padEnd(46), 'pred', f2(pred).padStart(8), ' actual', f2(act).padStart(8), ' diff', f2(pred - act).padStart(7), ((100 * (pred - act)) / act).toFixed(1).padStart(6) + '%')
  row('discount 2.9% x volume', 0.029 * V, a.discount)
  const naive = 0.2 * N + 0.35 * B + 0.004 * V
  const brand = 0.2 * (N - Nam) + 0.35 * B + 0.004 * V
  row('daily fees (naive: $0.20 on all items)', naive, a.daily)
  row('daily fees (brand-aware: Amex excluded)', brand, a.daily)
  console.log('   components: per-item', f2(0.2 * (N - Nam)), 'per-batch', f2(0.35 * B), 'downgrade 0.4%', f2(0.004 * V), '| implied actual residual if per-item+downgrade fixed ->', 'batches implied', ((a.daily - 0.2 * (N - Nam) - 0.004 * V) / 0.35).toFixed(1))
  row('reserve 10% x volume', 0.1 * V, a.reserve)
  // monthly
  const mrows = all.filter((x) => denver(x.chargeSnapshot.submitTimeUTC).date.slice(0, 7) === (mo === 'Aug' ? '2026-08' : '2026-09'))
  const caps = mrows.filter((x) => x.chargeSnapshot.transactionType === 'authCaptureTransaction').length, ao = mrows.filter((x) => x.chargeSnapshot.transactionType === 'authOnlyTransaction').length
  const auths = caps + 2 * ao
  const zip = (x: any) => !!(x.chargeSnapshot.billTo?.zip || x.chargeSnapshot.billTo?.address)
  const avs2 = mrows.reduce((s, x) => s + (zip(x) ? (x.chargeSnapshot.transactionType === 'authOnlyTransaction' ? 2 : 1) : 0), 0)
  const avs1 = mrows.filter(zip).length
  console.log(`   auth counts (Denver calendar month of submitTime): capture attempts ${caps}, authOnly ${ao} -> auths ${auths} (actual ${a.brandAuths}); AVS(zip, authOnly x2) ${avs2} / x1 ${avs1} (actual ${a.avs})`)
  const authFees = 0.2 * auths + 0.1 * avs2
  row('monthly auth fees ($0.20/auth + $0.10/AVS)', authFees, a.authFees)
  const brandFee = 0.006 * V
  row('monthly debit total (auth + 0.6% + $43.20)', authFees + brandFee + 43.2, a.monthly)
  console.log('   actual residual after auth fees:', f2(a.monthly - a.authFees), ' vs 0.6% brand fees only:', f2(brandFee), ' vs 0.6% + 43.20:', f2(brandFee + 43.2))
  const totalPred = 0.029 * V + brand
  const totalAct = a.discount + a.daily
  row('daily deductions total (discount + daily fees)', totalPred, totalAct)
  const netDeposit = (v: number, disc: number, daily: number, res: number) => v - disc - daily - res
  console.log('   net deposit pred', f2(netDeposit(V, 0.029 * V, brand, 0.1 * V)), ' actual', f2(netDeposit(a.vol, a.discount, a.daily, a.reserve)))
}
