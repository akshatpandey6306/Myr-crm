ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);

UPDATE "users"
SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL;

CREATE TYPE "email_token_purpose" AS ENUM ('password_reset', 'email_verification');

CREATE TABLE "email_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "purpose" "email_token_purpose" NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "role" "membership_role" NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_limit_buckets" (
  "key_hash" CHAR(64) NOT NULL,
  "window_started_at" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key_hash")
);

CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");
CREATE INDEX "email_tokens_user_id_purpose_expires_at_idx" ON "email_tokens"("user_id", "purpose", "expires_at");
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE INDEX "organization_invitations_organization_id_email_expires_at_idx" ON "organization_invitations"("organization_id", "email", "expires_at");
CREATE INDEX "organization_invitations_organization_id_created_at_idx" ON "organization_invitations"("organization_id", "created_at");
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");
CREATE UNIQUE INDEX "memberships_one_active_owner_per_organization"
ON "memberships"("organization_id")
WHERE "status" = 'active' AND "role" = 'owner';
CREATE UNIQUE INDEX "organization_invitations_one_pending_email_per_org"
ON "organization_invitations"("organization_id", "email")
WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "email_tokens"
ADD CONSTRAINT "email_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "organization_invitations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invitations"
ADD CONSTRAINT "organization_invitations_organization_id_invited_by_user_id_fkey"
FOREIGN KEY ("organization_id", "invited_by_user_id")
REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
