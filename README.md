# REIblast

Real estate wholesaling SaaS platform. Serves two domains from one Next.js 15 deployment using middleware-based hostname routing.

| Domain | Purpose |
|--------|---------|
| `reiblast.app` | Public marketing site + signup flow |
| `tools.reiblast.app` | Member tools portal + GHL iframe widgets |

## Tech Stack

- **Next.js 15** App Router
- **TypeScript**
- **Tailwind CSS v4**
- **Prisma ORM v6** + Neon PostgreSQL
- **Stripe** — subscription billing
- **Resend** — transactional email (stubbed, ready for Phase 2)
- **NextAuth v4** — session management (JWT strategy)
- **bcryptjs** — password hashing

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.local` and fill in all values:

```bash
cp .env.local .env.local
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_CORE_PRICE_ID` | Stripe Price ID for REIblast Core ($57/mo) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `NEXTAUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Base URL (`https://reiblast.app` in production) |
| `GHL_API_KEY` | GoHighLevel API key |
| `GHL_LOCATION_ID` | GHL Agency location ID |
| `NEXT_PUBLIC_APP_URL` | `https://reiblast.app` |
| `NEXT_PUBLIC_TOOLS_URL` | `https://tools.reiblast.app` |

### 3. Database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations (requires DATABASE_URL)
npx prisma migrate dev --name init

# Seed promo codes (optional)
npx prisma studio
```

### 4. Run dev server

```bash
npm run dev
```

The marketing site is at `http://localhost:3000`. To test the tools portal locally, either set up a subdomain proxy or temporarily modify middleware.ts to route `/tools` based on path.

## Vercel Deployment — Two-Domain Setup

### Step 1: Deploy to Vercel

Push to GitHub and import the repo at vercel.com/new. Add all environment variables in the Vercel project settings.

### Step 2: Add both domains

In your Vercel project → **Settings → Domains**, add:

- `reiblast.app`
- `tools.reiblast.app`

Both domains point to the same Next.js deployment. The middleware reads the `host` header and rewrites routes accordingly.

### Step 3: DNS

Point both domains to Vercel's nameservers or add the CNAME/A records Vercel provides.

### Step 4: Stripe webhook

In the Stripe Dashboard → Webhooks, create an endpoint:

```
https://reiblast.app/api/stripe/webhook
```

Listen for:
- `checkout.session.completed`
- `customer.subscription.deleted`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Project Structure

```
app/
  marketing/          ← reiblast.app routes
    layout.tsx
    page.tsx
    pricing/page.tsx
    signup/page.tsx
    login/page.tsx
  tools/              ← tools.reiblast.app routes
    layout.tsx
    page.tsx
    analyzer/page.tsx
    jv/page.tsx
    leads/page.tsx
    widget/           ← GHL iframe embeds (no chrome)
      layout.tsx
      header/page.tsx
      analyzer/page.tsx
  api/
    auth/
      [...nextauth]/route.ts   ← NextAuth
      signup/route.ts          ← User registration + Stripe checkout
    stripe/webhook/route.ts    ← Stripe events
    promo/validate/route.ts    ← Promo code validation (stubbed UI)
components/
  shared/             ← Logo, Button, Input, Card
  marketing/          ← Nav, Hero, Features, Pricing, Footer
  tools/              ← ToolsNav
lib/
  constants.ts        ← Brand/config constants
  prisma.ts           ← PrismaClient singleton
  stripe.ts           ← Stripe client + createCheckoutSession
  ghl.ts              ← GHL provisioning (stub, ready for Phase 2)
  resend.ts           ← Email sending (stub, ready for Phase 2)
  promo.ts            ← Promo code validation logic
middleware.ts         ← Hostname-based routing
prisma.config.ts      ← Prisma v6 datasource config for migrations
```

## GHL Widget Embedding

The widget routes (`/widget/header`, `/widget/analyzer`) render with zero chrome — no nav, no padding, transparent background. Embed them in GHL custom pages as iframes:

```html
<!-- Dashboard header banner -->
<iframe src="https://tools.reiblast.app/widget/header"
  width="100%" height="80" frameborder="0" scrolling="no" />

<!-- Deal analyzer widget -->
<iframe src="https://tools.reiblast.app/widget/analyzer"
  width="600" height="320" frameborder="0" />
```

Widget routes bypass the session check in middleware — they are publicly accessible on the tools subdomain.

## Sub-Account Provisioning

Sub-account provisioning is triggered by a GHL automation webhook when the onboarding pipeline stage moves to **"Onboarding Form Submitted"**. This is a manual trigger from GHL — not Whop.

### Webhook endpoint

```
POST /api/webhooks/ghl-provision
```

Secured with the `x-reiblast-secret` header (value must match `GHL_WEBHOOK_SECRET`).

### Expected payload

```json
{
  "contactId": "string",
  "email": "string",
  "name": "string",
  "phone": "string",
  "businessName": "string",
  "ein": "string",
  "businessAddress": "string",
  "businessCity": "string",
  "businessState": "string",
  "businessZip": "string",
  "targetMarket": "string"
}
```

### Provisioning env vars

| Variable | Description |
|----------|-------------|
| `GHL_AGENCY_ID` | Your GHL agency company ID |
| `GHL_SAAS_PLAN_ID` | The 9999-day trial SaaS plan ID from the SaaS configurator |
| `GHL_SNAPSHOT_ID` | REIblast Core v1 snapshot ID |
| `GHL_AGENCY_API_KEY` | Agency-level PIT key |
| `GHL_HQ_API_KEY` | HQ sub-account PIT key |
| `GHL_WEBHOOK_SECRET` | Shared secret for webhook header verification |

## Phase 2 Roadmap

- `lib/ghl.ts` — wire up real GHL API to provision sub-accounts on signup
- `lib/resend.ts` — wire up Resend templates for welcome + billing emails
- CRM Sync tool (currently marked "Coming Soon")
- Forgot password flow
- Admin dashboard
