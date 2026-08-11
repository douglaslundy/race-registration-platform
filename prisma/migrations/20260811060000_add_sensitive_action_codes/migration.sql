-- CreateTable
CREATE TABLE "sensitive_action_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensitive_action_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sensitive_action_codes_userId_actionType_targetId_idx" ON "sensitive_action_codes"("userId", "actionType", "targetId");
