CREATE TYPE "vendor_status" AS ENUM ('active', 'pending', 'on_hold');

CREATE TABLE "vendors" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(120) NOT NULL,
  "contact_person" VARCHAR(120),
  "email" VARCHAR(254),
  "phone" VARCHAR(40),
  "status" "vendor_status" NOT NULL DEFAULT 'pending',
  "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "review_count" INTEGER NOT NULL DEFAULT 0,
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendors_rating_check" CHECK ("rating" >= 0 AND "rating" <= 5),
  CONSTRAINT "vendors_review_count_check" CHECK ("review_count" >= 0)
);

CREATE INDEX "vendors_organization_id_archived_at_created_at_idx" ON "vendors"("organization_id", "archived_at", "created_at");
CREATE INDEX "vendors_organization_id_status_archived_at_idx" ON "vendors"("organization_id", "status", "archived_at");
CREATE INDEX "vendors_organization_id_category_archived_at_idx" ON "vendors"("organization_id", "category", "archived_at");
CREATE INDEX "vendors_organization_id_owner_user_id_archived_at_idx" ON "vendors"("organization_id", "owner_user_id", "archived_at");

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organizations" ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY['leads', 'contacts', 'companies', 'deals', 'activities', 'vendors', 'team', 'automation', 'email', 'reports', 'audit-logs', 'settings']::TEXT[];
ALTER TABLE "subscription_plans" ALTER COLUMN "modules" SET DEFAULT ARRAY['leads', 'contacts', 'companies', 'deals', 'activities', 'vendors', 'team', 'automation', 'email', 'reports', 'audit-logs', 'settings']::TEXT[];
ALTER TABLE "memberships" ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY[]::TEXT[];

UPDATE "organizations"
SET "enabled_modules" = array_append("enabled_modules", 'vendors')
WHERE NOT ('vendors' = ANY("enabled_modules"));
