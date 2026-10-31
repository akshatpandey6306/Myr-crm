CREATE TYPE "organization_status" AS ENUM ('active', 'suspended');

ALTER TABLE "organizations"
ADD COLUMN "status" "organization_status" NOT NULL DEFAULT 'active';
