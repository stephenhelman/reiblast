import fs from 'node:fs'
const out = __dirname + '/output/'
const den = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Denver' }).replace(' ', 'T')
for (const [a, b] of [['2026-09-21', '2026-09-22'], ['2026-09-30', '2026-10-01'], ['2026-10-01', '2026-10-02'], ['2026-08-18', '2026-08-19']]) {
  const d = JSON.parse(fs.readFileSync(out + `day_${a}_${b}.json`, 'utf8')).data as any[]
  const ds = d.map((x) => den(x.fulfilledAt)).sort(), us = d.map((x) => x.fulfilledAt).sort()
  console.log(a, '->', b, 'rows', d.length, '| Denver fulfilledAt', ds[0]?.slice(0, 16), '..', ds.at(-1)?.slice(0, 16), '| UTC', us[0]?.slice(0, 16), '..', us.at(-1)?.slice(0, 16))
}
