# REIblast — Claude Code Build Prompt

Complete build of the REIblast Next.js 15 app. This is a wholesale real estate SaaS platform serving two domains from one deployment using middleware hostname routing.

**Domains:**
- `reiblast.app` — public marketing site and onboarding
- `tools.reiblast.app` — member tools portal and GHL iframe widgets

Login button on marketing site redirects directly to `app.reiblast.app` — GHL handles all authentication. No auth library needed in this app.

---

## Tech Stack
- Next.js 15 App Router
- TypeScript
- Tailwind CSS
- Prisma ORM with Neon PostgreSQL
- No authentication library
- No email library — all emails handled by GHL native automations triggered by tags

---

## Brand Tokens

Extend Tailwind theme:
```javascript
colors: {
  gold: '#F5C842',
  'gold-hover': '#e0b538',
  black: '#0A0A0A',
  surface: '#141414',
  'surface-2': '#1C1C1C',
  'border-default': '#2A2A2A',
  silver: '#C0C0C0',
  gray: '#888888',
}
```

Font: Inter from Google Fonts via next/font
No light mode anywhere — black background on every page

---

## Project Structure

```
app/
  (marketing)/
    layout.tsx
    page.tsx
    pricing/
      page.tsx
    login/
      page.tsx
    terms/
      page.tsx
    privacy/
      page.tsx
  (onboarding)/
    layout.tsx
    page.tsx
    success/
      page.tsx
  (tools)/
    layout.tsx
    analyzer/
      page.tsx
    jv/
      page.tsx
    leads/
      page.tsx
    widget/
      header/
        page.tsx
      analyzer/
        page.tsx
  api/
    webhooks/
      whop/
        route.ts
      ghl/
        route.ts
    onboarding/
      submit/
        route.ts
    analyzer/
      property/
        route.ts
      comps/
        route.ts
      arv/
        route.ts
components/
  marketing/
    Nav.tsx
    Hero.tsx
    Features.tsx
    HowItWorks.tsx
    Pricing.tsx
    Footer.tsx
  tools/
    MinimalHeader.tsx
  shared/
    Logo.tsx
    Button.tsx
    Input.tsx
    Card.tsx
    Spinner.tsx
lib/
  constants.ts
  ghl.ts
  rentcast.ts
  whop.ts
prisma/
  schema.prisma
middleware.ts
.env.example
README.md
```

---

## Middleware — middleware.ts

Check hostname from `request.headers.get('host')`:

- Starts with `tools.` → serve tool routes. No auth check. Token passed via GHL sidebar link query param.
- All other hostnames → serve marketing routes.

Export matcher excluding:
`api`, `_next/static`, `_next/image`, `favicon.ico`, `logo.png`, `icon.png`

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                  String   @id @default(cuid())
  email               String   @unique
  name                String?
  plan                String   @default("core")
  status              String   @default("pending_onboarding")

  // Whop
  whopMemberId        String?

  // Business / A2P info
  businessName        String?
  ein                 String?
  businessType        String?
  businessAddress     String?
  businessCity        String?
  businessState       String?
  businessZip         String?
  businessPhone       String?
  businessEmail       String?
  websiteUrl          String?
  targetMarket        String?
  smsComplianceAgreed Boolean  @default(false)
  onboardingComplete  Boolean  @default(false)

  // GHL
  ghlContactId        String?
  ghlLocationId       String?
  ghlUserId           String?
  onboardingStage     String?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model PromoCode {
  id              String   @id @default(cuid())
  code            String   @unique
  description     String?
  discountPct     Int
  originalPrice   Int
  discountedPrice Int
  active          Boolean  @default(true)
  usageCount      Int      @default(0)
  usageLimit      Int?
  createdAt       DateTime @default(now())
}
```

---

## lib/constants.ts

```typescript
export const PLATFORM_NAME = 'REIblast'
export const TAGLINE = 'From list to blast — close more deals, faster'
export const CORE_PRICE = 57
export const MAO_MULTIPLIER = 0.70
export const MIN_ASSIGNMENT_FEE = 5000
export const GHL_APP_URL = 'https://app.reiblast.app'
export const TOOLS_URL = 'https://tools.reiblast.app'
export const MARKETING_URL = 'https://reiblast.app'
export const SUPPORT_EMAIL = 'support@reiblast.app'

