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
  address: string,
  latitude: number,
  longitude: number,
  radius: number = 0.5,
  months: number = 6
) {
  const maxAge = months * 30
  const res = await fetch(
    `${RENTCAST_BASE}/avm/sales/comps?address=${encodeURIComponent(address)}&latitude=${latitude}&longitude=${longitude}&radius=${radius}&maxAge=${maxAge}&limit=25`,
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
