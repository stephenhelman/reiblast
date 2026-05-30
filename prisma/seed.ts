import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12)

  const user = await prisma.user.upsert({
    where: { email: 'admin@reiblast.app' },
    update: { passwordHash },
    create: {
      email: 'admin@reiblast.app',
      name: 'Admin',
      passwordHash,
      plan: 'core',
      status: 'active',
    },
  })

  console.log(`Seeded admin user: ${user.email} (id: ${user.id})`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
