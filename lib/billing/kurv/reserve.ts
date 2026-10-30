/** Reserve fund: 10% of settled sales is company money, tracked on its own and never split with the partner. */

export type ReserveMovementKind = "release" | "withdrawal" | "adjustment";
export type ReserveMovement = { kind: ReserveMovementKind; amountCents: number };

export const reserveOnGross = (grossCents: number, rate: number): number => Math.round(grossCents * rate);

/**
 * Signed effect of a movement on the fund balance. `amountCents` is entered positive for release/withdrawal.
 * A release is Kurv paying reserve out to Ari's bank (fund goes DOWN, and the deposit is excluded from statement income);
 * a withdrawal is the company taking money out of the fund. Adjustments carry their own sign.
 */
export function movementDelta(m: ReserveMovement): number {
  return m.kind === "adjustment" ? m.amountCents : -Math.abs(m.amountCents);
}

/** Opening balance + reserve funded by batches ± movements. */
export function reserveBalance(openingCents: number, fundedCents: number, movements: readonly ReserveMovement[]): number {
  return openingCents + fundedCents + movements.reduce((s, m) => s + movementDelta(m), 0);
}

/** Bank deposits that are reserve releases, to be excluded from statement income. */
export const releasesTotal = (movements: readonly ReserveMovement[]): number =>
  movements.filter((m) => m.kind === "release").reduce((s, m) => s + Math.abs(m.amountCents), 0);
