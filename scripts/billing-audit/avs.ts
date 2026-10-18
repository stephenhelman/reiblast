import { load, denver } from './_lib'
const d = load().filter((x) => x.chargeId !== '0')
const mon = (x: any) => denver(x.chargeSnapshot.submitTimeUTC).date.slice(0, 7)
const cand: Record<string, (x: any) => number> = {
  'rows non-P AVS': (x) => (x.chargeSnapshot.AVSResponse !== 'P' ? 1 : 0),
  'rows non-P, authOnly x2': (x) => (x.chargeSnapshot.AVSResponse !== 'P' ? (x.chargeSnapshot.transactionType === 'authOnlyTransaction' ? 2 : 1) : 0),
  'succeeded cap + authOnly': (x) => (x.status === 'succeeded' ? 1 : 0),
  'succeeded cap + authOnly x2': (x) => (x.status !== 'succeeded' ? 0 : x.chargeSnapshot.transactionType === 'authOnlyTransaction' ? 2 : 1),
  'AVS Y/Z only': (x) => (['Y', 'Z'].includes(x.chargeSnapshot.AVSResponse) ? 1 : 0),
  'AVS Y/Z/N cap only': (x) => (x.chargeSnapshot.transactionType === 'authCaptureTransaction' && x.chargeSnapshot.AVSResponse !== 'P' ? 1 : 0),
  'all rows': () => 1,
  'all rows, authOnly x2': (x) => (x.chargeSnapshot.transactionType === 'authOnlyTransaction' ? 2 : 1),
  'has billTo.zip or address': (x) => (x.chargeSnapshot.billTo?.zip || x.chargeSnapshot.billTo?.address ? 1 : 0),
  'has zip, authOnly x2': (x) => ((x.chargeSnapshot.billTo?.zip || x.chargeSnapshot.billTo?.address) ? (x.chargeSnapshot.transactionType === 'authOnlyTransaction' ? 2 : 1) : 0),
  'no-zip': (x) => (!x.chargeSnapshot.billTo?.zip ? 1 : 0),
}
console.log('target AVS: Aug 166, Sep 280; auths Aug 201, Sep 408')
for (const [k, f] of Object.entries(cand)) { const s: Record<string, number> = {}; d.forEach((x) => (s[mon(x)] = (s[mon(x)] ?? 0) + f(x))); console.log(k.padEnd(32), 'Aug', s['2026-08'], 'Sep', s['2026-09']) }
// zip presence by AVS and type
const t = new Map<string, number>(); d.forEach((x) => { const k = x.chargeSnapshot.AVSResponse + '|zip=' + !!x.chargeSnapshot.billTo?.zip + '|addr=' + !!x.chargeSnapshot.billTo?.address + '|' + x.chargeSnapshot.transactionType + '|' + x.status; t.set(k, (t.get(k) ?? 0) + 1) }); console.log([...t].sort())
