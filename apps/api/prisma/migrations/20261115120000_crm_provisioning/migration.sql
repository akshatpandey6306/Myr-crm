CREATE TYPE "provisioning_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

ALTER TYPE "email_token_purpose" ADD VALUE IF NOT EXISTS 'account_activation';

ALTER TABLE "organizations" ADD COLUMN "slug" VARCHAR(63);
ALTER TABLE "organizations" ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC';
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

CREATE TABLE "provisioning_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "order_id" VARCHAR(128) NOT NULL,
    "product" VARCHAR(32) NOT NULL,
    "status" "provisioning_status" NOT NULL DEFAULT 'RUNNING',
    "activation_email_sent" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" UUID,
    "tenant_slug" VARCHAR(63),
    "owner_user_id" UUID,
    "plan_code" VARCHAR(32) NOT NULL,
    "failure_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provisioning_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provisioning_requests_request_id_key" ON "provisioning_requests"("request_id");
CREATE UNIQUE INDEX "provisioning_requests_idempotency_key_key" ON "provisioning_requests"("idempotency_key");
CREATE UNIQUE INDEX "provisioning_requests_order_id_key" ON "provisioning_requests"("order_id");
CREATE INDEX "provisioning_requests_status_created_at_idx" ON "provisioning_requests"("status", "created_at");
