const MELISSA_BASE = 'https://property.melissadata.net/v4/WEB'

const MELISSA_COLS = [
  'GrpIntRoomInfo',
  'GrpPropertySize',
  'GrpPropertyUseInfo',
  'GrpPool',
  'GrpSaleInfo',
  'GrpTax',
  'GrpEstimatedValue',
  'GrpPrimaryOwner',
  'GrpOwnerAddress',
  'GrpParking',
].join(',')

function parseDate(s: string): Date | null {
  if (!s || s.length !== 8) return null
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
}

function parseIntOrNull(s: string | undefined | null): number | null {
  if (!s) return null
  const n = parseInt(s, 10)
  return isNaN(n) || n === 0 ? null : n
}

function parseFloatOrNull(s: string | undefined | null): number | null {
  if (!s) return null
  const n = parseFloat(s)
  return isNaN(n) || n === 0 ? null : n
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRecord(r: any) {
  return {
    beds: parseIntOrNull(r.IntRoomInfo?.BedroomsCount),
    baths: parseFloatOrNull(r.IntRoomInfo?.BathCount),
    sqft: parseIntOrNull(r.PropertySize?.AreaBuilding),
    lotSizeSqft: parseIntOrNull(r.PropertySize?.AreaLotSF),
    lotSizeAcres: parseFloatOrNull(r.PropertySize?.AreaLotAcres),
    yearBuilt: parseIntOrNull(r.PropertyUseInfo?.YearBuilt),
    propertyType: (r.PropertyUseInfo?.PropertyUseGroup as string) ?? null,
    garage:
      parseIntOrNull(r.PropertySize?.ParkingGarageArea)
        ? true
        : r.PropertySize?.ParkingGarage
        ? true
        : false,
    garageSpaces: parseIntOrNull(r.Parking?.ParkingSpaceCount),
    carport: parseIntOrNull(r.PropertySize?.ParkingCarportArea) ? true : false,
    pool:
      r.Pool?.Pool && r.Pool.Pool !== '0' && r.Pool.Pool !== '' ? true : false,
    ownerName: (r.PrimaryOwner?.Name1Full as string) ?? null,
    ownerOccupied: r.OwnerAddress?.OwnerOccupied === '1',
    ownerType:
      r.PrimaryOwner?.CompanyFlag === 'Y' ? 'Organization' : 'Individual',
    mortgageAmount: parseIntOrNull(r.CurrentDeed?.MortgageAmount),
    assessedValue: parseIntOrNull(r.Tax?.AssessedValueTotal),
    taxDelinquentYear: (r.Tax?.TaxDelinquentYear as string) || null,
    estimatedValue: parseIntOrNull(r.EstimatedValue?.EstimatedValue),
    estimatedValueMin: parseIntOrNull(r.EstimatedValue?.EstimatedMinValue),
    estimatedValueMax: parseIntOrNull(r.EstimatedValue?.EstimatedMaxValue),
    lastSaleDate: parseDate(r.SaleInfo?.DeedLastSaleDate),
    lastSalePrice: parseIntOrNull(r.SaleInfo?.DeedLastSalePrice),
  }
}

export async function lookupProperty(formattedAddress: string) {
  const start = Date.now()

  const url = new URL(`${MELISSA_BASE}/LookupProperty`)
  url.searchParams.set('ff', formattedAddress)
  url.searchParams.set('cols', MELISSA_COLS)
  url.searchParams.set('id', process.env.MELISSA_API_KEY!)
  url.searchParams.set('format', 'json')

  const res = await fetch(url.toString())
  const durationMs = Date.now() - start

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json()

  if (!res.ok || !data.Records?.length) {
    return { record: null, durationMs, statusCode: res.status }
  }

  const record = parseRecord(data.Records[0])
  return { record, durationMs, statusCode: res.status }
}
