-- Replace-not-stack: one active tool_sub per (user, feature). Partial so it
-- only constrains active tool_sub rows; bundle rows and non-active rows are
-- unconstrained by this index (bundle-vs-solo overlap is resolved at read
-- time by resolveFeature, not here).
CREATE UNIQUE INDEX "Subscription_active_tool_sub_per_user_feature"
  ON "Subscription" ("userId", "featureId")
  WHERE "status" = 'active' AND "type" = 'tool_sub';

-- A tool_sub row must carry tierId (not bundleId); a bundle row must carry
-- bundleId (not tierId). Enum values confirmed against schema.prisma's
-- SubscriptionType (tool_sub | bundle).
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_type_matches_fk_check"
  CHECK (
    ("type" = 'tool_sub' AND "tierId" IS NOT NULL AND "bundleId" IS NULL)
    OR
    ("type" = 'bundle' AND "bundleId" IS NOT NULL AND "tierId" IS NULL)
  );
