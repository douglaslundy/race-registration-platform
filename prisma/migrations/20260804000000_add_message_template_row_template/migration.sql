-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN "rowTemplate" TEXT;

-- AlterTable
ALTER TABLE "message_template_versions" ADD COLUMN "rowTemplate" TEXT;
