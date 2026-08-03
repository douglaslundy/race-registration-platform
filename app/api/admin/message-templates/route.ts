import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { listTemplatesForAdmin } from "@/lib/templates/list";

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const templates = await listTemplatesForAdmin();
  return NextResponse.json({ templates });
}
