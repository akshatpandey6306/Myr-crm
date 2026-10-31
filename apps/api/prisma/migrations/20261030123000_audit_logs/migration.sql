CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'archive');

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" "audit_action" NOT NULL,
  "resource_type" VARCHAR(48) NOT NULL,
  "resource_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_resource_type_check" CHECK (length(btrim("resource_type")) > 0)
);

CREATE INDEX "audit_logs_organization_id_created_at_idx"
  ON "audit_logs"("organization_id", "created_at");
CREATE INDEX "audit_logs_organization_id_resource_type_resource_id_idx"
  ON "audit_logs"("organization_id", "resource_type", "resource_id");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_actor_user_id_fkey"
  FOREIGN KEY ("organization_id", "actor_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;