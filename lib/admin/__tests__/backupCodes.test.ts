import { describe, expect, it } from "vitest";
import { consumeBackupCode, generateBackupCode, hashBackupCode, looksLikeBackupCode, normalizeBackupCode } from "../backupCodes";
import { makeFakeDb } from "./fakeDb";

describe("backup codes", () => {
  it("generates 80-bit codes in XXXX-XXXX-XXXX-XXXX form, all distinct", () => {
    const codes = Array.from({ length: 50 }, generateBackupCode);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect(new Set(codes).size).toBe(50);
  });

  it("normalizes case, dashes and spaces before hashing", () => {
    expect(normalizeBackupCode("abcd-efgh ijkl-mnop")).toBe("ABCDEFGHIJKLMNOP");
    expect(hashBackupCode("abcd-efgh-ijkl-mnop")).toBe(hashBackupCode("ABCDEFGHIJKLMNOP"));
    expect(looksLikeBackupCode("123456")).toBe(false);
  });

  it("consumes each code exactly once and never stores the plaintext", async () => {
    const { db, backup } = makeFakeDb();
    const [a, b] = [generateBackupCode(), generateBackupCode()];
    await db.adminBackupCode.create({ data: { codeHash: hashBackupCode(a) } });
    await db.adminBackupCode.create({ data: { codeHash: hashBackupCode(b) } });
    expect(JSON.stringify(backup.rows)).not.toContain(a);

    expect(await consumeBackupCode(db, a.toLowerCase())).toBe(true);
    expect(await consumeBackupCode(db, a)).toBe(false); // second use
    expect(await consumeBackupCode(db, b)).toBe(true); // other codes unaffected
    expect(await consumeBackupCode(db, generateBackupCode())).toBe(false); // unknown
  });

  it("concurrent consumption succeeds for exactly one caller", async () => {
    const { db } = makeFakeDb();
    const code = generateBackupCode();
    await db.adminBackupCode.create({ data: { codeHash: hashBackupCode(code) } });
    const results = await Promise.all([consumeBackupCode(db, code), consumeBackupCode(db, code), consumeBackupCode(db, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
