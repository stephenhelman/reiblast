import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync(__dirname + '/output/tx_2026-08-19_2026-09-30.json', 'utf8')).data as any[]
const cnt = (f: (x: any) => string) => { const m = new Map<string, number>(); d.forEach((x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]) }
const show = (t: string, r: [string, number][]) => { console.log('\n## ' + t); r.forEach(([k, n]) => console.log(String(n).padStart(4), k)) }
console.log('rows', d.length)
show('status | subtype | txType | txStatus', cnt((x) => [x.status, x.entitySourceSubType ?? '-', x.chargeSnapshot?.transactionType ?? '-', x.chargeSnapshot?.transactionStatus ?? '-'].join(' | ')))
show('cardType (snapshot)', cnt((x) => x.chargeSnapshot?.payment?.creditCard?.cardType ?? '-'))
show('paymentMethod.card.brand', cnt((x) => x.paymentMethod?.card?.brand ?? '-'))
show('liveMode/provider/acct', cnt((x) => [x.liveMode, x.paymentProviderType, x.paymentProviderConnectedAccount].join('|')))
show('entityType', cnt((x) => x.entityType))
show('responseCode/reasonCode', cnt((x) => [x.chargeSnapshot?.responseCode, x.chargeSnapshot?.responseReasonCode].join('/')))
show('AVS', cnt((x) => x.chargeSnapshot?.AVSResponse ?? '-'))
show('amountRefunded>0', cnt((x) => String(x.amountRefunded > 0)))
show('chargeId shape', cnt((x) => /^121[78]\d{9}$/.test(String(x.chargeId)) ? '12-digit 1217/1218' : /^\d{12}$/.test(String(x.chargeId)) ? 'other 12-digit' : String(x.chargeId)))
show('chargeId==transId', cnt((x) => String(x.chargeId === x.chargeSnapshot?.transId)))
// date edge
const den = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
const utc = (iso: string) => iso.slice(0, 10)
const mm = (f: (x: any) => string) => { const v = d.map(f).sort(); return v[0] + ' .. ' + v[v.length - 1] }
console.log('\ncreatedAt UTC date range', mm((x) => utc(x.createdAt)), '| Denver', mm((x) => den(x.createdAt)))
console.log('fulfilledAt UTC date range', mm((x) => utc(x.fulfilledAt)), '| Denver', mm((x) => den(x.fulfilledAt)))
console.log('submitTimeUTC UTC range', mm((x) => x.chargeSnapshot?.submitTimeUTC ?? '9999'), )
console.log('rows w/ createdAt UTC date outside window', d.filter((x) => utc(x.createdAt) < '2026-08-19' || utc(x.createdAt) > '2026-09-30').length, ' Denver-outside', d.filter((x) => den(x.createdAt) < '2026-08-19' || den(x.createdAt) > '2026-09-30').length)
console.log('rows w/ fulfilledAt UTC outside', d.filter((x) => utc(x.fulfilledAt) < '2026-08-19' || utc(x.fulfilledAt) > '2026-09-30').length, ' Denver-outside', d.filter((x) => den(x.fulfilledAt) < '2026-08-19' || den(x.fulfilledAt) > '2026-09-30').length)
// updated vs created
const lag = d.map((x) => (+new Date(x.updatedAt) - +new Date(x.createdAt)) / 1000)
console.log('\nupdatedAt-createdAt s: min', Math.min(...lag), 'max', Math.max(...lag), 'rows lag>60s', lag.filter((v) => v > 60).length, ' >1day', lag.filter((v) => v > 86400).length)
const fl = d.map((x) => (+new Date(x.fulfilledAt) - +new Date(x.createdAt)) / 1000)
console.log('fulfilledAt-createdAt s: min', Math.min(...fl), 'max', Math.max(...fl))
const sub = d.map((x) => x.chargeSnapshot?.submitTimeUTC ? (+new Date(x.createdAt) - +new Date(x.chargeSnapshot.submitTimeUTC)) / 1000 : NaN).filter((v) => !isNaN(v))
console.log('createdAt-submitTimeUTC s: min', Math.min(...sub), 'max', Math.max(...sub))
// authOnly
const ao = d.filter((x) => x.chargeSnapshot?.transactionType === 'authOnlyTransaction')
console.log('\nauthOnly rows', ao.length, 'amounts', JSON.stringify([...new Set(ao.map((x) => x.amount))]), 'statuses', JSON.stringify([...new Set(ao.map((x) => x.status + '/' + x.chargeSnapshot.transactionStatus))]))
console.log('any voidTransaction rows', d.filter((x) => /void/i.test(x.chargeSnapshot?.transactionType ?? '')).length)
console.log('authOnly with entitySourceSubType', JSON.stringify([...new Set(ao.map((x) => x.entitySourceSubType ?? '-'))]), 'with subscriptionId', ao.filter((x) => x.subscriptionId).length)
// does a second row for same contact/profile within 10 min follow authOnly?
const byProf = new Map<string, any[]>(); d.forEach((x) => { const k = x.chargeSnapshot?.profile?.customerPaymentProfileId; if (k) (byProf.get(k) ?? byProf.set(k, []).get(k)!).push(x) })
let followed = 0, sameAmt = 0
for (const x of ao) { const rel = (byProf.get(x.chargeSnapshot.profile.customerPaymentProfileId) ?? []).filter((y) => y._id !== x._id && Math.abs(+new Date(y.createdAt) - +new Date(x.createdAt)) < 3600e3); if (rel.length) followed++; if (rel.some((y) => y.amount === x.amount)) sameAmt++ }
console.log('authOnly with another row on same payment profile ±1h:', followed, ' same amount:', sameAmt)
// saas_one_time regex
const so = d.filter((x) => x.entitySourceSubType === 'saas_one_time')
const re = /\/location\/([A-Za-z0-9]+)/
console.log('\nsaas_one_time', so.length, 'with description', so.filter((x) => x.entitySourceMeta?.description).length, 'regex-parsed', so.filter((x) => re.test(x.entitySourceMeta?.description ?? '')).length, 'status succ', so.filter((x) => x.status === 'succeeded').length, 'succ&parsed', so.filter((x) => x.status === 'succeeded' && re.test(x.entitySourceMeta?.description ?? '')).length)
const unparsed = so.filter((x) => !re.test(x.entitySourceMeta?.description ?? ''))
show('unparsed saas_one_time descriptions (prefix)', (() => { const m = new Map<string, number>(); unparsed.forEach((x) => { const k = String(x.entitySourceMeta?.description ?? '-').replace(/\s*\d.*$/, '').slice(0, 40); m.set(k, (m.get(k) ?? 0) + 1) }); return [...m].sort((a, b) => b[1] - a[1]) })())
console.log('distinct parsed locationIds', new Set(so.map((x) => re.exec(x.entitySourceMeta?.description ?? '')?.[1]).filter(Boolean)).size)
// description sample shape redacted
const s = so.find((x) => re.test(x.entitySourceMeta?.description ?? ''))
console.log('desc shape:', s.entitySourceMeta.description.replace(/\/location\/[A-Za-z0-9]+/, '/location/<ID>').replace(/for .*? at/i, 'for <biz> at').slice(0, 200))
// settlement status
show('transactionStatus all', cnt((x) => x.chargeSnapshot?.transactionStatus ?? '-'))
// amount vs settleAmount
const diff = d.filter((x) => x.chargeSnapshot?.settleAmount !== undefined && Math.abs(x.amount - x.chargeSnapshot.settleAmount) > 0.0001)
console.log('\namount != settleAmount rows', diff.length, 'max abs diff', Math.max(...diff.map((x) => Math.abs(x.amount - x.chargeSnapshot.settleAmount))).toFixed(4))
console.log('amount decimals>2:', d.filter((x) => Math.abs(x.amount * 100 - Math.round(x.amount * 100)) > 1e-6).length)
console.log('no-snapshot-type rows:', d.filter((x) => !x.chargeSnapshot?.transactionType).map((x) => [x.chargeId, x.status, x.amount, x.chargeSnapshot?.failedToFetchTxnDet, x.createdAt.slice(0, 10)].join(',')))
