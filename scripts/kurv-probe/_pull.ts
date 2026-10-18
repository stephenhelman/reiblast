import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

const BASE = 'https://api.kurv.app/payments'
const OUT = path.join(__dirname, 'output')

export async function pull(prefix: string, start: string, end: string, pauseMs: number) {
  const key = process.env.KURV_LIVE_API_KEY
  if (!key) throw new Error('KURV_LIVE_API_KEY not set')
  fs.mkdirSync(OUT, { recursive: true })
  const all: unknown[] = []
  let page = 1
  let pageCount = 1
  let total = 0
  do {
    const url = `${BASE}?start_date=${start}&end_date=${end}&page=${page}&limit=100`
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
    } catch (e) {
      console.error(`FETCH FAILED for ${BASE}:`, (e as Error).message.replaceAll(key, '<key>'))
      process.exit(1)
    }
    const text = await res.text()
    if (!res.ok) {
      console.error(`HTTP ${res.status} from ${BASE}\nBody: ${text.replaceAll(key, '<key>').slice(0, 2000)}`)
      process.exit(1)
    }
    const json = JSON.parse(text)
    fs.writeFileSync(path.join(OUT, `${prefix}_${String(page).padStart(3, '0')}.json`), JSON.stringify(json, null, 2))
    all.push(...(json.payments ?? []))
    pageCount = json.page_count ?? 1
    total = json.total_count ?? 0
    console.log(`base=${BASE} status=${res.status} page ${page}/${pageCount} total_count=${total} rows=${json.payments?.length ?? 0}`)
    page++
    if (page <= pageCount && pauseMs) await new Promise((r) => setTimeout(r, pauseMs))
  } while (page <= pageCount)
  fs.writeFileSync(path.join(OUT, `${prefix}_all.json`), JSON.stringify({ total_count: total, payments: all }, null, 2))
  console.log(`done: ${all.length} payments collected, total_count=${total}`)
}
