CREATE TYPE "notification_type" AS ENUM ('activity_assigned');

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_organization_id_id_key"
  UNIQUE ("organization_id", "id");

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "activity_id" UUID NOT NULL,
  "type" "notification_type" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_title_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "notifications_body_check" CHECK (length(btrim("body")) > 0)
);

CREATE INDEX "notifications_organization_id_recipient_user_id_read_at_created_at_idx"
  ON "notifications"("organization_id", "recipient_user_id", "read_at", "created_at");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organization_id_recipient_user_id_fkey"
  FOREIGN KEY ("organization_id", "recipient_user_id")
  REFERENCES "memberships"("organization_id", "user_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organization_id_activity_id_fkey"
  FOREIGN KEY ("organization_id", "activity_id")
  REFERENCES "activities"("organization_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;