export const ONBOARDING_STAGES = {
  PAYMENT_RECEIVED: 'Payment Received',
  ONBOARDING_FORM_SENT: 'Onboarding Form Sent',
  ONBOARDING_FORM_SUBMITTED: 'Onboarding Form Submitted',
  SUB_ACCOUNT_PROVISIONED: 'Sub-Account Provisioned',
  CREDENTIALS_SENT: 'Credentials Sent',
  A2P_SUBMITTED: 'A2P Submitted',
  ACTIVE: 'Active Member',
} as const

export const MEMBER_TAGS = {
  CORE: 'Plan: Core',
  ACTIVE: 'Core Member',
  ONBOARDING_COMPLETE: 'Onboarding Complete',
  A2P_PENDING: 'A2P Pending',
  A2P_SUBMITTED: 'A2P Submitted',
  A2P_APPROVED: 'A2P Approved',
  PAYMENT_RECEIVED: 'Payment Received',
  CHURNED: 'Churned',
} as const
```

---

## lib/ghl.ts

The server is responsible ONLY for:
1. Creating HQ contacts
2. Adding and removing tags
3. Moving pipeline stages
4. Provisioning sub-accounts (real implementation — not stubbed)
5. Populating A2P template site

GHL automations triggered by tags handle all emails, SMS, tasks, and follow-up sequences.

```typescript
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID!,
      client_secret: process.env.GHL_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    })
  })
  if (!res.ok) throw new Error('Failed to get GHL access token')
  const data = await res.json()
  return data.access_token
}

// Create contact in HQ sub-account
// GHL automation triggers on contact creation
export async function createHQContact(
  name: string,
  email: string,
  phone?: string
): Promise<{ contactId: string }> {
  const token = await getAccessToken()
  const res = await fetch(
    `${GHL_BASE_URL}/contacts/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({
        locationId: process.env.GHL_HQ_LOCATION_ID,
        name,
        email,
        phone: phone || '',
      })
    }
  )
  if (!res.ok) throw new Error('Failed to create HQ contact')
  const data = await res.json()
  return { contactId: data.contact.id }
}

// Add tag to HQ contact
// Tags trigger GHL automations for emails and tasks
export async function addTag(
  contactId: string,
  tag: string
): Promise<boolean> {
  const token = await getAccessToken()
  const res = await fetch(
    `${GHL_BASE_URL}/contacts/${contactId}/tags`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({ tags: [tag] })
    }
  )
  return res.ok
}

// Remove tag from HQ contact
export async function removeTag(
  contactId: string,
  tag: string
): Promise<boolean> {
  const token = await getAccessToken()
  const res = await fetch(
    `${GHL_BASE_URL}/contacts/${contactId}/tags`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({ tags: [tag] })
    }
  )
  return res.ok
}

// Move contact to pipeline stage in HQ
export async function moveToStage(
  contactId: string,
  stage: string
): Promise<boolean> {
  // Finds the opportunity for this contact in the 
  // onboarding pipeline and updates the stage
  const token = await getAccessToken()
  
  // First find existing opportunity
  const searchRes = await fetch(
    `${GHL_BASE_URL}/opportunities/search?contact_id=${contactId}&pipeline_id=${process.env.GHL_ONBOARDING_PIPELINE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
      }
    }
  )
  
  const searchData = await searchRes.json()
  const opportunity = searchData?.opportunities?.[0]
  
  if (opportunity) {
    // Update existing opportunity stage
    const updateRes = await fetch(
      `${GHL_BASE_URL}/opportunities/${opportunity.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
        },
        body: JSON.stringify({ name: stage })
      }
    )
    return updateRes.ok
  } else {
    // Create new opportunity in pipeline
    const createRes = await fetch(
      `${GHL_BASE_URL}/opportunities/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
        },
        body: JSON.stringify({
          pipelineId: process.env.GHL_ONBOARDING_PIPELINE_ID,
          locationId: process.env.GHL_HQ_LOCATION_ID,
          name: stage,
          contactId,
          status: 'open',
        })
      }
    )
    return createRes.ok
  }
}

