// SYNTHETIC records modeled on GHL shapes (list endpoint + single-transaction endpoint).
// No real names, emails, or ids.
type Overrides = {
  id?: string;
  amount?: number;
  status?: string;
  liveMode?: boolean;
  entityType?: string;
  subType?: string | null;
  sourceType?: string;
  description?: string | null;
  subscriptionId?: string | null;
  provider?: string;
  fulfilledAt?: string | null;
  createdAt?: string;
  amountRefunded?: number;
  contactId?: string;
};

const base = (o: Overrides) => ({
  id: o.id ?? "aaaaaaaaaaaaaaaaaaaaaaa1",
  contactId: o.contactId ?? "cccccccccccccccccc01",
  amount: o.amount ?? 57,
  status: o.status ?? "succeeded",
  liveMode: o.liveMode ?? true,
  entityType: o.entityType ?? "order",
  provider: o.provider ?? "authorize-net",
  fulfilledAt: o.fulfilledAt === undefined ? "2026-09-01T12:00:00.000Z" : o.fulfilledAt,
  createdAt: o.createdAt ?? "2026-09-01T11:59:59.000Z",
  amountRefunded: o.amountRefunded ?? 0,
  subType: o.subType === undefined ? null : o.subType,
  sourceType: o.sourceType ?? "manual",
  description: o.description ?? null,
  subscriptionId: o.subscriptionId === undefined ? null : o.subscriptionId,
});

/** List-endpoint shape (flat entitySource*). */
export function listTxn(o: Overrides = {}) {
  const b = base(o);
  return {
    _id: b.id,
    altId: "LOCATION0000000000001",
    altType: "location",
    contactId: b.contactId,
    contactName: "Test Person",
    contactEmail: "test@example.com",
    currency: "USD",
    amount: b.amount,
    status: b.status,
    liveMode: b.liveMode,
    entityType: b.entityType,
    entitySourceType: b.sourceType,
    ...(b.subType ? { entitySourceSubType: b.subType } : {}),
    ...(b.description ? { entitySourceMeta: { description: b.description } } : { entitySourceMeta: {} }),
    ...(b.subscriptionId ? { subscriptionId: b.subscriptionId } : {}),
    chargeId: "900000000001",
    paymentProviderType: b.provider,
    amountRefunded: b.amountRefunded,
    ...(b.fulfilledAt ? { fulfilledAt: b.fulfilledAt } : {}),
    createdAt: b.createdAt,
  };
}

/** Single-endpoint shape: array of one, nested entitySource / paymentProvider. */
export function singleTxn(o: Overrides = {}) {
  const b = base(o);
  return [
    {
      _id: b.id,
      altId: "LOCATION0000000000001",
      altType: "location",
      contactId: b.contactId,
      currency: "USD",
      amount: b.amount,
      status: b.status,
      liveMode: b.liveMode,
      entityType: b.entityType,
      entitySource: {
        type: b.sourceType,
        id: "sssssssssssssssssss1",
        name: "Test Source",
        ...(b.subType ? { subType: b.subType } : {}),
        meta: b.description ? { description: b.description } : {},
      },
      ...(b.subscriptionId ? { subscriptionId: b.subscriptionId } : {}),
      chargeId: "900000000001",
      paymentProvider: { type: b.provider, connectedAccount: { accountId: "0000000" } },
      amountRefunded: b.amountRefunded,
      ...(b.fulfilledAt ? { fulfilledAt: b.fulfilledAt } : {}),
      createdAt: b.createdAt,
    },
  ];
}

export const AUTO_DESC = "Auto-Recharge for Sub-Account Test Business (https://app.example.test/v2/location/LOCATION0000000000002/settings)";
export const MANUAL_DESC = "Manual Recharge for Location Wallet";
