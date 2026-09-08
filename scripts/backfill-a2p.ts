import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

const prisma = new PrismaClient()

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const A2P_CUSTOM_FIELD_ID = 'QzLdh2Dyocer6kmTGxUH'
const THROTTLE_MS = 300

const COMMIT = process.argv.includes('--commit')

function hqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  }
}

function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  console.error(`  [backfill-a2p] Malformed phone value, will write null: "${raw}"`)
  return null
}

type GhlCustomField = { id: string; value?: string; fieldValue?: string }

function readCustomField(fields: GhlCustomField[] | undefined, id: string): string | undefined {
  const field = fields?.find((f) => f.id === id)
  return field?.value ?? field?.fieldValue
}

async function fetchContact(contactId: string): Promise<{
  phone: string | null
  customFields: GhlCustomField[] | undefined
} | null> {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${contactId}`, {
    headers: hqHeaders(),
  })

  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`GHL contact fetch failed (${res.status}): ${await res.text()}`)
  }

  const data = await res.json()
  const contact = data.contact
  return {
    phone: contact?.phone ?? null,
    customFields: contact?.customFields,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log(`[backfill-a2p] Mode: ${COMMIT ? 'COMMIT (writing to DB)' : 'DRY RUN (no writes)'}`)

  const users = await prisma.user.findMany({
    select: { id: true, ghlContactId: true, businessPhone: true, a2pPhone: true },
  })

  let total = 0
  let written = 0
  let contactNotFound = 0
  let noContactId = 0
  let failed = 0
  let loggedCustomFieldsShape = false

  for (const user of users) {
    if (!user.ghlContactId) {
      noContactId++
      continue
    }

    total++

    try {
      const contact = await fetchContact(user.ghlContactId)

      if (!contact) {
        contactNotFound++
        console.log(`[${user.ghlContactId}] contact not found in GHL — skipping`)
        continue
      }

      if (!loggedCustomFieldsShape) {
        console.log('[backfill-a2p] Raw customFields from first fetched contact:')
        console.log(JSON.stringify(contact.customFields, null, 2))
        loggedCustomFieldsShape = true
      }

      const newBusinessPhone = normalizeToE164(contact.phone)
      const rawA2pField = readCustomField(contact.customFields, A2P_CUSTOM_FIELD_ID)
      const newA2pPhone = normalizeToE164(rawA2pField)

      console.log(
        `[${user.ghlContactId}] current: businessPhone=${user.businessPhone ?? 'null'} a2pPhone=${user.a2pPhone ?? 'null'}` +
          ` | ghl raw: phone=${contact.phone ?? 'null'} customField=${rawA2pField ?? 'null'}` +
          ` | will write: businessPhone=${newBusinessPhone ?? 'null'} a2pPhone=${newA2pPhone ?? 'null'}`,
      )

      if (COMMIT) {
        await prisma.user.update({
          where: { id: user.id },
          data: { businessPhone: newBusinessPhone, a2pPhone: newA2pPhone },
        })
        written++
      }
    } catch (err) {
      failed++
      console.error(`[${user.ghlContactId}] FAILED:`, err)
    }

    await sleep(THROTTLE_MS)
  }

  console.log('\n[backfill-a2p] Summary')
  console.log(`  total considered:   ${total}`)
  console.log(`  written:            ${COMMIT ? written : 0} ${COMMIT ? '' : '(dry run — nothing written)'}`)
  console.log(`  contact-not-found:  ${contactNotFound}`)
  console.log(`  no-contact-id:      ${noContactId}`)
  console.log(`  failed:             ${failed}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
