-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "assistant_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_permissions_userId_actionKey_key" ON "assistant_permissions"("userId", "actionKey");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_permissions" ADD CONSTRAINT "assistant_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
