CREATE TYPE "SubscriptionPaymentType" AS ENUM ('TRIAL', 'PLAN', 'RENEWAL');
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "subscription_payments" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL,
  "product_info" VARCHAR(120) NOT NULL,
  "payment_type" "SubscriptionPaymentType" NOT NULL,
  "transaction_id" VARCHAR(40) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "payu_id" VARCHAR(64),
  "bank_reference" VARCHAR(120),
  "failure_reason" VARCHAR(500),
  "renewal_base_ends_at" TIMESTAMPTZ(3),
  "verified_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "subscription_payments_transaction_id_key" ON "subscription_payments"("transaction_id");
CREATE INDEX "subscription_payments_organization_id_status_created_at_idx" ON "subscription_payments"("organization_id", "status", "created_at");
CREATE INDEX "subscription_payments_organization_id_created_at_idx" ON "subscription_payments"("organization_id", "created_at");

ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organization_id_requested_by_user_id_fkey" FOREIGN KEY ("organization_id", "requested_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
