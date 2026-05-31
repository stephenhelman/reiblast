const RENTCAST_BASE = 'https://api.rentcast.io/v1'

export async function getPropertyDetails(address: string) {
  const res = await fetch(
    `${RENTCAST_BASE}/properties?address=${encodeURIComponent(address)}`,
    {
      headers: {
        'X-Api-Key': process.env.RENTCAST_API_KEY!,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 },
    }
  )
  if (!res.ok) throw new Error('Property not found')
  const data = await res.json()
  return data[0] || null
}

export async function getSalesComps(
  latitude: number,
  longitude: number,
  beds: number,
  sqft: number
) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    radius: '1',
    propertyType: 'Single Family',
    bedrooms: `${beds - 1}:${beds + 1}`,
    squareFootage: `${sqft - 500}:${sqft + 500}`,
    saleDateRange: '*:365',
    limit: '50',
  })
  const res = await fetch(
    `${RENTCAST_BASE}/properties/sale/comps?${params}`,
    {
      headers: {
        'X-Api-Key': process.env.RENTCAST_API_KEY!,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 0 },
    }
  )
  if (!res.ok) throw new Error('Comps not found')
  return res.json()
}
