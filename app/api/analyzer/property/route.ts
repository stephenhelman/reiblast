import { NextRequest, NextResponse } from 'next/server'
import { getPropertyDetails } from '@/lib/rentcast'

export async function POST(req: NextRequest) {
  let body: { address?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  try {
    const property = await getPropertyDetails(body.address)

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    return NextResponse.json({
      address: property.formattedAddress || body.address,
      city: property.city,
      state: property.state,
      zip: property.zipCode,
      beds: property.bedrooms,
      baths: property.bathrooms,
      sqft: property.squareFootage,
      yearBuilt: property.yearBuilt,
      propertyType: property.propertyType,
      lastSaleDate: property.lastSaleDate,
      lastSalePrice: property.lastSalePrice,
      estimatedValue: property.price,
      latitude: property.latitude,
      longitude: property.longitude,
    })
  } catch (err) {
    console.error('[analyzer/property] error:', err)
    return NextResponse.json({ error: 'Failed to fetch property data' }, { status: 500 })
  }
}
