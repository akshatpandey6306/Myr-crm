CREATE TYPE "subscription_request_type" AS ENUM ('trial', 'activation');

ALTER TABLE "subscription_activation_requests"
  ADD COLUMN "request_type" "subscription_request_type" NOT NULL DEFAULT 'activation';

ALTER TABLE "subscription_plans"
  ADD COLUMN "modules" TEXT[] NOT NULL DEFAULT ARRAY[
    'leads', 'contacts', 'companies', 'deals', 'activities', 'team',
    'automation', 'email', 'reports', 'audit-logs', 'settings'
  ]::TEXT[];
