import { beforeEach, describe, expect, it, vi } from "vitest";

// No real database, GHL call or SMS: prisma, the GHL helper and global fetch are all mocked.
const stored: Record<string, any> = {};
const update = vi.fn(async ({ data }: any) => void Object.assign(stored, data));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: (a: any) => update(a), findUnique: async () => ({ ...stored }) } } }));
vi.mock("@/lib/ghl", () => ({ updateHQContact: vi.fn(async () => {}) }));

import { mintOtp, verifyOtp } from "@/lib/otp";

const fetchMock = vi.fn();
const sentMessage = () => JSON.parse(fetchMock.mock.calls[0][1].body).message as string;

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k];
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ conversationId: "c", messageId: "m" }), text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
  process.env.GHL_OTP_WEBHOOK_URL_ONBOARDING = "https://hooks.test/onboarding";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("code generation", () => {
  it("is always exactly 6 digits, 100000–999999 (same format as before randomInt)", async () => {
    for (let i = 0; i < 300; i++) {
      await mintOtp({ userId: "U1", contactId: "C1", phone: "", flow: "tools" });
      expect(stored.otpCode).toMatch(/^[1-9]\d{5}$/);
    }
  });
  it("a minted code round-trips through verifyOtp", async () => {
    await mintOtp({ userId: "U1", contactId: "C1", phone: "", flow: "discord" });
    Object.assign(stored, { otpAttempts: 0 });
    expect(await verifyOtp({ userId: "U1", code: stored.otpCode })).toEqual({ status: "success" });
  });
});

describe("delivery per flow", () => {
  it("discord: Conversations API SMS to the HQ contact, with the approved wording", async () => {
    expect(await mintOtp({ userId: "U1", contactId: "CONTACT1", phone: "", flow: "discord" })).toEqual({ success: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://services.leadconnectorhq.com/conversations/messages");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ type: "SMS", contactId: "CONTACT1" });
    expect(sentMessage()).toBe(`Your REIblast Discord verification code is ${stored.otpCode}. It expires in 10 minutes. REIblast staff will never ask for this code. If you didn't request it, ignore this message.`);
  });
  it("tools: unchanged wording and path", async () => {
    await mintOtp({ userId: "U1", contactId: "CONTACT1", phone: "", flow: "tools" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://services.leadconnectorhq.com/conversations/messages");
    expect(sentMessage()).toBe(`Your REIblast tools verification code is ${stored.otpCode}. It expires in 10 minutes.`);
  });
  it("onboarding: unchanged — posts {contactId, code, phone} to the onboarding webhook", async () => {
    await mintOtp({ userId: "U1", contactId: "CONTACT1", phone: "+15555550100", flow: "onboarding" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.test/onboarding");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ contactId: "CONTACT1", code: stored.otpCode, phone: "+15555550100" });
  });
  it("discord delivery failure returns delivery_failed and logs neither the code nor the response body", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "contact phone +15555550100 invalid" });
    expect(await mintOtp({ userId: "U1", contactId: "CONTACT1", phone: "", flow: "discord" })).toEqual({ success: false, reason: "delivery_failed" });
    const logged = (console.error as any).mock.calls.flat().join(" ") + (console.log as any).mock.calls.flat().join(" ");
    expect(logged).not.toContain(stored.otpCode);
    expect(logged).not.toContain("5555550100");
  });
});
