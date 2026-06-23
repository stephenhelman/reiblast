export interface HeaderMap {
  firstName: number
  lastName: number
  contactName: number
  propertyAddress: number
  city: number
  state: number
  zip: number
  phones: number[]
  phoneTypes: number[]
  email: number
}

export interface CleanedContact {
  firstName: string
  lastName: string
  propertyAddress: string
  city: string
  state: string
  zip: string
  phone: string
  phoneType: string
  email: string
}

export interface CleaningResult {
  contacts: CleanedContact[]
  stats: {
    totalRows: number
    mobileFound: number
    duplicatesRemoved: number
    noPhone: number
    dnc?: number
    ready: number
  }
}

function createHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = {
    firstName: -1,
    lastName: -1,
    contactName: -1,
    propertyAddress: -1,
    city: -1,
    state: -1,
    zip: -1,
    phones: [],
    phoneTypes: [],
    email: -1,
  }

  headers.forEach((h, i) => {
    const n = h.toString().trim().toLowerCase()
    if (n.includes('first') && n.includes('name')) {
      map.firstName = i
    } else if (n.includes('last') && n.includes('name')) {
      map.lastName = i
    } else if (n.includes('contact') && n.includes('name') && n.includes('1')) {
      map.contactName = i
    } else if (
      (n.includes('property') && n.includes('address') && !n.includes('city') && !n.includes('state')) ||
      n === 'address' ||
      n === 'street'
    ) {
      map.propertyAddress = i
    } else if (n.includes('city')) {
      map.city = i
    } else if (n.includes('state')) {
      map.state = i
    } else if ((n.includes('zip') || n.includes('postal')) && !n.includes('recipient')) {
      map.zip = i
    } else if (n.includes('phone') && n.includes('type')) {
      map.phoneTypes.push(i)
    } else if (n.includes('phone') && !n.includes('dnc') && !n.includes('litigator')) {
      map.phones.push(i)
    } else if (n.includes('email')) {
      map.email = i
    }
  })

  return map
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim()
}

function cell(row: string[], index: number): string {
  return index >= 0 ? row[index]?.toString().trim() || '' : ''
}

function extractFullAddress(row: string[], headerMap: HeaderMap): string {
  const parts = [
    cell(row, headerMap.propertyAddress),
    cell(row, headerMap.city),
    cell(row, headerMap.state),
    cell(row, headerMap.zip),
  ].filter(Boolean)
  return parts.join(', ')
}

