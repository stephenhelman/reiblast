import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Local/dev runtime (NODE_ENV !== 'production') reads SEED_DATABASE_URL (the
// dev branch) so nothing running on a developer's machine ever touches live
// data; production reads DATABASE_URL. Falls back to DATABASE_URL outside
// production if SEED_DATABASE_URL isn't set, rather than crashing. The
// migrate/seed CLI is unaffected — it still reads DATABASE_URL only, via
// prisma.config.ts.
const datasourceUrl =
  process.env.NODE_ENV !== 'production'
    ? (process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
