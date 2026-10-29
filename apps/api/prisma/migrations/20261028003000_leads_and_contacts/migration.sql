CREATE TYPE "lead_source" AS ENUM ('website', 'referral', 'linkedin', 'other');
CREATE TYPE "lead_status" AS ENUM ('new', 'contacted', 'qualified', 'disqualified');

CREATE TABLE "leads" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "company" VARCHAR(160) NOT NULL,
  "source" "lead_source" NOT NULL,
  "status" "lead_status" NOT NULL DEFAULT 'new',
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "phone" VARCHAR(40),
  "title" VARCHAR(120),
  "company" VARCHAR(160),
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_organization_id_archived_at_created_at_idx" ON "leads"("organization_id", "archived_at", "created_at");
CREATE INDEX "leads_organization_id_status_archived_at_idx" ON "leads"("organization_id", "status", "archived_at");
CREATE INDEX "leads_organization_id_source_archived_at_idx" ON "leads"("organization_id", "source", "archived_at");
CREATE INDEX "leads_organization_id_owner_user_id_archived_at_idx" ON "leads"("organization_id", "owner_user_id", "archived_at");
CREATE UNIQUE INDEX "contacts_organization_id_email_key" ON "contacts"("organization_id", "email");
CREATE INDEX "contacts_organization_id_archived_at_created_at_idx" ON "contacts"("organization_id", "archived_at", "created_at");
CREATE INDEX "contacts_organization_id_owner_user_id_archived_at_idx" ON "contacts"("organization_id", "owner_user_id", "archived_at");

ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
