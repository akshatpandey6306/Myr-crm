ALTER TYPE "user_status" ADD VALUE 'pending';
ALTER TYPE "membership_status" ADD VALUE 'pending';
ALTER TYPE "notification_type" ADD VALUE 'member_join_request';

ALTER TABLE "organizations"
  ADD COLUMN "join_code" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "organizations_join_code_key"
  ON "organizations"("join_code");

ALTER TABLE "notifications"
  ALTER COLUMN "activity_id" DROP NOT NULL,
  ADD COLUMN "resource_id" UUID;
