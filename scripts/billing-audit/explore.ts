import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync(__dirname + '/output/tx_2026-08-19_2026-09-30.json', 'utf8')).data as any[]
const keys = new Map<string, number>()
const walk = (o: any, p: string) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) { keys.set(p + k, (keys.get(p + k) ?? 0) + 1); if (k !== 'entitySourceMeta') walk(o[k], p + k + '.') } }
d.forEach((x) => walk(x, ''))
for (const [k, n] of [...keys].sort()) console.log(String(n).padStart(4), k)
const red = (o: any): any => JSON.parse(JSON.stringify(o, (k, v) => (/email|phone|name|address|contactId|cardholder|last4|lastFour|firstName|lastName|zip|city|description/i.test(k) && typeof v === 'string' ? '<redacted>' : v)))
console.log(JSON.stringify(red(d.find((x) => x.chargeSnapshot?.transactionType === 'authCaptureTransaction' && x.status === 'succeeded')), null, 1).slice(0, 6000))
