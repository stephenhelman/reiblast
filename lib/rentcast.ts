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
    saleDateRange: '365',
    limit: '50',
  })
  const url = `${RENTCAST_BASE}/properties?${params}`
  console.log('[rentcast/getSalesComps] URL:', url)

  const res = await fetch(url, {
    headers: {
      'X-Api-Key': process.env.RENTCAST_API_KEY!,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })

  console.log('[rentcast/getSalesComps] status:', res.status)
  const rawText = await res.text()
  console.log('[rentcast/getSalesComps] raw body:', rawText)

  if (!res.ok) throw new Error(`Rentcast ${res.status}: ${rawText}`)

  const data = JSON.parse(rawText)
  const records: unknown[] = Array.isArray(data) ? data : []

  if (records.length === 0) {
    console.log('[rentcast/getSalesComps] Rentcast returned 0 results')
  }

  return records
}
