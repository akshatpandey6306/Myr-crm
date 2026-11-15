-- DropIndex
DROP INDEX "organizations_subscription_status_subscription_ends_at_idx";

-- AlterTable
ALTER TABLE "invitations" ALTER COLUMN "id" DROP DEFAULT;