// Create new member sub-account with snapshot applied
export async function provisionSubAccount(
  name: string,
  email: string,
  businessName: string,
  contactId: string
): Promise<{ locationId: string; userId: string; tempPassword: string }> {
  const token = await getAccessToken()
  
  // Generate temp password
  const tempPassword = `REI${Math.random().toString(36).slice(2, 8).toUpperCase()}!`
  
  // Create sub-account (location)
  const locationRes = await fetch(
    `${GHL_BASE_URL}/locations/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({
        name: businessName || `${name}'s REIblast Account`,
        email,
        snapshotId: process.env.GHL_SNAPSHOT_ID,
        address: '',
        city: '',
        state: '',
        country: 'US',
        timezone: 'America/Chicago',
      })
    }
  )
  
  if (!locationRes.ok) {
    const err = await locationRes.text()
    throw new Error(`Failed to create sub-account: ${err}`)
  }
  
  const locationData = await locationRes.json()
  const locationId = locationData.location.id
  
  // Create user in the new sub-account
  const userRes = await fetch(
    `${GHL_BASE_URL}/users/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({
        companyId: locationId,
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' ') || '',
        email,
        password: tempPassword,
        type: 'account',
        role: 'user',
        locationIds: [locationId],
      })
    }
  )
  
  if (!userRes.ok) {
    const err = await userRes.text()
    throw new Error(`Failed to create GHL user: ${err}`)
  }
  
  const userData = await userRes.json()
  
  return {
    locationId,
    userId: userData.id,
    tempPassword,
  }
}

// Suspend member sub-account on cancellation
export async function suspendSubAccount(
  locationId: string
): Promise<boolean> {
  const token = await getAccessToken()
  const res = await fetch(
    `${GHL_BASE_URL}/locations/${locationId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({ suspended: true })
    }
  )
  return res.ok
}

