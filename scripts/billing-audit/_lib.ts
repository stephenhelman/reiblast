import fs from 'node:fs'
export const load = (f = 'tx_2026-08-19_2026-09-30.json') => JSON.parse(fs.readFileSync(__dirname + '/output/' + f, 'utf8')).data as any[]
// Denver wall-clock parts for an instant
export function denver(iso: string) {
  const s = new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Denver' }) // 'YYYY-MM-DD HH:mm:ss'
  return { date: s.slice(0, 10), hour: +s.slice(11, 13), ymdhms: s }
}
/** Kurv batch date: window = 5pm Denver prev day → 5pm Denver batch date. Saturday-dated windows are labeled Sunday. */
export function batchDate(submitUtc: string): string {
  const d = denver(submitUtc)
  let dt = new Date(d.date + 'T00:00:00Z')
  if (d.hour >= 17) dt = new Date(+dt + 864e5)
  if (dt.getUTCDay() === 6) dt = new Date(+dt + 864e5)
  return dt.toISOString().slice(0, 10)
}
export const cents = (n: number) => Math.round(n * 100)
export const usd = (c: number) => (c / 100).toFixed(2)
export const isCapOk = (x: any) => x.status === 'succeeded' && x.chargeSnapshot?.transactionType === 'authCaptureTransaction' && x.chargeId !== '0'
