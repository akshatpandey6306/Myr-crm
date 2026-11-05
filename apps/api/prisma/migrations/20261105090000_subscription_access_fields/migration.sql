CREATE TYPE "organization_status" AS ENUM ('active', 'suspended');
CREATE TYPE "subscription_status" AS ENUM ('pending', 'trial', 'active', 'expired', 'cancelled');

ALTER TABLE "organizations"
  ADD COLUMN "status" "organization_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "subscription_plan" VARCHAR(32),
  ADD COLUMN "subscription_status" "subscription_status" NOT NULL DEFAULT 'active',
  ADD COLUMN "subscription_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "subscription_ends_at" TIMESTAMPTZ(3),
  ADD COLUMN "billing_provider" VARCHAR(32),
  ADD COLUMN "razorpay_subscription_id" VARCHAR(128);