// Populate A2P template funnel with member business data
export async function populateA2PSite(
  locationId: string,
  businessData: {
    businessName: string
    businessAddress: string
    businessCity: string
    businessState: string
    businessZip: string
    businessPhone: string
    businessEmail: string
    websiteUrl?: string
  }
): Promise<boolean> {
  const token = await getAccessToken()
  // Update custom values in member sub-account
  // These populate the A2P template funnel placeholders
  const res = await fetch(
    `${GHL_BASE_URL}/locations/${locationId}/customValues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({
        name: 'A2P Business Info',
        value: JSON.stringify(businessData)
      })
    }
  )
  return res.ok
}
```

---

## lib/rentcast.ts

```typescript
const RENTCAST_BASE = 'https://api.rentcast.io/v1'

export async function getPropertyDetails(address: string) {
  const res = await fetch(
    `${RENTCAST_BASE}/properties?address=${encodeURIComponent(address)}`,
    {
      headers: {
        'X-Api-Key': process.env.RENTCAST_API_KEY!,
        'Content-Type': 'application/json'
      },
      next: { revalidate: 0 }
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
        'Content-Type': 'application/json'
      },
      next: { revalidate: 0 }
    }
  )
  if (!res.ok) throw new Error('Comps not found')
  return res.json()
}
```

---

## lib/whop.ts

```typescript
import crypto from 'crypto'

export function verifyWhopWebhook(
  payload: string,
  signature: string
): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET!
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return hmac === signature
}

export function extractWhopEvent(body: any): {
  event: string
  email: string
  name: string
  whopMemberId: string
} {
  return {
    event: body.action,
    email: body.data?.user?.email || '',
    name: body.data?.user?.name || '',
    whopMemberId: body.data?.id || '',
  }
}
```

---

## API Routes

### app/api/webhooks/whop/route.ts

```
POST handler:

1. Read raw body as text for signature verification
2. Get header 'whop-signature'
3. Call verifyWhopWebhook(rawBody, signature)
   If fails → return 401

4. Parse body as JSON
5. Call extractWhopEvent(body)

6. On event 'membership.went_valid':
   a. Upsert User in DB:
      email, name, whopMemberId
      plan: 'core', status: 'pending_onboarding'
   b. Call createHQContact(name, email) → { contactId }
   c. Update User: ghlContactId = contactId
   d. Call addTag(contactId, MEMBER_TAGS.PAYMENT_RECEIVED)
   e. Call addTag(contactId, MEMBER_TAGS.CORE)
   f. Call moveToStage(contactId, ONBOARDING_STAGES.PAYMENT_RECEIVED)
   g. Return 200 { success: true }
   
   GHL automation fires on 'Payment Received' tag:
   → sends onboarding email with form link automatically

7. On event 'membership.went_invalid':
   a. Find user by whopMemberId or email
   b. Update User: status = 'inactive'
   c. If user has ghlContactId:
      - Call removeTag(contactId, MEMBER_TAGS.ACTIVE)
      - Call addTag(contactId, MEMBER_TAGS.CHURNED)
   d. If user has ghlLocationId:
      - Call suspendSubAccount(locationId)
   e. Return 200 { success: true }
   
   GHL automation fires on 'Churned' tag:
   → sends cancellation email automatically

8. Unknown events → log and return 200
9. Wrap everything in try/catch
   On error: log full error, return 500
   Never return 4xx on verified requests
```

### app/api/webhooks/ghl/route.ts

```
POST handler:

1. Read header 'x-reiblast-secret'
2. Compare to process.env.GHL_WEBHOOK_SECRET
   If mismatch → return 401

3. Parse JSON body
4. Log event type and email in all environments

5. On event 'order.fulfilled':
   a. Find user by email
   b. If found: update status = 'active'
   c. Return 200

6. On event 'subscription.cancelled':
   a. Find user by email  
   b. Update: status = 'inactive'
   c. Call suspendSubAccount(ghlLocationId) if exists
   d. Return 200

7. Unknown events → log and return 200
8. Wrap in try/catch, return 500 on error
```

### app/api/onboarding/submit/route.ts

```
POST handler accepting JSON:
{
  email, legalBusinessName, ein,
  businessType, businessAddress, businessCity,
  businessState, businessZip, businessPhone,
  businessEmail, websiteUrl, targetMarket,
  smsComplianceAgreed
}

1. Validate all required fields present
   Required: email, legalBusinessName, ein,
   businessType, businessAddress, businessCity,
   businessState, businessZip, businessPhone,
   businessEmail, targetMarket, smsComplianceAgreed

2. Validate EIN format: /^\d{2}-\d{7}$/
   Return 400 with message if invalid

3. Validate smsComplianceAgreed === true
   Return 400 if false

4. Find User by email
   Return 404 if not found

5. Update User in DB:
   All business fields
   onboardingComplete: true
   status: 'provisioning'

6. Call moveToStage(
     ghlContactId,
     ONBOARDING_STAGES.ONBOARDING_FORM_SUBMITTED
   )

7. Call provisionSubAccount(
     name, email, legalBusinessName, ghlContactId
   ) → { locationId, userId, tempPassword }

8. Update User:
   ghlLocationId: locationId
   ghlUserId: userId
   status: 'active'
   onboardingStage: ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED

9. Call moveToStage(
     ghlContactId,
     ONBOARDING_STAGES.SUB_ACCOUNT_PROVISIONED
   )

10. Call populateA2PSite(locationId, {
      businessName: legalBusinessName,
      businessAddress, businessCity,
      businessState, businessZip,
      businessPhone, businessEmail,
      websiteUrl
    })

11. Call addTag(ghlContactId, MEMBER_TAGS.ONBOARDING_COMPLETE)
    Call addTag(ghlContactId, MEMBER_TAGS.ACTIVE)
    Call addTag(ghlContactId, MEMBER_TAGS.A2P_PENDING)

    GHL automation fires on 'Onboarding Complete' tag:
    → sends welcome email with login URL and 
      temp password automatically

12. Call moveToStage(
      ghlContactId,
      ONBOARDING_STAGES.ACTIVE
    )

13. Return 200 { success: true }

14. Wrap everything in try/catch
    On error: log full error
    Return 500 { error: 'Account setup failed. 
    Please contact support@reiblast.app' }
```

### app/api/analyzer/property/route.ts

```
POST { address: string }

1. Validate address present
2. Call getPropertyDetails(address)
3. If null → return 404 { error: 'Property not found' }
4. Map to clean object:
   {
     address, city, state, zip,
     beds, baths, sqft, yearBuilt,
     propertyType, lastSaleDate,
     lastSalePrice, estimatedValue,
     latitude, longitude
   }
5. Return 200 with property object
6. Wrap in try/catch, return 500 on error
```

### app/api/analyzer/comps/route.ts

```
POST {
  address: string,
  latitude: number,
  longitude: number,
  beds: number,
  baths: number,
  radius?: number,
  months?: number
}

1. Validate required fields
2. Default radius to 0.5, months to 6
3. Call getSalesComps()
4. Filter: beds within +/- 1 of subject
5. Filter: baths within +/- 1 of subject
6. Sort by saleDate descending
7. Calculate daysAgo and pricePerSqft for each
8. Map to clean comp objects
9. Return 200 with comp array
10. Wrap in try/catch, return 500 on error
```

### app/api/analyzer/arv/route.ts

```
POST { subject: PropertyDetails, comps: Comp[] }

1. Validate subject and comps present
2. Validate comps.length between 3 and 6
   Return 400 if outside range

3. Build Claude API request:
   fetch('https://api.anthropic.com/v1/messages', {
     method: 'POST',
     headers: {
       'x-api-key': process.env.ANTHROPIC_API_KEY,
       'anthropic-version': '2023-06-01',
       'content-type': 'application/json'
     },
     body: JSON.stringify({
       model: 'claude-sonnet-4-20250514',
       max_tokens: 1000,
       system: ARV_SYSTEM_PROMPT,
       messages: [{
         role: 'user',
         content: JSON.stringify({ subject, comps })
       }]
     })
   })

4. Extract text from response content blocks
5. Strip markdown fences if present
6. JSON.parse the response
7. Validate required fields exist
8. Return 200 with analysis object
9. Wrap in try/catch, return 500 on error

ARV_SYSTEM_PROMPT constant:
"You are a real estate wholesale deal analyzer.
You receive a subject property and comparable
sales selected by the user. Analyze the comps
and produce a deal analysis for a wholesale
investor.

Respond with valid JSON only. No preamble,
no markdown, no text outside the JSON.

Return exactly this structure:
{
  arv: {
    low: number,
    high: number,
    estimate: number,
    pricePerSqft: number,
    confidence: 'high' | 'medium' | 'low',
    confidenceReason: string
  },
  repairs: {
    light: { low: number, high: number, description: string },
    medium: { low: number, high: number, description: string },
    heavy: { low: number, high: number, description: string }
  },
  mao: { light: number, medium: number, heavy: number },
  dealScore: 'strong' | 'borderline' | 'pass',
  dealScoreReason: string,
  narrative: string,
  bestComp: string
}

MAO formula: (ARV * 0.70) - repairs - 5000
5000 = minimum assignment fee

Repair guidelines:
- Light: cosmetic only, paint, flooring, fixtures.
  5-15 per sqft.
- Medium: kitchen update, bath refresh, flooring,
  paint, minor systems. 20-40 per sqft.
- Heavy: full gut, kitchen, baths, roof, HVAC,
  electrical, plumbing. 50-100 per sqft.

Adjust for property age, sqft, and state labor costs.

Deal score:
- strong: clear margin at medium rehab MAO
- borderline: works at light rehab only
- pass: MAO below any reasonable asking price"
```

---

## Page Builds

### app/(marketing)/layout.tsx
- Black background
- Nav and Footer components
- Inter font

### app/(marketing)/page.tsx — Landing Page

Build these sections in order:

**Hero**
- LogoStacked centered
- Headline: 'From List to Blast'
- Subheadline: 'The wholesale operating system built for investors who text. Pipeline, sequences, contracts, and deal analysis — all in one place.'
- Two buttons:
  - Gold primary: 'Get Started — $57/mo' → process.env.NEXT_PUBLIC_WHOP_CHECKOUT_URL
  - Gold outline: 'See How It Works' → #how-it-works anchor
- Subtle radial gold glow behind logo

**Pain Points Strip**
Three cards with gold left border:
- 'Tired of juggling FusionREI, Discord, and spreadsheets?'
- 'Spending weeks waiting on A2P approval?'
- 'No system to go from list to first text in one session?'

**Features Grid** (3x2, six cards)
Each card: gold icon, title, two line description
- Pre-Built Pipeline — 'Ari's exact deal stages loaded and ready'
- Locked SMS Sequences — 'The same sequences that close 4-6 deals a month'
- Universal Wholesale Contract — 'Pre-loaded PSA with e-sign built in'
- E-Sign Built In — 'Send contracts and get signatures without leaving the platform'
- AI Deal Analyzer — 'Run real comps and get an AI-generated ARV in minutes'
- JV Deal Submission — 'Submit deals directly to Ari with a 50/50 split'

**How It Works** (id="how-it-works", four steps horizontal)
Gold step numbers, connecting line:
1. Get Your List
2. Blast Your Market
3. Work Your Leads
4. Close and Assign

**Pricing Card** (centered, gold border)
- REIblast Core
- $57/mo large
- Feature list with gold checkmarks
- 'Get Started' button → Whop checkout

**Footer**
- LogoFull, tagline, links, support email

### app/(marketing)/login/page.tsx
- Centered, black background
- LogoStacked
- 'Redirecting you to your account...'
- Gold Spinner component
- useEffect → window.location.href = process.env.NEXT_PUBLIC_GHL_APP_URL after 800ms
- Fallback: 'Click here if not redirected' link

### app/(marketing)/terms/page.tsx
- Clean document layout, black bg, white text
- Placeholder sections with TODO markers:
  Use of Service, Payments, SMS Compliance, Termination, Liability

### app/(marketing)/privacy/page.tsx
- Same layout
- Sections: Data Collection, SMS Data, Third Party Services, Contact

### app/(onboarding)/layout.tsx
- Black background
- No nav or footer
- LogoIcon top center
- Renders children

### app/(onboarding)/page.tsx — Multi-Step Onboarding Form

Read `?email=` query param, store in state.

Gold step progress indicator at top:
Step 1: Business Info → Step 2: SMS Compliance → Step 3: Review

**Step 1 — Business Info**
All inputs: dark bg #1C1C1C, gold border on focus, white text

Fields:
- email — text input, readonly, pre-filled from query param
- legalBusinessName — required
- ein — required, placeholder 'XX-XXXXXXX', validate /^\d{2}-\d{7}$/ on blur, show format error
- businessType — select: LLC, Corporation, Sole Proprietorship, Partnership
- businessAddress — required
- businessCity — required
- businessState — select, all 50 US states alphabetical
- businessZip — required
- businessPhone — required
- businessEmail — required
- websiteUrl — optional, placeholder 'Leave blank if you don\'t have one yet'
- targetMarket — required, placeholder 'e.g. Tampa FL, Phoenix AZ'

'Continue →' button validates all required fields before advancing

**Step 2 — SMS Compliance**
- Editable textarea pre-filled:
  'We are a real estate investment company that purchases properties directly from motivated sellers. We contact property owners via SMS to inquire about their interest in selling their property.'
- Label: 'This description will be used for your A2P SMS registration'
- Three required checkboxes (all must be checked):
  □ 'All contacts I message are property owners being contacted about purchasing their property. I am not texting random consumers.'
  □ 'I will honor all STOP opt-out requests immediately and maintain a do-not-contact list.'
  □ 'I understand that misuse of the REIblast SMS system may result in immediate account suspension.'
- 'Continue →' button — disabled until all three checked

**Step 3 — Review**
- Summary card showing all data entered
- 'Edit' link → back to step 1
- Gold 'Create My Account' submit button
- On submit → POST to /api/onboarding/submit
- Loading state — animated messages cycling every 2 seconds:
  'Verifying your information...'
  'Setting up your account...'
  'Applying your workspace...'
  'Configuring your CRM...'
  'Almost ready...'
- On success → redirect to /onboarding/success
- On error → red error banner with message, stay on page

### app/(onboarding)/success/page.tsx
- Animated gold checkmark (CSS keyframes scale + opacity)
- Headline: 'You\'re in. Welcome to REIblast.'
- Subheadline: 'Your account is ready. Check your email for login credentials.'
- Three step cards:
  1. Check your email for login credentials
  2. Log in at app.reiblast.app
  3. Pull your first list on DealMachine and have it ready to upload
- Large gold button: 'Go to My CRM' → https://app.reiblast.app (target="_blank")
- Support text: 'Questions? Email support@reiblast.app'

### app/(tools)/layout.tsx
- Black background
- No navigation
- Renders children directly
- Each tool page is a standalone focused window

### app/(tools)/analyzer/page.tsx — Multi-Step Deal Analyzer

Read `?token=` from searchParams, store in state.

Four step flow with minimal gold step indicator:

**Step 1 — Address Input**
- MinimalHeader title='Deal Analyzer'
- Centered layout
- Large label: 'Enter the property address'
- Address input with Google Places autocomplete
  - Load Google Maps script dynamically:
    src=`https://maps.googleapis.com/maps/api/js?key=${NEXT_PUBLIC_GOOGLE_PLACES_API_KEY}&libraries=places`
  - Initialize Autocomplete on input mount
  - Restrict to US: componentRestrictions: { country: 'us' }
  - On place_changed → extract formatted_address and geometry.location
  - Store address string and lat/lng in state
- Gold 'Look Up Property →' button
- On click → POST to /api/analyzer/property
- Spinner while loading
- Error message if not found

**Step 2 — Property Confirmation**
- MinimalHeader
- Property card (gold border, surface bg, rounded-xl, p-6):
  - Address large at top (white, 20px bold)
  - 4-column grid:
    Beds | Baths | Sqft | Year Built
    (gold labels, white values)
  - Second row:
    Property Type | Last Sale Date | Last Sale Price | Est. Value
- Gold 'This Is My Property →' button → advance to step 3
- Gray 'Search Again' link → back to step 1

**Step 3 — Comp Selection**
- MinimalHeader
- Filter bar (surface bg, rounded-lg, p-3):
  - Radius toggle: 0.25mi | 0.5mi | 1mi (gold active state)
  - Period toggle: 3mo | 6mo | 12mo (gold active state)
  - Changing filter → re-POST to /api/analyzer/comps
- Selection counter: '{n} of 6 comps selected' (gold if 3-6, gray otherwise)
- Comp cards grid (2 columns):
  Each card: surface bg, rounded-xl, p-4, cursor pointer
  - Checkbox top right (gold when checked)
  - Selected state: gold border
  - Address (white, 13px bold)
  - Sale price (gold, 18px bold)
  - Row: beds · baths · sqft
  - Row: ${pricePerSqft}/sqft · {distance}mi · sold {daysAgo}d ago
  Max 6 selectable — disable others when 6 selected
- Sticky bottom bar when 3+ selected:
  '{n} comps selected'
  Gold 'Analyze This Deal →' button
  → POST to /api/analyzer/arv

**Step 4 — Results**
- MinimalHeader
- Loading state: gold spinner + cycling messages
- After loading, fade in results:

  ARV Card (gold border, surface bg):
    Label: 'After Repair Value'
    Range: $X — $X (gray, 14px)
    Estimate: $X (white, 32px, bold)
    Row: ${pricePerSqft}/sqft · Confidence: {level}
    Confidence reason in gray italic

  Three repair cards (equal width, surface bg):
    Light Rehab | Medium Rehab | Heavy Rehab
    Cost: $X — $X (gray)
    MAO: $X (gold, bold, 20px)
    Description (gray, 12px)

  Deal Score (full width card):
    🟢 Strong Deal / 🟡 Borderline / 🔴 Pass
    Based on colors: green/yellow/red backgrounds at 20% opacity
    Reason text below

  AI Narrative (surface card):
    'Analysis' label (gray uppercase 11px)
    Paragraph text (white, 14px, line-height 1.7)

  Best Comp:
    'Strongest comp: {bestComp}' (gray, 12px)

  Action buttons:
    Gold: 'Submit as JV Deal' → /jv?address=X&arv=X&mao=X&score=X (uses medium MAO)
    Gray outline: 'New Analysis' → reset to step 1

### app/(tools)/jv/page.tsx
- MinimalHeader title='JV with Ari'
- Read URL params: address, arv, mao, score
- Gold info banner: 
  'JV deals require an executed purchase contract. Your split as a Core member is 50/50.'
- Form (surface bg card):
  - Property Address (pre-filled from param)
  - Market / City (text)
  - ARV (number, pre-filled)
  - Purchase Price (number)
  - Assignment Fee (number, pre-filled from mao)
  - Additional Notes (textarea)
  - Upload Contract (file input, gold styled)
- Submit button: disabled, tooltip 'CRM connection coming soon'

### app/(tools)/leads/page.tsx
- MinimalHeader title='Lead Sourcing'
- Two connection cards side by side (surface bg):
  Each: name, one-line description, API key input, Connect button
  Connected state: green pill 'Connected', Disconnect button
  Store in localStorage: 'reiblast_dm_connected', 'reiblast_bl_connected'
- Search panel (surface bg, disabled overlay if not connected):
  Market / Zip (text)
  Property Type (select: All, SFR, MFR, Land, Commercial)
  List Size (number, max 500)
  Gold 'Pull List' button
- Results table (shows mock data when pulled):
  Headers: Owner Name, Property Address, Mailing Address, Phone, Status, Actions
  5 mock rows
  Import buttons disabled (gold outline)
- Footer note: 'Imported leads tagged New Lead in your REIblast CRM automatically'

### app/(tools)/widget/header/page.tsx
- body { margin: 0; padding: 0; overflow: hidden; background: transparent }
- Exactly 80px height
- Black gradient: linear-gradient(135deg, #0A0A0A, #141414)
- Gold border 1px
- border-radius: 12px
- padding: 0 24px
- display flex, align-items center, justify-content space-between
- Left: LogoFull variant='dark'
- Right: 'Core Plan' gold pill
- Silver 1px accent line at very bottom
- No scrollbar: overflow: hidden

### app/(tools)/widget/analyzer/page.tsx
- Compact inline deal analyzer
- No MinimalHeader
- Plain text address input (no Google Places)
- Fields: address, ARV, repairs, assignment fee
- Calculate button
- Results: MAO formula, deal score badge
- Optimized for 600px iframe width

---

## Components

### components/shared/Logo.tsx

Four named exports:

**LogoIcon** (props: size = 40)
- Rounded square background #0A0A0A
- 1px gold border
- Inline SVG text: REI white, / gold #F5C842, blast white
- Inter 800 weight
- Sized to fit inside square with padding

**LogoFull** (props: size = 40, variant: 'dark' | 'light' = 'dark')
- LogoIcon on left
- Wordmark text on right, vertically centered:
  dark variant: 'REI' white + 'blast' gold
  light variant: 'REI' #0A0A0A + 'blast' gold
- gap-3 between icon and wordmark

**LogoStacked** (props: size = 60)
- LogoIcon centered on top
- Wordmark centered below
- gap-2 vertical

**LogoWordmark** (props: variant: 'dark' | 'light' = 'dark')
- Text only, no icon
- Same color rules as LogoFull

### components/tools/MinimalHeader.tsx

Props: title: string

- Height: 52px, width: 100%
- Background: #0A0A0A
- Border bottom: 1px solid #F5C842
- Flex, align-items center, justify-content space-between
- padding: 0 16px
- Left: LogoIcon size=28
- Center: title (white, 14px, font-weight 600, absolute centered)
- Right: X button
  - Gray #888888, hover gold #F5C842
  - onClick: window.close()
  - 20px, cursor pointer

### components/shared/Button.tsx

Props: variant, size, loading, disabled, onClick, children, type, href

Variants:
- primary: bg gold, text black, hover gold-hover
- outline: border gold, text gold, hover bg gold/10
- ghost: no border, text gold, hover bg gold/10
- danger: bg red-600, text white

Sizes: sm (h-8 px-3 text-sm), md (h-10 px-4), lg (h-12 px-6 text-lg)

Loading: show Spinner, hide children, disabled
Disabled: opacity-50, cursor-not-allowed
Transitions: 200ms ease all

### components/shared/Input.tsx

Props: label, error, prefix, type, placeholder, value, onChange, disabled, readonly, required

- bg surface-2 #1C1C1C
- border border-default #2A2A2A
- focus: border-gold outline-none ring-0
- text white
- placeholder text-gray-500
- Label: white 13px mb-1
- Error: red-400 text-12px mt-1
- rounded-lg, h-11, px-3

### components/shared/Card.tsx

Props: variant, className, children

Variants:
- default: bg surface #141414, border border-default
- highlight: bg surface, border gold
- dark: bg black #0A0A0A, border gold

All: rounded-xl, p-6

### components/shared/Spinner.tsx

Props: size: 'sm' | 'md' | 'lg' = 'md'

- Animated spinning circle
- Gold color #F5C842
- sm: 16px, md: 24px, lg: 32px
- CSS animation: spin 0.8s linear infinite
- border-2, border-gold, border-t-transparent, rounded-full

---

## .env.example

```
# Database
DATABASE_URL=

# GHL Integration
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_SNAPSHOT_ID=
GHL_HQ_LOCATION_ID=
GHL_ONBOARDING_PIPELINE_ID=
GHL_WEBHOOK_SECRET=

# Whop Payments
WHOP_WEBHOOK_SECRET=
WHOP_API_KEY=
NEXT_PUBLIC_WHOP_CHECKOUT_URL=

# Property Data
RENTCAST_API_KEY=
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=
GOOGLE_PLACES_API_KEY=

# AI
ANTHROPIC_API_KEY=

# App URLs
NEXT_PUBLIC_APP_URL=https://reiblast.app
NEXT_PUBLIC_TOOLS_URL=https://tools.reiblast.app
NEXT_PUBLIC_GHL_APP_URL=https://app.reiblast.app
```

---

## README.md

Include:
- Project overview
- How the two-domain routing works
- All env vars with descriptions and where to get each one
- Setup:
  1. npm install
  2. cp .env.example .env.local and fill vars
  3. npx prisma migrate dev --name init
  4. npm run dev
- Vercel deployment:
  1. Push to GitHub
  2. Import in Vercel
  3. Add env vars
  4. Add domains: reiblast.app and tools.reiblast.app
  5. Deploy
- Cloudflare DNS setup:
  - @ CNAME → cname.vercel-dns.com (proxied)
  - tools CNAME → cname.vercel-dns.com (proxied)
  - app CNAME → GHL CNAME value (DNS only, gray cloud)
- GHL automation triggers (tags that fire automations):
  - Payment Received → onboarding email
  - Onboarding Complete → welcome email with credentials
  - A2P Pending → A2P instructions email
  - Churned → cancellation email
- Phase 2 todos referencing all API endpoints that need real implementation
```
