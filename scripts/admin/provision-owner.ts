/**
 * Provision the internal owner account used by the admin entry flow (pipeline DB only).
 *
 *   PRISMA_TARGET=dev npx tsx scripts/admin/provision-owner.ts --email=<agency email> --contact-id=<HQ contact id> [--name="Stephen Helman"]          # dry-run
 *   PRISMA_TARGET=dev npx tsx scripts/admin/provision-owner.ts --email=… --contact-id=… --apply                                                     # write
 *
 * Creates ONE User (status "active"; role, User.ghl* and REItools fields untouched) and ONE GhlAccount
 * (contactId, locationId = GHL_HQ_LOCATION_ID, accountType "internal", billingState null).
 * Read-only GHL GET first: the contact must exist in the HQ location and have a phone number.
 * If a User with this email (or a GhlAccount with this contact/location) already exists, it reports it and STOPS — nothing is changed.
 * Refuses the production host.
 */
import { arg, connect } from "../billing/_cli";

const { db, apply } = connect();

const maskEmail = (e: string) => `${e.slice(0, 2)}***@${e.split("@")[1] ?? "?"}`;
const maskPhone = (p: string) => `${p.replace(/\d/g, "•").slice(0, Math.max(0, p.length - 4))}${p.slice(-4)}`;

async function main() {
  const email = arg("email");
  const contactId = arg("contact-id");
  const name = arg("name") ?? "Stephen Helman";
  const hq = process.env.GHL_HQ_LOCATION_ID;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email=<agency email> is required");
  if (!contactId || !/^[A-Za-z0-9]{10,64}$/.test(contactId)) throw new Error("--contact-id=<HQ contact id> is required");
  if (!hq) throw new Error("GHL_HQ_LOCATION_ID is not set");
  if (!process.env.GHL_HQ_API_KEY) throw new Error("GHL_HQ_API_KEY is not set");

  console.log(`Email: ${maskEmail(email)}   Contact: …${contactId.slice(-4)}   HQ location: …${hq.slice(-4)}\n`);

  // 1. Read-only GHL check.
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${process.env.GHL_HQ_API_KEY}`, Version: "2021-07-28", Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as { contact?: { locationId?: string; phone?: string | null } };
  const contact = body.contact;
  console.log(`GHL GET /contacts/…${contactId.slice(-4)}: HTTP ${res.status}`);
  const problems: string[] = [];
  if (res.status !== 200 || !contact) problems.push(`contact not readable (HTTP ${res.status})`);
  else {
    if (contact.locationId !== hq) problems.push(`contact is in a different location (…${(contact.locationId ?? "?").slice(-4)}), not the HQ location`);
    if (!contact.phone) problems.push("contact has no phone number");
    else console.log(`  in HQ location: ${contact.locationId === hq ? "yes" : "NO"}   phone: ${maskPhone(contact.phone)}`);
  }

  // 2. Existing rows → report and stop.
  const [user, byContact, byLocation] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { id: true, status: true, role: true } }),
    db.ghlAccount.findUnique({ where: { contactId }, select: { id: true, accountType: true } }),
    db.ghlAccount.findUnique({ where: { locationId: hq }, select: { id: true, accountType: true, contactId: true } }),
  ]);
  if (user) problems.push(`a User with this email already exists (id …${user.id.slice(-4)}, status ${user.status}, role ${user.role}) — not modified`);
  if (byContact) problems.push(`a GhlAccount with this contactId already exists (${byContact.accountType}) — not modified`);
  if (byLocation) problems.push(`a GhlAccount already has locationId = HQ (${byLocation.accountType}, contact …${byLocation.contactId.slice(-4)}) — not modified`);

  if (problems.length) {
    console.log("\nSTOPPING — nothing changed:");
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPlanned rows:");
  console.log(`  User        email=${maskEmail(email)} name="${name}" status=active (role/ghl*/REItools fields left at schema defaults)`);
  console.log(`  GhlAccount  contactId=…${contactId.slice(-4)} locationId=…${hq.slice(-4)} accountType=internal billingState=null`);

  if (!apply) {
    console.log("\nDry-run: nothing written. Re-run with --apply.");
    return;
  }
  const created = await db.user.create({
    data: { email, name, status: "active", ghlAccount: { create: { contactId, locationId: hq, accountType: "internal" } } },
    select: { id: true, ghlAccount: { select: { id: true, accountType: true } } },
  });
  console.log(`\nCreated User …${created.id.slice(-4)} and GhlAccount …${created.ghlAccount?.id.slice(-4)} (${created.ghlAccount?.accountType}).`);
  console.log("Set ADMIN_LOCATION_IDS to the HQ location id in the environment.");
}

main().finally(() => db.$disconnect());
