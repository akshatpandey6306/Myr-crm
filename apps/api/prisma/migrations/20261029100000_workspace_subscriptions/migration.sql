CREATE TYPE "subscription_status" AS ENUM ('pending', 'trial', 'active', 'expired', 'cancelled');

ALTER TABLE "organizations"
ADD COLUMN "subscription_plan" VARCHAR(32),
ADD COLUMN "subscription_status" "subscription_status" NOT NULL DEFAULT 'pending',
ADD COLUMN "subscription_started_at" TIMESTAMPTZ(3),
ADD COLUMN "subscription_ends_at" TIMESTAMPTZ(3),
ADD COLUMN "billing_provider" VARCHAR(32),
ADD COLUMN "razorpay_subscription_id" VARCHAR(128);

CREATE INDEX "organizations_subscription_status_subscription_ends_at_idx"
ON "organizations"("subscription_status", "subscription_ends_at");
