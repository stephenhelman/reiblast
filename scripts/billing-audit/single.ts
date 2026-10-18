import { load } from './_lib'
import { BASE, HQ, HQ_KEY } from './_env'
async function main() {
  const d = load(); const pick = [d.find((x) => x.status === 'succeeded' && x.chargeSnapshot?.transactionType === 'authCaptureTransaction'), d.find((x) => x.status === 'failed'), d.find((x) => x.chargeSnapshot?.transactionType === 'authOnlyTransaction')]
  for (const x of pick) {
    const r = await fetch(`${BASE}/payments/transactions/${x._id}?altId=${HQ}&altType=location`, { headers: { Authorization: `Bearer ${HQ_KEY}`, Version: 'v3', Accept: 'application/json' } })
    const j = await r.json(); const rec = Array.isArray(j) ? j[0] : j
    const cs = rec.chargeSnapshot
    console.log(r.status, 'array?', Array.isArray(j), 'chargeSnapshot present', !!cs, 'keys', cs ? Object.keys(cs).filter((k) => ['settleAmount', 'submitTimeUTC', 'transactionType', 'transactionStatus', 'AVSResponse', 'payment', 'responseReasonDescription', 'transId'].includes(k)).join(',') : '-', '| top-level has chargeId', 'chargeId' in rec, 'paymentMethod', !!rec.paymentMethod, 'fulfilledAt', !!rec.fulfilledAt, 'topkeys', Object.keys(rec).length)
  }
}
main()
