ALTER TABLE "leads"
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "state" VARCHAR(120),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "address" TEXT,
  ADD COLUMN "staff_count" INTEGER,
  ADD COLUMN "product_requirement" TEXT,
  ADD COLUMN "demo_type" VARCHAR(160),
  ADD COLUMN "demo_at" TIMESTAMPTZ(3),
  ADD COLUMN "remarks" TEXT,
  ADD COLUMN "follow_up_at" TIMESTAMPTZ(3);

CREATE TABLE "lead_calls" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "logged_by_user_id" UUID NOT NULL,
  "call_status" VARCHAR(32) NOT NULL,
  "duration_seconds" INTEGER,
  "customer_response" TEXT,
  "next_action" TEXT,
  "follow_up_at" TIMESTAMPTZ(3),
  "called_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_calls_organization_id_lead_id_called_at_idx" ON "lead_calls"("organization_id", "lead_id", "called_at");
CREATE INDEX "lead_calls_organization_id_logged_by_user_id_called_at_idx" ON "lead_calls"("organization_id", "logged_by_user_id", "called_at");

ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_organization_id_lead_id_fkey"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_organization_id_logged_by_user_id_fkey"
  FOREIGN KEY ("organization_id", "logged_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
