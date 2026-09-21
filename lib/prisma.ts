import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Local/dev runtime (NODE_ENV !== 'production') reads SEED_DATABASE_URL so
// nothing running on a developer's machine ever touches live data;
// production reads DATABASE_URL. Fail-closed: a missing SEED_DATABASE_URL in
// non-prod throws rather than falling back to DATABASE_URL, since that
// fallback would silently point a dev process at prod.
function resolveDatasourceUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set in production.')
    return url
  }
  const url = process.env.SEED_DATABASE_URL
  if (!url) {
    throw new Error(
      'SEED_DATABASE_URL is not set — refusing to fall back to DATABASE_URL outside production.',
    )
  }
  return url
}

const datasourceUrl = resolveDatasourceUrl()

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
