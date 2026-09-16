-- checkout.ts and the webhook both need to reverse-lookup an in-bundle
-- line's Price -> its BundlePriceOverride row, the same way they already do
-- for Tier.stripePriceId. All rows are currently null (Pass 1 seeded no
-- Stripe Prices), so this is safe.
CREATE UNIQUE INDEX "BundlePriceOverride_stripePriceId_key" ON "BundlePriceOverride"("stripePriceId");
