/**
 * The ONLY code that reads BillingLedgerEntry.raw / GHL transaction payloads.
 *
 * GHL returns transactions in two shapes:
 *  - list endpoint (GET /payments/transactions): flat `entitySourceType|SubType|Name|Id|Meta`,
 *    `paymentProviderType`.
 *  - single endpoint (GET /payments/transactions/{id}): an ARRAY of one record with a nested
 *    `entitySource: { type, subType, name, id, meta }` and `paymentProvider: { type, ... }`.
 * Everything downstream (classifier, ingest) sees only NormalizedTransaction.
 */

export type NormalizedTransaction = {
  id: string;
  contactId: string | null;
  status: string;
  amount: number;
  amountRefunded: number;
  liveMode: boolean | null;
  entityType: string | null;
  entitySourceType: string | null;
  entitySourceSubType: string | null;
  /** entitySourceMeta.description / entitySource.meta.description (fallback: chargeSnapshot.order.description). */
  description: string | null;
  subscriptionId: string | null;
  provider: string | null;
  occurredAt: Date;
  /** Gateway fields (Authorize.net chargeSnapshot). `chargeId` is the processor's id; "0" means no gateway charge happened. */
  chargeId: string | null;
  hasChargeSnapshot: boolean;
  transactionType: string | null;
  cardBrand: string | null;
  /** Integer cents of chargeSnapshot.settleAmount / authAmount (never the fractional GHL `amount`). */
  settleAmountCents: number | null;
  authAmountCents: number | null;
  submitTimeUtc: Date | null;
  avsCode: string | null;
  responseCode: number | null;
  isAuthorizeNet: boolean;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Unwraps an array-of-one to the record itself; returns the record exactly as received otherwise. */
export function unwrapTransaction(input: unknown): Obj {
  const rec = Array.isArray(input) ? input[0] : input;
  if (!isObj(rec)) throw new Error("normalizeTransaction: not a transaction record");
  return rec;
}

export function normalizeTransaction(input: unknown): NormalizedTransaction {
  const r = unwrapTransaction(input);
  const id = str(r._id);
  if (!id) throw new Error("normalizeTransaction: missing _id");

  const nested = isObj(r.entitySource); // single-endpoint shape
  const source = nested ? (r.entitySource as Obj) : null;
  const sourceMeta = nested ? source?.meta : r.entitySourceMeta;
  const snapshotOrder = isObj(r.chargeSnapshot) && isObj(r.chargeSnapshot.order) ? r.chargeSnapshot.order : null;

  const provider = isObj(r.paymentProvider) ? str(r.paymentProvider.type) : str(r.paymentProviderType);

  const occurred = str(r.fulfilledAt) ?? str(r.createdAt);
  const occurredAt = occurred ? new Date(occurred) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) throw new Error("normalizeTransaction: no fulfilledAt/createdAt");

  const amount = num(r.amount);
  if (amount === null) throw new Error("normalizeTransaction: missing amount");

  const snap = isObj(r.chargeSnapshot) ? r.chargeSnapshot : null;
  const card = snap && isObj(snap.payment) && isObj(snap.payment.creditCard) ? snap.payment.creditCard : null;
  const cents = (v: unknown): number | null => {
    const n = num(v);
    return n === null ? null : Math.round(n * 100);
  };
  const submit = snap ? str(snap.submitTimeUTC) : null;
  const submitTimeUtc = submit && !Number.isNaN(new Date(submit).getTime()) ? new Date(submit) : null;
  // chargeId can arrive as a string or a number.
  const chargeId = typeof r.chargeId === "number" ? String(r.chargeId) : str(r.chargeId);

  return {
    id,
    contactId: str(r.contactId),
    status: str(r.status) ?? "unknown",
    amount,
    amountRefunded: num(r.amountRefunded) ?? 0,
    liveMode: typeof r.liveMode === "boolean" ? r.liveMode : null,
    entityType: str(r.entityType),
    entitySourceType: nested ? str(source?.type) : str(r.entitySourceType),
    entitySourceSubType: nested ? str(source?.subType) : str(r.entitySourceSubType),
    description:
      (isObj(sourceMeta) ? str(sourceMeta.description) : null) ?? (snapshotOrder ? str(snapshotOrder.description) : null),
    subscriptionId: str(r.subscriptionId),
    provider,
    occurredAt,
    chargeId,
    hasChargeSnapshot: snap !== null,
    transactionType: snap ? str(snap.transactionType) : null,
    cardBrand: card ? str(card.cardType) : null,
    settleAmountCents: snap ? cents(snap.settleAmount) : null,
    authAmountCents: snap ? cents(snap.authAmount) : null,
    submitTimeUtc,
    avsCode: snap ? str(snap.AVSResponse) : null,
    responseCode: snap ? num(snap.responseCode) : null,
    isAuthorizeNet: provider === "authorize-net",
  };
}
