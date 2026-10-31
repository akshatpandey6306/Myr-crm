CREATE TYPE "automation_trigger" AS ENUM ('lead_created', 'lead_status_changed');

CREATE TABLE "automation_rules" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "trigger" "automation_trigger" NOT NULL,
  "trigger_status" "lead_status",
  "activity_title" VARCHAR(160) NOT NULL,
  "activity_priority" "activity_priority" NOT NULL DEFAULT 'normal',
  "due_in_days" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_rules_trigger_status_check"
    CHECK (("trigger" = 'lead_status_changed') = ("trigger_status" IS NOT NULL)),
  CONSTRAINT "automation_rules_due_in_days_check"
    CHECK ("due_in_days" BETWEEN 0 AND 365)
);

CREATE TABLE "automation_runs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "activity_id" UUID NOT NULL,
  "ran_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_rules_organization_id_id_key"
  ON "automation_rules"("organization_id", "id");
CREATE INDEX "automation_rules_organization_id_archived_at_enabled_idx"
  ON "automation_rules"("organization_id", "archived_at", "enabled");
CREATE UNIQUE INDEX "automation_runs_rule_id_lead_id_key"
  ON "automation_runs"("rule_id", "lead_id");
CREATE INDEX "automation_runs_organization_id_ran_at_idx"
  ON "automation_runs"("organization_id", "ran_at");
CREATE UNIQUE INDEX "leads_organization_id_id_key"
  ON "leads"("organization_id", "id");

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_organization_id_created_by_user_id_fkey"
  FOREIGN KEY ("organization_id", "created_by_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_organization_id_rule_id_fkey"
  FOREIGN KEY ("organization_id", "rule_id")
  REFERENCES "automation_rules"("organization_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_organization_id_lead_id_fkey"
  FOREIGN KEY ("organization_id", "lead_id")
  REFERENCES "leads"("organization_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
