ALTER TABLE "subscription_plans"
  ADD COLUMN "billing_interval_days" INTEGER NOT NULL DEFAULT 30;
UPDATE "subscription_plans"
SET "billing_interval_days" = CASE "billing_interval" WHEN 'yearly' THEN 365 ELSE 30 END;
ALTER TABLE "subscription_plans" DROP COLUMN "billing_interval";

ALTER TABLE "organization_subscription_plan_overrides"
  ADD COLUMN "billing_interval_days" INTEGER NOT NULL DEFAULT 30;
UPDATE "organization_subscription_plan_overrides"
SET "billing_interval_days" = CASE "billing_interval" WHEN 'yearly' THEN 365 ELSE 30 END;
ALTER TABLE "organization_subscription_plan_overrides" DROP COLUMN "billing_interval";

UPDATE "organizations" SET "subscription_status" = 'expired' WHERE "subscription_status" = 'trial';
UPDATE "subscription_activation_requests" SET "status" = 'declined' WHERE "request_type" = 'trial' AND "status" = 'pending';
UPDATE "subscription_activation_requests" SET "request_type" = 'activation' WHERE "request_type" = 'trial';
ALTER TABLE "organizations" ALTER COLUMN "subscription_status" DROP DEFAULT;
ALTER TYPE "subscription_status" RENAME TO "subscription_status_old";
CREATE TYPE "subscription_status" AS ENUM ('pending', 'active', 'expired', 'cancelled');
ALTER TABLE "organizations" ALTER COLUMN "subscription_status" TYPE "subscription_status"
  USING "subscription_status"::text::"subscription_status";
ALTER TABLE "organizations" ALTER COLUMN "subscription_status" SET DEFAULT 'active';
DROP TYPE "subscription_status_old";

ALTER TABLE "subscription_activation_requests" ALTER COLUMN "request_type" DROP DEFAULT;
ALTER TYPE "subscription_request_type" RENAME TO "subscription_request_type_old";
CREATE TYPE "subscription_request_type" AS ENUM ('activation');
ALTER TABLE "subscription_activation_requests" ALTER COLUMN "request_type" TYPE "subscription_request_type"
  USING "request_type"::text::"subscription_request_type";
ALTER TABLE "subscription_activation_requests" ALTER COLUMN "request_type" SET DEFAULT 'activation';
DROP TYPE "subscription_request_type_old";
DROP TABLE IF EXISTS "partner_trial_eligibility";
ALTER TABLE "provisioning_requests" DROP COLUMN IF EXISTS "trial_started_at";
ALTER TABLE "provisioning_requests" DROP COLUMN IF EXISTS "trial_ends_at";
