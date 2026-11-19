ALTER TYPE "SubscriptionPaymentType" ADD VALUE 'SEAT_ADDON';

ALTER TABLE "subscription_plans"
  ADD COLUMN "additional_seats_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "additional_seat_price" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "organization_subscription_plan_overrides"
  ADD COLUMN "additional_seats_enabled" BOOLEAN,
  ADD COLUMN "additional_seat_price" INTEGER;

ALTER TABLE "subscription_payments"
  ADD COLUMN "seat_quantity" INTEGER,
  ADD COLUMN "seat_unit_price" INTEGER,
  ADD COLUMN "seat_amount" DECIMAL(12,2);

CREATE TABLE "additional_seat_purchases" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" INTEGER NOT NULL,
  "billing_interval_days" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "purchased_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "additional_seat_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "additional_seat_purchases_payment_id_key" ON "additional_seat_purchases"("payment_id");
CREATE INDEX "additional_seat_purchases_organization_id_status_ends_at_idx" ON "additional_seat_purchases"("organization_id", "status", "ends_at");
ALTER TABLE "additional_seat_purchases" ADD CONSTRAINT "additional_seat_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "additional_seat_purchases" ADD CONSTRAINT "additional_seat_purchases_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;