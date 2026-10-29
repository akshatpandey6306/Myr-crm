CREATE TYPE "deal_status" AS ENUM ('open', 'won', 'lost');

CREATE TABLE "pipelines" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_stages" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "pipeline_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deals" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "close_date" DATE,
  "status" "deal_status" NOT NULL DEFAULT 'open',
  "company_id" UUID,
  "pipeline_id" UUID NOT NULL,
  "stage_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_organization_id_id_key" ON "companies"("organization_id", "id");
CREATE UNIQUE INDEX "pipelines_organization_id_id_key" ON "pipelines"("organization_id", "id");
CREATE UNIQUE INDEX "pipelines_organization_id_name_key" ON "pipelines"("organization_id", "name");
CREATE INDEX "pipelines_organization_id_is_default_idx" ON "pipelines"("organization_id", "is_default");
CREATE UNIQUE INDEX "pipelines_one_default_per_organization_key" ON "pipelines"("organization_id") WHERE "is_default";
CREATE UNIQUE INDEX "pipeline_stages_organization_id_pipeline_id_id_key" ON "pipeline_stages"("organization_id", "pipeline_id", "id");
CREATE UNIQUE INDEX "pipeline_stages_organization_id_pipeline_id_name_key" ON "pipeline_stages"("organization_id", "pipeline_id", "name");
CREATE UNIQUE INDEX "pipeline_stages_organization_id_pipeline_id_position_key" ON "pipeline_stages"("organization_id", "pipeline_id", "position");
CREATE INDEX "deals_organization_id_archived_at_created_at_idx" ON "deals"("organization_id", "archived_at", "created_at");
CREATE INDEX "deals_organization_id_pipeline_id_stage_id_archived_at_idx" ON "deals"("organization_id", "pipeline_id", "stage_id", "archived_at");
CREATE INDEX "deals_organization_id_owner_user_id_archived_at_idx" ON "deals"("organization_id", "owner_user_id", "archived_at");

ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_pipeline_id_fkey" FOREIGN KEY ("organization_id", "pipeline_id") REFERENCES "pipelines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_pipeline_id_fkey" FOREIGN KEY ("organization_id", "pipeline_id") REFERENCES "pipelines"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_pipeline_id_stage_id_fkey" FOREIGN KEY ("organization_id", "pipeline_id", "stage_id") REFERENCES "pipeline_stages"("organization_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "pipelines" ("id", "organization_id", "name", "is_default", "updated_at")
SELECT gen_random_uuid(), "id", 'Sales pipeline', true, CURRENT_TIMESTAMP
FROM "organizations";

INSERT INTO "pipeline_stages" ("id", "organization_id", "pipeline_id", "name", "position", "updated_at")
SELECT gen_random_uuid(), pipeline."organization_id", pipeline."id", stages."name", stages."position", CURRENT_TIMESTAMP
FROM "pipelines" AS pipeline
CROSS JOIN (VALUES ('Discovery', 0), ('Qualified', 1), ('Proposal', 2), ('Negotiation', 3)) AS stages("name", "position");
