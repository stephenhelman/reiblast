/**
 * One-time backfill: fetches the GHL location API key for every User
 * that has a ghlLocationId but no ghlLocationApiKey, and stores it.
 *
 * Run with:
 *   npx tsx prisma/backfill-location-keys.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

async function getLocationApiKey(locationId: string): Promise<string | null> {
  const res = await fetch(`${GHL_BASE_URL}/locations/${locationId}`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    },
  })
  if (!res.ok) {
    console.error(`  GHL error ${res.status} for location ${locationId}:`, await res.text())
    return null
  }
  const data = await res.json()
  return data?.location?.apiKey ?? data?.apiKey ?? null
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      ghlLocationId: { not: null },
      ghlLocationApiKey: null,
    },
    select: { id: true, email: true, ghlLocationId: true },
  })

  console.log(`Found ${users.length} user(s) to backfill.`)

  for (const user of users) {
    console.log(`\nProcessing ${user.email} — locationId: ${user.ghlLocationId}`)
    const apiKey = await getLocationApiKey(user.ghlLocationId!)

    if (!apiKey) {
      console.warn(`  ⚠ No API key returned — skipping.`)
      continue
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { ghlLocationApiKey: apiKey },
    })
    console.log(`  ✓ Stored API key (${apiKey.slice(0, 8)}…)`)
  }

  console.log('\nBackfill complete.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
