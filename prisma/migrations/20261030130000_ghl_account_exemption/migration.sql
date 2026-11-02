-- AlterTable: special-account exemption (replaces coreCoveredUntil / coreCoverageNote, which stay in place, unused)
ALTER TABLE "GhlAccount" ADD COLUMN     "exemptReason" TEXT,
ADD COLUMN     "exemptUntil" TIMESTAMP(3);

-- Carry existing manual coverage over to the exemption fields (additive; the old columns are left untouched)
UPDATE "GhlAccount"
SET "exemptUntil" = "coreCoveredUntil", "exemptReason" = "coreCoverageNote"
WHERE "coreCoveredUntil" IS NOT NULL OR "coreCoverageNote" IS NOT NULL;
