// READ-ONLY. August 2026 wallet transactions per location (filters.locationId). Usage: node wallet-aug.mjs [pilot|all]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { out, walletTx, stats } from "./wallet-lib.mjs";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const FROM = "2026-08-01T00:00:00.000Z", TO = "2026-08-31T23:59:59.999Z";
const mode = process.argv[2] ?? "pilot";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const users = await prisma.user.findMany({ where: { ghlLocationId: { not: null } }, select: { ghlLocationId: true } });
await prisma.$disconnect();
const locs = [...new Set(users.map((u) => u.ghlLocationId))];
console.log("distinct member locations:", locs.length);
const dir = path.join(out, "wallet-aug"); fs.mkdirSync(dir, { recursive: true });
const targets = mode === "pilot" ? locs.slice(0, 1) : locs;
const summary = [];
for (const loc of targets) {
  let skip = 0, rows = [], pages = 0;
  for (;;) {
    const r = await walletTx(skip, FROM, TO, loc);
    const t = r.json?.data?.transactions;
    if (!Array.isArray(t)) { console.error("unexpected response", r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(3); }
    rows.push(...t); pages++;
    if (new Set(rows.map((x) => x.locationName || "(blank)")).size > 1) {
      console.error(`ABORT: …${loc.slice(-4)} returned >1 locationName — filters.locationId is not applied. calls=${stats.calls}`);
      process.exit(4);
    }
    if (t.length < 1000) break;
    skip += 1000;
  }
  const names = new Set(rows.map((x) => x.locationName || "(blank)"));
  fs.writeFileSync(path.join(dir, `${loc}.json`), JSON.stringify({ locationId: loc, rows }));
  summary.push({ loc: "…" + loc.slice(-4), rows: rows.length, pages, distinctLocationNames: names.size });
  console.log("…" + loc.slice(-4), "rows", rows.length, "pages", pages, "distinct locationName", names.size);
  if (mode === "pilot" && names.size > 1) console.log("WARNING: filter may not be applied");
}
fs.writeFileSync(path.join(out, "wallet-aug-summary.json"), JSON.stringify({ mode, summary, calls: stats.calls }));
console.log("API calls:", stats.calls);
