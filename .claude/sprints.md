# REIblast — Sprint Plan

## Project Overview
REIblast is a wholesale real estate SaaS platform built on GoHighLevel white label with a custom Next.js tools portal. Members get a pre-configured CRM, SMS sequences, contracts, deal analyzer, and JV submission — all under one brand.

**Domains:**
- `reiblast.app` — marketing site + onboarding
- `app.reiblast.app` — GHL white label CRM
- `tools.reiblast.app` — deal analyzer, lead sourcing, JV submission

**Stack:**
- Next.js 15, TypeScript, Tailwind CSS
- Prisma + Neon PostgreSQL
- GoHighLevel SaaS Pro ($497/mo)
- Whop for payments ($57/mo Core)
- Rentcast API for property data
- Google Places API for address autocomplete
- Anthropic Claude API for ARV analysis

---

## Sprint 1 — Foundation & Infrastructure
**Goal:** Project scaffolded, database live, domains resolving, GHL white labeled

### Next.js Project
- [ ] Scaffold Next.js 15 app with TypeScript and Tailwind
- [ ] Configure Tailwind with brand tokens (gold, black, surface, silver)
- [ ] Set up middleware hostname routing (reiblast.app vs tools.reiblast.app)
- [ ] Set up Prisma with Neon PostgreSQL
- [ ] Run initial migration
- [ ] Configure all env vars in Vercel

### Database
- [ ] Create Neon project: reiblast
- [ ] Apply User and PromoCode schema
- [ ] Verify connection from local and Vercel

### Domains & DNS
- [ ] Cloudflare nameservers propagated from IONOS
- [ ] Add DNS records in Cloudflare:
  - `@` CNAME → Vercel (proxied)
  - `tools` CNAME → Vercel (proxied)
  - `app` CNAME → GHL (DNS only)
- [ ] Verify all three domains resolve correctly
- [ ] SSL confirmed on all three

### GHL White Label
- [ ] Upload REIblast logo (350x180px transparent PNG)
- [ ] Configure favicon via Custom JS injection
- [ ] Paste black and gold CSS theme
- [ ] Set agency name to REIblast
- [ ] Set custom domain: app.reiblast.app
- [ ] Configure GHL Private Integration (Client ID + Secret)

---

## Sprint 2 — GHL Snapshot Build
**Goal:** Core Template sub-account fully built and snapshot exported

### Core Template Sub-Account
- [ ] Confirm Ari's pipeline stage names
- [ ] Build pipeline with exact stage names
- [ ] Verify all custom fields are built:
  - Property: street, city, state, zip, county, APN, type, ARV, repairs, asking price
  - Seller: legal name, mailing address, city, state, zip
  - Deal: assignment fee, EMD, closing date, inspection end date, title company
  - Wholesaler: LLC name, LLC address
- [ ] Build tags: Motivated Seller, Cash Buyer, Dead Lead, Follow Up, Contract Ready, Opt-Out, JV Submitted, New Lead
- [ ] Load and lock Ari's SMS sequences
- [ ] Build automations:
  - Opt-out keyword → tag contact, remove from sequences
  - Missed call → text-back within 2 minutes
  - Contract sent → enroll in follow-up drip
  - Contract signed → notify wholesaler, tag Contract Signed
- [ ] Build PSA contract template with all merge fields (already done)
- [ ] Build Assignment contract template with all merge fields
- [ ] Build A2P template funnel with placeholder fields:
  - Home page: business name, tagline, about, contact form
  - Privacy policy page (pre-written)
  - SMS terms page (pre-written)
- [ ] Set menu customization — hide unused GHL features
- [ ] Add three custom sidebar links:
  - 📊 Deal Analyzer → tools.reiblast.app/analyzer?token={{location.id}}
  - 🤝 JV with Ari → tools.reiblast.app/jv?token={{location.id}}
  - 🎯 Lead Sourcing → tools.reiblast.app/leads?token={{location.id}}
- [ ] Build dashboard widgets:
  - Opportunities in blast stage
  - Opportunities in replied stage
  - Total open opportunity value
  - Opportunities won this month
  - Pipeline funnel chart
- [ ] Build community channels:
  - Welcome
  - General
  - Deal Talk
  - Wins
- [ ] Build course shell with at least one module
- [ ] Test all workflows fire correctly in template account
- [ ] Export snapshot: REIblast Core v1
- [ ] Test snapshot import into blank sub-account
- [ ] Verify all merge fields populate in contracts

