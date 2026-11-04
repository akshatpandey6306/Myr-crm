ALTER TABLE "organizations"
ADD COLUMN "enabled_modules" TEXT[] NOT NULL DEFAULT ARRAY[
  'leads', 'contacts', 'companies', 'deals', 'activities', 'team', 'automation', 'reports'
];

CREATE TABLE "subscription_plans" (
  "id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "price" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "billing_interval" VARCHAR(16) NOT NULL DEFAULT 'monthly',
  "trial_days" INTEGER NOT NULL DEFAULT 0,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "employee_limit" INTEGER,
  "usage_limits" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_plans_price_check" CHECK ("price" >= 0),
  CONSTRAINT "subscription_plans_trial_days_check" CHECK ("trial_days" >= 0),
  CONSTRAINT "subscription_plans_employee_limit_check" CHECK ("employee_limit" IS NULL OR "employee_limit" > 0),
  CONSTRAINT "subscription_plans_billing_interval_check" CHECK ("billing_interval" IN ('monthly', 'yearly')),
  CONSTRAINT "subscription_plans_usage_limits_check" CHECK (jsonb_typeof("usage_limits") = 'object')
);

CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

INSERT INTO "subscription_plans" (
  "id", "code", "name", "price", "currency", "billing_interval",
  "trial_days", "features", "employee_limit", "usage_limits", "is_active", "updated_at"
) VALUES
  (gen_random_uuid(), 'starter', 'Starter', 999, 'INR', 'monthly', 0,
   ARRAY['Core CRM', 'Leads and contacts', 'Sales pipeline'], 3, '{}'::JSONB, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'growth', 'Growth', 2499, 'INR', 'monthly', 0,
   ARRAY['Everything in Starter', 'Team collaboration', 'Reports and analytics'], 10, '{}'::JSONB, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'business', 'Business', 4999, 'INR', 'monthly', 0,
   ARRAY['Everything in Growth', 'Advanced permissions', 'Priority support'], 25, '{}'::JSONB, true, CURRENT_TIMESTAMP);
