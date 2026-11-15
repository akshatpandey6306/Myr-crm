CREATE TABLE "organization_subscription_plan_overrides" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "price" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "billing_interval" VARCHAR(16) NOT NULL,
  "trial_days" INTEGER NOT NULL,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "employee_limit" INTEGER,
  "usage_limits" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "organization_subscription_plan_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_subscription_plan_overrides_organization_id_plan_code_key"
  ON "organization_subscription_plan_overrides"("organization_id", "plan_code");
CREATE INDEX "organization_subscription_plan_overrides_plan_code_idx"
  ON "organization_subscription_plan_overrides"("plan_code");

ALTER TABLE "organization_subscription_plan_overrides"
  ADD CONSTRAINT "organization_subscription_plan_overrides_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_subscription_plan_overrides"
  ADD CONSTRAINT "organization_subscription_plan_overrides_plan_code_fkey"
  FOREIGN KEY ("plan_code") REFERENCES "subscription_plans"("code") ON DELETE CASCADE ON UPDATE CASCADE;
