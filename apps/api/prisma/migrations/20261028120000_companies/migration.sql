CREATE TABLE "companies" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "industry" VARCHAR(120),
  "website" VARCHAR(255),
  "phone" VARCHAR(40),
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "companies_organization_id_archived_at_created_at_idx" ON "companies"("organization_id", "archived_at", "created_at");
CREATE INDEX "companies_organization_id_owner_user_id_archived_at_idx" ON "companies"("organization_id", "owner_user_id", "archived_at");

ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
