-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('task', 'call', 'meeting', 'note', 'email');

-- CreateEnum
CREATE TYPE "activity_status" AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "activity_priority" AS ENUM ('low', 'normal', 'high');

-- DropIndex
DROP INDEX "organizations_subscription_status_subscription_ends_at_idx";

-- AlterTable
ALTER TABLE "invitations" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL DEFAULT 'task',
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" "activity_status" NOT NULL DEFAULT 'open',
    "priority" "activity_priority" NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "assigned_to_user_id" UUID,
    "related_to_type" VARCHAR(32),
    "related_to_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_organization_id_status_created_at_idx" ON "activities"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_assigned_to_user_id_status_idx" ON "activities"("organization_id", "assigned_to_user_id", "status");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_assigned_to_user_id_fkey" FOREIGN KEY ("organization_id", "assigned_to_user_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
