const GHL_BASE = 'https://services.leadconnectorhq.com'

export async function provisionSubAccount(
  name: string,
  email: string,
  contactId: string,
): Promise<string> {
  console.log(`[GHL] provisionSubAccount → name=${name} email=${email} contactId=${contactId}`)

  // Phase 2 implementation:
  // const res = await fetch(`${GHL_BASE}/locations/`, {
  //   method: 'POST',
  //   headers: {
  //     Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  //     'Content-Type': 'application/json',
  //     Version: '2021-07-28',
  //   },
  //   body: JSON.stringify({
  //     name,
  //     email,
  //     snapshotId: process.env.GHL_SNAPSHOT_ID,   // REIblast Core snapshot
  //     companyId: process.env.GHL_COMPANY_ID,
  //   }),
  // })
  // const { location } = await res.json()
  // return location.id

  return `mock-location-${Date.now()}`
}

export async function suspendSubAccount(locationId: string): Promise<boolean> {
  console.log(`[GHL] suspendSubAccount → locationId=${locationId}`)

  // Phase 2 implementation:
  // const res = await fetch(`${GHL_BASE}/locations/${locationId}`, {
  //   method: 'PUT',
  //   headers: {
  //     Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  //     'Content-Type': 'application/json',
  //     Version: '2021-07-28',
  //   },
  //   body: JSON.stringify({ disabled: true }),
  // })
  // return res.ok

  return true
}

export interface GHLContactFields {
  plan?: string
  status?: string
  locationId?: string
  loginUrl?: string
}

export async function updateGHLContact(
  contactId: string,
  fields: GHLContactFields,
): Promise<boolean> {
  console.log(`[GHL] updateGHLContact → contactId=${contactId}`, fields)

  // Phase 2 implementation:
  // Maps fields to GHL custom field keys configured on your location
  // const customFields = [
  //   fields.plan       && { key: 'reiblast_plan',       field_value: fields.plan },
  //   fields.status     && { key: 'reiblast_status',     field_value: fields.status },
  //   fields.locationId && { key: 'reiblast_location_id',field_value: fields.locationId },
  //   fields.loginUrl   && { key: 'reiblast_login_url',  field_value: fields.loginUrl },
  // ].filter(Boolean)
  //
  // const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
  //   method: 'PUT',
  //   headers: {
  //     Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  //     'Content-Type': 'application/json',
  //     Version: '2021-07-28',
  //   },
  //   body: JSON.stringify({ customFields }),
  // })
  // return res.ok

  return true
}
