-- BundlePriceOverride.stripePriceId is null until Pass 2 mints the real
-- in-bundle Stripe Price — same pattern as CreditPack.stripePriceId. Needed
-- so this pass's reseed can insert the five known override rows (feature,
-- level, bundle) before Stripe wiring exists.
ALTER TABLE "BundlePriceOverride" ALTER COLUMN "stripePriceId" DROP NOT NULL;
