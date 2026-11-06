CREATE TYPE "activation_request_status" AS ENUM ('pending', 'activated', 'declined');

CREATE TABLE "subscription_activation_requests" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL,
  "plan_code" VARCHAR(32) NOT NULL,
  "status" "activation_request_status" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscription_activation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_activation_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "subscription_activation_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "subscription_activation_requests_status_created_at_idx"
  ON "subscription_activation_requests"("status", "created_at");
CREATE INDEX "subscription_activation_requests_organization_id_created_at_idx"
  ON "subscription_activation_requests"("organization_id", "created_at");
CREATE UNIQUE INDEX "subscription_activation_requests_pending_organization_key"
  ON "subscription_activation_requests"("organization_id")
  WHERE "status" = 'pending';
