import { NextRequest, NextResponse } from "next/server";
import { logAdmin, clientIp } from "@/lib/admin/audit";
import { csvStream } from "@/lib/admin/csv";
import { buildExport, isExportView } from "@/lib/admin/exports";
import { ownerOr401 } from "@/lib/admin/requireOwner";
import { getBillingDb } from "@/lib/billing/db";

// Not covered by middleware (it excludes /api): requireOwner runs here, on every request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // Hobby cap; raw exports are limited to one Denver month and streamed in ~5k-row chunks

export async function GET(req: NextRequest, { params }: { params: { view: string } }) {
  const owner = await ownerOr401(req);
  if (owner instanceof NextResponse) return owner;

  if (!isExportView(params.view)) return NextResponse.json({ error: "Unknown export view" }, { status: 404 });
  const db = await getBillingDb();
  const now = new Date();
  const built = await buildExport(params.view, db, req.nextUrl.searchParams, { hq: process.env.GHL_HQ_LOCATION_ID ?? null, now });
  if (!built.ok) return NextResponse.json({ error: built.message }, { status: built.status });

  const ip = clientIp(req.headers);
  const stream = csvStream(built.spec, now, async ({ rowCount, partial }) => {
    await logAdmin(db, "export", { view: built.spec.view, filters: built.spec.filters, rowCount, ...(partial ? { partial: true } : {}) }, ip);
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${built.filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
