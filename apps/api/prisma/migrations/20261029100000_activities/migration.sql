CREATE TYPE "activity_type" AS ENUM ('task', 'call', 'meeting', 'note', 'email');
CREATE TYPE "activity_status" AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "activity_priority" AS ENUM ('low', 'normal', 'high');
CREATE TYPE "related_record_type" AS ENUM ('lead', 'contact', 'company', 'deal');

CREATE TABLE "activities" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "type" "activity_type" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "status" "activity_status" NOT NULL DEFAULT 'open',
  "priority" "activity_priority" NOT NULL DEFAULT 'normal',
  "due_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "assigned_to_user_id" UUID,
  "related_to_type" "related_record_type",
  "related_to_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "activities_related_record_pair_check"
    CHECK (("related_to_type" IS NULL) = ("related_to_id" IS NULL))
);

CREATE INDEX "activities_organization_id_archived_at_due_at_idx"
  ON "activities"("organization_id", "archived_at", "due_at");
CREATE INDEX "activities_organization_id_status_archived_at_idx"
  ON "activities"("organization_id", "status", "archived_at");
CREATE INDEX "activities_organization_id_assigned_to_user_id_archived_at_idx"
  ON "activities"("organization_id", "assigned_to_user_id", "archived_at");
CREATE INDEX "activities_organization_id_related_to_type_related_to_id_idx"
  ON "activities"("organization_id", "related_to_type", "related_to_id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_assigned_to_user_id_fkey"
  FOREIGN KEY ("organization_id", "assigned_to_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_created_by_user_id_fkey"
  FOREIGN KEY ("organization_id", "created_by_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
