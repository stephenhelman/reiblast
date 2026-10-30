import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhlScopeError, walletTransactionsPage } from "../ghlWallet";

const ok = () => ({ status: 200, text: async () => JSON.stringify({ data: { transactions: [{ id: "t1" }] } }) }) as unknown as Response;
const status = (n: number) => ({ status: n, text: async () => "<html>error</html>" }) as unknown as Response;
const run = async (p: Promise<unknown>) => { const settled = p.then((v) => ({ v }), (e) => ({ e })); await vi.runAllTimersAsync(); return settled; };

beforeEach(() => {
  vi.useFakeTimers();
  process.env.GHL_AGENCY_API_KEY = "k";
  process.env.GHL_COMPANY_ID = "company";
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("wallet client retries", () => {
  it("retries a Cloudflare 520 and a 502, then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(status(520)).mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    const r = (await run(walletTransactionsPage({ skip: 0, from: "a", to: "b" }))) as { v: unknown };
    expect(r.v).toEqual([{ id: "t1" }]);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("retries network errors and 429", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", f);
    expect(((await run(walletTransactionsPage({ skip: 0, from: "a", to: "b" }))) as { v: unknown }).v).toEqual([{ id: "t1" }]);
  });
  it("gives up after 6 attempts and names the last status", async () => {
    const f = vi.fn().mockResolvedValue(status(520));
    vi.stubGlobal("fetch", f);
    const r = (await run(walletTransactionsPage({ skip: 0, from: "a", to: "b" }))) as { e: Error };
    expect(r.e.message).toMatch(/retries exhausted after 6 attempts \(last: HTTP 520\)/);
    expect(f).toHaveBeenCalledTimes(6);
  });
  it("never retries auth errors", async () => {
    const f = vi.fn().mockResolvedValue(status(401));
    vi.stubGlobal("fetch", f);
    const r = (await run(walletTransactionsPage({ skip: 0, from: "a", to: "b" }))) as { e: Error };
    expect(r.e).toBeInstanceOf(GhlScopeError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a 4xx other than 429 is returned to the caller's own error, not retried", async () => {
    const f = vi.fn().mockResolvedValue(status(400));
    vi.stubGlobal("fetch", f);
    const r = (await run(walletTransactionsPage({ skip: 0, from: "a", to: "b" }))) as { e: Error };
    expect(r.e.message).toMatch(/HTTP 400/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
