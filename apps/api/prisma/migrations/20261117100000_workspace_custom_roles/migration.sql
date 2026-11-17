CREATE TABLE "workspace_roles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "description" VARCHAR(200) NOT NULL DEFAULT '',
  "permission_profile" "membership_role" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workspace_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_roles_organization_id_name_key" ON "workspace_roles"("organization_id", "name");
CREATE INDEX "workspace_roles_organization_id_created_at_idx" ON "workspace_roles"("organization_id", "created_at");

ALTER TABLE "memberships" ADD COLUMN "custom_role_id" UUID;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "workspace_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "memberships_custom_role_id_idx" ON "memberships"("custom_role_id");