### HQ Sub-Account
- [ ] Build Onboarding Pipeline:
  Payment Received → Onboarding Form Sent → Onboarding Form Submitted → Sub-Account Provisioned → Credentials Sent → A2P Submitted → Active Member
- [ ] Build Support Pipeline:
  Support Request Open → In Review → Waiting on Member → Escalated → Resolved → Closed
- [ ] Build Sales Pipeline:
  New Lead → Contacted → Demo Scheduled → Demo Completed → Follow Up → Converted → Lost
- [ ] Build all HQ tags:
  Plan: Core, Plan: Growth, Plan: Pro, Plan: Trial
  Core Member, Onboarding Complete
  A2P Pending, A2P Submitted, A2P Approved
  Payment Received, Churned
  Support Open, Support Resolved
- [ ] Build HQ dashboard:
  - Active members count
  - Onboarding pipeline funnel
  - Open support requests
  - New members this month
  - Churned this month
- [ ] Get HQ Location ID → GHL_HQ_LOCATION_ID
- [ ] Get Onboarding Pipeline ID → GHL_ONBOARDING_PIPELINE_ID

### HQ Automations
- [ ] Tag: Payment Received → send onboarding email with form link
- [ ] Tag: Onboarding Complete → send welcome email with GHL login credentials + create task to provision sub-account
- [ ] Tag: A2P Pending → send A2P next steps email + create internal task
- [ ] Tag: Churned → send cancellation email + internal notification

---

## Sprint 3 — Payment & Onboarding Flow
**Goal:** Whop payment → DB record → HQ contact → onboarding form → provisioning → active member

### Whop Setup
- [ ] Create Whop account
- [ ] Create REIblast Core product at $57/mo
- [ ] Configure Whop checkout page branding (black/gold)
- [ ] Set success redirect URL: reiblast.app/onboarding?email={email}
- [ ] Set up webhook pointing to reiblast.app/api/webhooks/whop
- [ ] Get WHOP_WEBHOOK_SECRET
- [ ] Get WHOP_API_KEY
- [ ] Get NEXT_PUBLIC_WHOP_CHECKOUT_URL

### Whop Webhook Handler
- [ ] Build /api/webhooks/whop/route.ts
- [ ] Verify signature using WHOP_WEBHOOK_SECRET
- [ ] On membership.went_valid:
  - Upsert User in DB
  - Call createHQContact() → contactId
  - addTag(contactId, 'Payment Received')
  - moveToStage(contactId, 'Payment Received')
- [ ] On membership.went_invalid:
  - Update user status: inactive
  - removeTag(contactId, 'Core Member')
  - addTag(contactId, 'Churned')
  - suspendSubAccount(locationId)
- [ ] Test with Whop webhook simulator

### GHL Webhook Handler
- [ ] Build /api/webhooks/ghl/route.ts
- [ ] Verify x-reiblast-secret header
- [ ] Handle order events as fallback
- [ ] Test with GHL webhook test tool

### Onboarding Form
- [ ] Build /onboarding page — three step form
- [ ] Step 1: Business info fields
- [ ] Step 2: SMS compliance checkboxes
- [ ] Step 3: Review and submit
- [ ] Client-side validation (EIN format, required fields)
- [ ] Gold progress indicator between steps
- [ ] Loading state with cycling messages on submit
- [ ] Build /onboarding/success page
- [ ] Build /api/onboarding/submit route:
  - Validate all fields
  - Update User in DB
  - moveToStage(contactId, 'Onboarding Form Submitted')
  - provisionSubAccount() → locationId, tempPassword
  - Update User: ghlLocationId, status: active
  - populateA2PSite(locationId, businessData)
  - addTag(contactId, 'Onboarding Complete')
  - addTag(contactId, 'A2P Pending')
  - moveToStage(contactId, 'Active Member')
  - Return success → redirect to /onboarding/success

### GHL Sub-Account Provisioning (Phase 1 — Real Implementation)
- [ ] Wire provisionSubAccount() with real GHL API calls:
  - POST to GHL locations API to create sub-account
  - Apply GHL_SNAPSHOT_ID snapshot
  - Create GHL user login with temp password
  - Return locationId, userId, tempPassword
- [ ] Wire populateA2PSite() with real GHL API calls:
  - Update A2P template funnel custom values
  - Replace all placeholder fields with business data