function parseAddress(
  fullAddress: string,
  row: string[],
  headerMap: HeaderMap
): { street: string; city: string; state: string; zip: string } {
  const streetVal = cell(row, headerMap.propertyAddress)
  const cityVal = cell(row, headerMap.city)
  const stateVal = cell(row, headerMap.state)
  const zipRaw = cell(row, headerMap.zip)
  const zipVal = zipRaw ? zipRaw.split('-')[0] : ''

  if (streetVal && (cityVal || stateVal || zipVal)) {
    return { street: streetVal, city: cityVal, state: stateVal, zip: zipVal }
  }

  // Try: Street, City, ST 00000
  const fullPattern = /^(.+),\s*(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/
  const fullMatch = fullAddress.match(fullPattern)
  if (fullMatch) {
    return {
      street: fullMatch[1].trim(),
      city: fullMatch[2].trim(),
      state: fullMatch[3].trim().toUpperCase(),
      zip: fullMatch[4].split('-')[0],
    }
  }

  // Try: Street, City, ST
  const noZipPattern = /^(.+),\s*(.+),\s*([A-Za-z]{2})$/
  const noZipMatch = fullAddress.match(noZipPattern)
  if (noZipMatch) {
    return {
      street: noZipMatch[1].trim(),
      city: noZipMatch[2].trim(),
      state: noZipMatch[3].trim().toUpperCase(),
      zip: '',
    }
  }

  // Extract zip from end, then state, then split remainder
  let remaining = fullAddress.trim()
  let zip = ''
  let state = ''
  let street = ''
  let city = ''

  const zipMatch = remaining.match(/(\d{5}(?:-\d{4})?)$/)
  if (zipMatch) {
    zip = zipMatch[1].split('-')[0]
    remaining = remaining.slice(0, remaining.length - zipMatch[0].length).trim().replace(/,\s*$/, '')
  }

  const stateMatch = remaining.match(/,?\s*([A-Za-z]{2})\s*$/)
  if (stateMatch) {
    state = stateMatch[1].toUpperCase()
    remaining = remaining.slice(0, remaining.length - stateMatch[0].length).trim()
  }

  const parts = remaining.split(',')
  if (parts.length >= 2) {
    street = parts[0].trim()
    city = parts.slice(1).join(',').trim()
  } else {
    street = remaining
  }

  return { street, city, state, zip }
}

function getFirstAvailableMobilePhone(
  row: string[],
  headerMap: HeaderMap
): { number: string; type: string } {
  for (let i = 0; i < headerMap.phones.length; i++) {
    const phoneVal = cell(row, headerMap.phones[i])
    const typeIdx = headerMap.phoneTypes[i]
    const typeVal = typeIdx !== undefined ? cell(row, typeIdx) : ''
    if (phoneVal && typeVal.toLowerCase() === 'mobile') {
      return { number: phoneVal, type: typeVal }
    }
  }
  return { number: '', type: '' }
}

export function cleanLeads(rows: string[][], headers: string[]): CleaningResult {
  const headerMap = createHeaderMap(headers)
  const seenAddresses = new Set<string>()
  const contacts: CleanedContact[] = []
  const stats = {
    totalRows: rows.length,
    mobileFound: 0,
    duplicatesRemoved: 0,
    noPhone: 0,
    ready: 0,
  }

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]
    const phoneData = getFirstAvailableMobilePhone(row, headerMap)
    if (!phoneData.number) {
      stats.noPhone++
      continue
    }

    const fullAddress = extractFullAddress(row, headerMap)
    const normalized =
      normalizeAddress(fullAddress) ||
      cell(row, headerMap.propertyAddress).toLowerCase() ||
      `row_${rowIdx}`
    if (seenAddresses.has(normalized)) {
      stats.duplicatesRemoved++
      continue
    }
    seenAddresses.add(normalized)

    let firstName = cell(row, headerMap.firstName)
    let lastName = cell(row, headerMap.lastName)

    const contactNameRaw = cell(row, headerMap.contactName)
    if (contactNameRaw.toLowerCase().includes('trust')) {
      const parts = contactNameRaw.split(/\s+/)
      if (parts.length === 1) {
        firstName = capitalize(parts[0])
        lastName = ''
      } else {
        firstName = parts.slice(0, -1).map(capitalize).join(' ')
        lastName = capitalize(parts[parts.length - 1])
      }
    }

    const parsed = parseAddress(fullAddress, row, headerMap)
    const email = cell(row, headerMap.email)

    contacts.push({
      firstName,
      lastName,
      propertyAddress: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
      phone: phoneData.number,
      phoneType: phoneData.type,
      email,
    })

    stats.mobileFound++
    stats.ready++
  }

  return { contacts, stats }
}

