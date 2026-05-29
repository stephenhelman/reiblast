export async function provisionSubAccount(
  name: string,
  email: string,
  contactId: string,
): Promise<{ locationId: string }> {
  // TODO Phase 2: POST to GHL agency API to create sub-account
  // TODO Phase 2: Apply REIblast Core snapshot to new sub-account
  // TODO Phase 2: Create GHL user with email and temp password
  console.log(`[GHL] Provisioning sub-account for ${email}`)
  return { locationId: `mock-location-${Date.now()}` }
}

export async function suspendSubAccount(locationId: string): Promise<boolean> {
  // TODO Phase 2: PUT to GHL agency API to suspend sub-account
  console.log(`[GHL] Suspending sub-account ${locationId}`)
  return true
}

export async function updateGHLContact(
  contactId: string,
  fields: {
    plan?: string
    status?: string
    locationId?: string
    loginUrl?: string
  },
): Promise<boolean> {
  // TODO Phase 2: PUT to GHL contacts API to update custom fields
  console.log(`[GHL] Updating contact ${contactId}`, fields)
  return true
}