- [ ] Test full provisioning flow end to end

---

## Sprint 4 — Marketing Site & Login Flow
**Goal:** Public marketing site live, login redirects to GHL, tools accessible from GHL sidebar

### Marketing Site Pages
- [ ] Build landing page:
  - Hero with LogoStacked, headline, two CTAs
  - Pain points strip
  - Features grid (6 cards)
  - How It Works (4 steps)
  - Pricing card ($57/mo)
  - Footer
- [ ] Build /pricing page
- [ ] Build /login page — spinner redirect to app.reiblast.app
- [ ] Build /terms page
- [ ] Build /privacy page
- [ ] All pages black background, gold accents
- [ ] Mobile responsive throughout

### Login Flow
- [ ] /login → 800ms delay → redirect to app.reiblast.app
- [ ] GHL login handles authentication
- [ ] After GHL login → member sees sidebar with tool links
- [ ] Sidebar links open tools as new focused windows with token param

### Shared Components
- [ ] Logo.tsx — LogoIcon, LogoFull, LogoStacked, LogoWordmark
- [ ] Button.tsx — primary, outline, ghost, danger variants
- [ ] Input.tsx — dark bg, gold focus, label, error
- [ ] Card.tsx — default, highlight, dark variants
- [ ] Spinner.tsx — gold animated

---

## Sprint 5 — Deal Analyzer
**Goal:** Full multi-step deal analyzer live at tools.reiblast.app/analyzer

### API Setup
- [ ] Get Rentcast API key → RENTCAST_API_KEY
- [ ] Get Google Places API key → NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
- [ ] Enable Google Places API in Google Cloud Console
- [ ] Restrict Google Places key to reiblast.app domains
- [ ] Get Anthropic API key → ANTHROPIC_API_KEY

### API Routes
- [ ] Build /api/analyzer/property:
  - Accept address string
  - Call Rentcast property details endpoint
  - Return mapped property object
- [ ] Build /api/analyzer/comps:
  - Accept address, lat, lng, radius, months
  - Call Rentcast comps endpoint
  - Filter +/- 1 bed and bath
  - Return sorted comp array
- [ ] Build /api/analyzer/arv:
  - Accept subject property + selected comps
  - Call Claude API (claude-sonnet-4-20250514)
  - Parse JSON response
  - Return structured analysis object

### Analyzer UI
- [ ] Build MinimalHeader component
- [ ] Step 1: Google Places autocomplete address input
- [ ] Step 2: Property confirmation card
- [ ] Step 3: Comp selection grid with filters
- [ ] Step 4: AI analysis results display:
  - ARV card with range and estimate
  - Three repair tier cards (light/medium/heavy)
  - MAO per tier
  - Deal score badge
  - AI narrative paragraph
  - Submit as JV Deal button
- [ ] Loading states with animated messages
- [ ] Error handling for API failures
- [ ] Test full flow end to end

### Widget Version
- [ ] Build compact /widget/analyzer for GHL iframe
- [ ] Build /widget/header for GHL dashboard banner
- [ ] Test both in GHL iframe embed

---

## Sprint 6 — JV Submission & Lead Sourcing Stubs
**Goal:** JV and leads pages live and accessible from GHL sidebar

### JV Submission Page
- [ ] Build /jv page with MinimalHeader
- [ ] Pre-fill from URL params (address, arv, mao, score)
- [ ] Form fields: address, market, ARV, purchase price, assignment fee, notes, contract upload
- [ ] Deal split display: 50/50 Core members
- [ ] Submit disabled with tooltip — placeholder for Phase 2

### Lead Sourcing Page
- [ ] Build /leads page with MinimalHeader
- [ ] DealMachine connection card (API key + connect)
- [ ] BatchLeads connection card (API key + connect)
- [ ] Store connection state in localStorage
- [ ] Search panel locked until connected
- [ ] Mock results table (5 rows)
- [ ] Import buttons disabled — placeholder for Phase 2

---

## Sprint 7 — QA & Launch
**Goal:** Everything tested end to end, live and taking signups

