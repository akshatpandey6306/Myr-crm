BEGIN;

CREATE TYPE "company_status" AS ENUM ('prospect', 'engaged', 'opportunity', 'customer', 'inactive', 'lost');

ALTER TABLE "companies"
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "logo_url" VARCHAR(2048),
  ADD COLUMN "company_type" VARCHAR(80),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "employee_count" INTEGER,
  ADD COLUMN "annual_revenue" DECIMAL(14,2),
  ADD COLUMN "registration_number" VARCHAR(120),
  ADD COLUMN "parent_company_id" UUID,
  ADD COLUMN "country" VARCHAR(120),
  ADD COLUMN "state" VARCHAR(120),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "address" VARCHAR(500),
  ADD COLUMN "postal_code" VARCHAR(40),
  ADD COLUMN "status" "company_status" NOT NULL DEFAULT 'prospect',
  ADD COLUMN "lead_source" "lead_source",
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "internal_notes" TEXT,
  ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE "contacts" ADD COLUMN "company_id" UUID;

WITH unique_company_names AS (
  SELECT organization_id, LOWER(BTRIM(name)) AS normalized_name, (ARRAY_AGG(id ORDER BY id))[1] AS company_id
  FROM companies
  WHERE archived_at IS NULL
  GROUP BY organization_id, LOWER(BTRIM(name))
  HAVING COUNT(*) = 1
)
UPDATE contacts AS contact
SET company_id = company.company_id
FROM unique_company_names AS company
WHERE contact.organization_id = company.organization_id
  AND LOWER(BTRIM(contact.company)) = company.normalized_name
  AND contact.company IS NOT NULL;

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_organization_id_parent_company_id_fkey"
    FOREIGN KEY ("organization_id", "parent_company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_organization_id_company_id_fkey"
    FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "companies_organization_id_status_archived_at_idx" ON "companies"("organization_id", "status", "archived_at");
CREATE INDEX "companies_organization_id_industry_archived_at_idx" ON "companies"("organization_id", "industry", "archived_at");
CREATE INDEX "companies_organization_id_parent_company_id_idx" ON "companies"("organization_id", "parent_company_id");
CREATE INDEX "contacts_organization_id_company_id_idx" ON "contacts"("organization_id", "company_id");

COMMIT;