function capitalize(word: string): string {
  if (!word) return ''
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Detect which export format a file uses based on its header row.
 * DealMachine direct exports have a distinct column structure from BatchLeads.
 */
export function detectFileFormat(headers: string[]): 'batchleads' | 'dealmachine' | 'unknown' {
  const normalized = headers.map((h) => h.toLowerCase().trim())

  // DealMachine has these specific columns
  if (
    normalized.includes('contact_id') &&
    normalized.includes('associated_property_address_full') &&
    normalized.includes('phone_1_type')
  ) {
    return 'dealmachine'
  }

  // BatchLeads has phone type columns but a different structure
  if (
    normalized.some((h) => h.includes('phone') && h.includes('type')) &&
    !normalized.includes('contact_id')
  ) {
    return 'batchleads'
  }

  return 'unknown'
}

/**
 * Clean a DIRECT DealMachine CSV export (not the copy-paste formatter).
 * Selects the first non-DNC wireless phone per contact, dedupes by property
 * address, and normalizes phone/address formatting for GHL import.
 */
export function cleanDealMachineExport(rows: string[][], headers: string[]): CleaningResult {
  // Build index map from headers
  const idx: Record<string, number> = {}
  headers.forEach((h, i) => {
    idx[h.trim().toLowerCase()] = i
  })

  const get = (row: string[], key: string): string => {
    const i = idx[key.toLowerCase()]
    return i !== undefined ? (row[i] || '').toString().trim() : ''
  }

  const seenAddresses = new Set<string>()
  const contacts: CleanedContact[] = []

  const stats = {
    totalRows: rows.length,
    mobileFound: 0,
    duplicatesRemoved: 0,
    noPhone: 0,
    dnc: 0,
    ready: 0,
  }

  for (const row of rows) {
    // Skip completely empty rows
    if (row.every((cell) => !cell?.trim())) continue

    // Extract property address for dedup
    const fullPropertyAddress = get(row, 'associated_property_address_full')

    const normalizedAddr = fullPropertyAddress
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,]/g, '')
      .trim()

    // Deduplicate by property address
    if (normalizedAddr && seenAddresses.has(normalizedAddr)) {
      stats.duplicatesRemoved++
      continue
    }

    // TODO: add a filter toggle for "Likely Owner only" using the
    // contact_flags column ("Likely Owner" / "Potential Owner" / "Family" /
    // "Resident"). For now we include all rows regardless of ownership flags.

    // Find first valid wireless phone that is not flagged DO NOT CALL.
    // Rows where phone_1/2/3 are all DNC (or non-wireless) fall through to
    // the noPhone bucket below — no usable number.
    let selectedPhone = ''
    let foundPhone = false

    for (let i = 1; i <= 3; i++) {
      const phone = get(row, `phone_${i}`)
      const dnc = get(row, `phone_${i}_do_not_call`)
      const type = get(row, `phone_${i}_type`)

      if (!phone) continue

      // Skip DNC numbers (removed silently — counted for transparency)
      if (dnc.toLowerCase().includes('do not call')) {
        stats.dnc++
        continue
      }

      // Accept Wireless only (same as the mobile-only filter)
      if (type.toLowerCase() === 'wireless') {
        selectedPhone = phone
        foundPhone = true
        break
      }
    }

    if (!foundPhone) {
      stats.noPhone++
      continue
    }

    // Mark address as seen
    if (normalizedAddr) {
      seenAddresses.add(normalizedAddr)
    }

    // Parse property address components.
    // associated_property_address_full format:
    // "123 Main St, Indianapolis, In 46221" (state may be lowercase)
    let street = ''
    let city = ''
    let state = ''
    let zip = ''

    const addrParts = fullPropertyAddress.split(',').map((p) => p.trim())

    if (addrParts.length >= 3) {
      street = addrParts[0]
      city = addrParts[1]
      // Last part may be "IN 46221"
      const stateZip = addrParts[2].trim().split(/\s+/)
      state = stateZip[0]?.toUpperCase() || ''
      zip = stateZip[1]?.split('-')[0] || ''
    } else if (addrParts.length === 2) {
      street = addrParts[0]
      city = addrParts[1]
    } else {
      street = fullPropertyAddress
    }

    // Use mailing address as fallback for city/state/zip if parsing failed
    if (!city) {
      city = get(row, 'primary_mailing_city')
    }
    if (!state) {
      state = get(row, 'primary_mailing_state').toUpperCase()
    }
    if (!zip) {
      zip = get(row, 'primary_mailing_zip').split('-')[0]
    }

    // Format phone to digits only, then format as XXX-XXX-XXXX for GHL import.
    // DealMachine exports phones as unformatted 10-digit strings, e.g. "3172958344".
    const phoneDigits = selectedPhone.replace(/\D/g, '')
    const formattedPhone =
      phoneDigits.length === 10
        ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
        : selectedPhone

    const contact: CleanedContact = {
      firstName: get(row, 'first_name'),
      lastName: get(row, 'last_name'),
      propertyAddress: street,
      city,
      state,
      zip,
      phone: formattedPhone,
      phoneType: 'Wireless',
      email: get(row, 'email_address_1'),
    }

    contacts.push(contact)
    stats.mobileFound++
    stats.ready++
  }

  return { contacts, stats }
}

export interface DealMachineContact {
  address: string
  city: string
  state: string
  zip: string
}

export interface DealMachineResult {
  contacts: DealMachineContact[]
  stats: {
    totalLines: number
    parsed: number
    skipped: number
  }
}

export function formatDealMachineData(rawText: string): DealMachineResult {
  const helperRe = /(view\s*lead|start\s*mail)/i
  const cityLineRe = /^\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const contacts: DealMachineContact[] = []
  const stats = { totalLines: lines.length, parsed: 0, skipped: 0 }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (helperRe.test(line) || cityLineRe.test(line)) {
      stats.skipped++
      i++
      continue
    }

    // This is an address line — look ahead for city/state/zip line
    const next = lines[i + 1]
    const cityMatch = next ? next.match(cityLineRe) : null

    if (cityMatch) {
      const city = cityMatch[1].trim()
      const state = cityMatch[2].toUpperCase()
      const zip = cityMatch[3].split('-')[0]
      contacts.push({ address: line, city, state, zip })
      stats.parsed++
      i += 2
    } else {
      contacts.push({ address: line, city: '', state: '', zip: '' })
      stats.parsed++
      i++
    }
  }

  return { contacts, stats }
}

export function downloadCSV(data: Record<string, string>[], filename: string): void {
  const headers = Object.keys(data[0])
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h] || ''
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val
      })
      .join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
