-- AlterTable
ALTER TABLE "registrations" ADD COLUMN "participantName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "participantEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "participantPhone" TEXT,
ADD COLUMN "participantBirthDate" TIMESTAMP(3),
ADD COLUMN "participantGender" TEXT,
ADD COLUMN "participantCpf" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "registrationEditDeadline" TIMESTAMP(3);
