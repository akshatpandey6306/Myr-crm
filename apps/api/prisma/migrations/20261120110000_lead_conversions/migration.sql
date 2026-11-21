BEGIN;

CREATE UNIQUE INDEX "deals_organization_id_id_key"
  ON "deals"("organization_id", "id");

CREATE TABLE "lead_conversions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "deal_id" UUID,
  "converted_by_user_id" UUID NOT NULL,
  "converted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_conversions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_conversions_organization_id_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "lead_conversions_organization_id_lead_id_key" UNIQUE ("organization_id", "lead_id"),
  CONSTRAINT "lead_conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lead_conversions_organization_id_lead_id_fkey" FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lead_conversions_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_conversions_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_conversions_organization_id_deal_id_fkey" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_conversions_organization_id_converted_by_user_id_fkey" FOREIGN KEY ("organization_id", "converted_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "lead_conversions_organization_id_converted_at_idx" ON "lead_conversions"("organization_id", "converted_at");
CREATE INDEX "lead_conversions_organization_id_company_id_idx" ON "lead_conversions"("organization_id", "company_id");
CREATE INDEX "lead_conversions_organization_id_contact_id_idx" ON "lead_conversions"("organization_id", "contact_id");
CREATE INDEX "lead_conversions_organization_id_deal_id_idx" ON "lead_conversions"("organization_id", "deal_id");

COMMIT;
