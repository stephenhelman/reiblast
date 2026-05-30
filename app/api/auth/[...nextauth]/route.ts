// Auth is handled by GHL — this route is not used.
// See: middleware.ts for hostname routing, app.reiblast.app for GHL login.
export function GET() {
  return new Response(null, { status: 404 })
}

export function POST() {
  return new Response(null, { status: 404 })
}
