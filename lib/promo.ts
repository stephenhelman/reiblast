import { prisma } from './prisma'

export interface PromoResult {
  valid: boolean
  discountedPrice: number
  originalPrice: number
  description: string
}

export async function validatePromoCode(code: string): Promise<PromoResult | null> {
  if (!code?.trim()) return null

  try {
    const record = await prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    })

    if (record && record.active) {
      if (record.usageLimit !== null && record.usageCount >= record.usageLimit) {
        return null
      }
      return {
        valid: true,
        discountedPrice: record.discountedPrice,
        originalPrice: record.originalPrice,
        description: record.description ?? '',
      }
    }
  } catch {
    // DB not connected yet — fall through
  }

  return null
}
