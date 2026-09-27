/**
 * TOTP + backup codes for the /admin/login fallback (GHL-is-down path).
 *
 *   PRISMA_TARGET=dev npx tsx scripts/admin/setup-owner-auth.ts            # dry-run (nothing generated or stored)
 *   PRISMA_TARGET=dev npx tsx scripts/admin/setup-owner-auth.ts --apply    # generate, store backup-code HASHES, print secrets ONCE
 *   … --apply --rotate   # retire existing unused backup codes (marked used, not deleted) and issue 10 new ones
 *
 * The TOTP secret is NOT stored by this script: put it in ADMIN_TOTP_SECRET (Vercel + .env.local) and add it to an
 * authenticator app by hand (manual entry / the otpauth:// URI — no QR library). Refuses the production host.
 */
import { generateBackupCode, hashBackupCode } from "../../lib/admin/backupCodes";
import { generateTotpSecret, otpauthUri } from "../../lib/admin/totp";
import { connect } from "../billing/_cli";

const { db, apply } = connect();
const rotate = process.argv.includes("--rotate");
const COUNT = 10;

async function main() {
  const unused = await db.adminBackupCode.count({ where: { usedAt: null } });
  const total = await db.adminBackupCode.count();
  console.log(`Existing backup codes: ${total} (${unused} unused)`);

  if (unused > 0 && !rotate) {
    console.log("Unused backup codes already exist — refusing to add more. Use --rotate to retire them and issue new ones.");
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\nDry-run: would generate a fresh base32 TOTP secret (+ otpauth:// URI) and ${COUNT} backup codes${rotate ? ", retiring the existing unused ones" : ""}.`);
    console.log("otpauth URI shape: " + otpauthUri("<SECRET>", "owner").replace(/%3C|%3E/g, ""));
    console.log("Nothing generated, nothing stored. Re-run with --apply.");
    return;
  }

  const secret = generateTotpSecret();
  const codes = Array.from({ length: COUNT }, generateBackupCode);
  await db.$transaction([
    ...(rotate ? [db.adminBackupCode.updateMany({ where: { usedAt: null }, data: { usedAt: new Date() } })] : []),
    db.adminBackupCode.createMany({ data: codes.map((c) => ({ codeHash: hashBackupCode(c) })) }),
  ]);

  console.log("\n=== SAVE THESE NOW — shown once ===");
  console.log(`\nADMIN_TOTP_SECRET=${secret}`);
  console.log(`otpauth URI: ${otpauthUri(secret, "owner")}`);
  console.log(`\nBackup codes (each works once):`);
  for (const c of codes) console.log(`  ${c}`);
  console.log(`\nStored ${COUNT} hashes. The secret is not stored anywhere — set ADMIN_TOTP_SECRET yourself.`);
}

main().finally(() => db.$disconnect());