### Testing Checklist
- [ ] Full signup flow: Whop checkout → onboarding form → sub-account provisioned → HQ pipeline updated
- [ ] GHL login via app.reiblast.app
- [ ] Sidebar tool links open correctly with token
- [ ] Deal analyzer full flow: address → property → comps → ARV analysis
- [ ] JV page pre-fills from analyzer correctly
- [ ] Contract templates auto-populate from contact fields
- [ ] SMS sequences fire correctly in test sub-account
- [ ] Opt-out handling works
- [ ] Missed call text-back fires
- [ ] HQ automation tags trigger correct email sequences
- [ ] Snapshot applies cleanly to blank sub-account
- [ ] CSS theme looks correct in sub-account
- [ ] Favicon loads correctly
- [ ] Mobile responsive on all marketing pages
- [ ] All env vars set in Vercel production

### Go Live
- [ ] Point reiblast.app to Vercel production
- [ ] Confirm tools.reiblast.app resolves
- [ ] Confirm app.reiblast.app resolves to GHL
- [ ] Test Whop payment end to end with real card
- [ ] First real sub-account provisioned
- [ ] Ari reviews and approves
- [ ] Announce to existing Discord community

---

## Phase 2 Backlog (Post-Launch)
These are stubbed in the codebase and ready to wire up:

- [ ] Real GHL API calls for contact tagging and pipeline moves
- [ ] DealMachine API integration in leads portal
- [ ] BatchLeads API integration in leads portal
- [ ] JV submission backend — contract upload, deal review pipeline
- [ ] Automated sub-account phone number assignment
- [ ] Pro tier — sub-account management, API access
- [ ] Growth tier — own A2P registration flow
- [ ] NEPQ acquisitions bot deployment as add-on
- [ ] State-specific contract bundle add-on
- [ ] Deal analyzer saved history per user
- [ ] CRM Sync tool — direct import from leads portal to GHL
- [ ] Stripe direct integration for future pricing changes
- [ ] Grandfathering promo codes when price moves to $97

---

## Environment Variables Master List

| Variable | Sprint | Where To Get It |
|---|---|---|
| `DATABASE_URL` | 1 | Neon.tech → project → connection string |
| `GHL_CLIENT_ID` | 1 | GHL Agency → Private Integrations |
| `GHL_CLIENT_SECRET` | 1 | GHL Agency → Private Integrations |
| `GHL_SNAPSHOT_ID` | 2 | GHL Agency → Snapshots → snapshot ID |
| `GHL_HQ_LOCATION_ID` | 2 | GHL → HQ sub-account → Settings → Business Info |
| `GHL_ONBOARDING_PIPELINE_ID` | 2 | GHL → HQ sub-account → pipeline URL |
| `GHL_WEBHOOK_SECRET` | 2 | Generate: openssl rand -base64 32 |
| `WHOP_WEBHOOK_SECRET` | 3 | Whop → Developer → Webhooks |
| `WHOP_API_KEY` | 3 | Whop → Developer → API Keys |
| `NEXT_PUBLIC_WHOP_CHECKOUT_URL` | 3 | Whop → product checkout link |
| `RENTCAST_API_KEY` | 5 | app.rentcast.io → API Keys |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | 5 | Google Cloud Console → Places API |
| `GOOGLE_PLACES_API_KEY` | 5 | Google Cloud Console → Places API |
| `ANTHROPIC_API_KEY` | 5 | console.anthropic.com → API Keys |
| `NEXT_PUBLIC_APP_URL` | 1 | https://reiblast.app |
| `NEXT_PUBLIC_TOOLS_URL` | 1 | https://tools.reiblast.app |
| `NEXT_PUBLIC_GHL_APP_URL` | 1 | https://app.reiblast.app |

---

## Current Status

### Done ✅
- Brand name: REIblast
- Domain: reiblast.app (purchased, on IONOS → moving to Cloudflare)
- Logo suite (ChatGPT generated, being cleaned in Figma)
- Color scheme: black #0A0A0A, gold #F5C842, white, silver
- GHL CSS theme (v2 with black text fixes)
- PSA contract template in GHL
- Custom fields in GHL
- Tags in GHL
- Dashboard widgets in GHL
- Next.js project scaffolded by Claude Code

### In Progress 🔄
- Cloudflare nameserver propagation from IONOS
- Logo cleanup in Figma/Inkscape
- Claude Code building Next.js project

### Blocked ⛔
- Snapshot export — need Assignment contract and A2P funnel first
- Domain DNS — waiting on Cloudflare propagation
- Whop setup — pending account creation
- Rentcast and Google Places keys — pending signup
