/**
 * GHL's STANDARD webhook action sends a fixed top-level shape and lets a workflow add custom fields only under
 * `customData`. Our stage-changed/invoice-event contracts read contactId/pipeline/stage/invoiceId/secret from
 * `customData` first, falling back to a flat top-level field so a manual curl test (which posts flat JSON without
 * wrapping in customData) still works. See docs/oct1-release.md and docs/ghl-workflows.md for the full contract.
 */
export function customDataField(body: Record<string, unknown>, key: string): unknown {
  const customData = body.customData;
  if (customData && typeof customData === "object" && !Array.isArray(customData) && key in (customData as Record<string, unknown>)) {
    return (customData as Record<string, unknown>)[key];
  }
  return body[key];
}

/** Same lookup, narrowed to a non-empty trimmed string, or undefined. */
export function customDataStringField(body: Record<string, unknown>, key: string): string | undefined {
  const v = customDataField(body, key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Returns a copy of `body` safe to persist (e.g. into GhlEvent.payload): if `customData.secret` is present, it is
 * replaced with a fixed redaction marker so the shared secret never lands in stored payloads, logs, or error
 * messages. Never mutates the input.
 */
export function redactCustomDataSecret(body: Record<string, unknown>): Record<string, unknown> {
  const customData = body.customData;
  if (!customData || typeof customData !== "object" || Array.isArray(customData) || !("secret" in (customData as Record<string, unknown>))) {
    return body;
  }
  return { ...body, customData: { ...(customData as Record<string, unknown>), secret: "[redacted]" } };
}
