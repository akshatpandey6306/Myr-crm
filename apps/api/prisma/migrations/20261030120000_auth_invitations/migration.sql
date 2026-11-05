ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN "email_verification_token_hash" VARCHAR(64),
ADD COLUMN "email_verification_expires_at" TIMESTAMPTZ(3);

CREATE TABLE "invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "role" "membership_role" NOT NULL DEFAULT 'sales_rep',
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitations_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");
