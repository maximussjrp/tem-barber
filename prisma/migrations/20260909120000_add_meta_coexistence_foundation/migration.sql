-- CreateEnum
CREATE TYPE "MetaConnectionMode" AS ENUM ('COEXISTENCE', 'CLOUD_API_ONLY');

-- AlterEnum
ALTER TYPE "MetaConnectionEventType" ADD VALUE 'ONBOARDING_COMPLETED';
ALTER TYPE "MetaConnectionEventType" ADD VALUE 'ONBOARDING_FAILED';
ALTER TYPE "MetaConnectionEventType" ADD VALUE 'ASSETS_DISCOVERED';
ALTER TYPE "MetaConnectionEventType" ADD VALUE 'SYSTEM_USER_ASSIGNED';
ALTER TYPE "MetaConnectionEventType" ADD VALUE 'WEBHOOK_SUBSCRIBED';

-- AlterTable
ALTER TABLE "meta_connections" ADD COLUMN "connection_mode" "MetaConnectionMode" NOT NULL DEFAULT 'COEXISTENCE';
