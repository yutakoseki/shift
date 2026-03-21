import { NextRequest, NextResponse } from "next/server";
import { assertAdminByActorHeader } from "@/lib/authz";
import { updateUserRole } from "@/lib/dynamodb";
import { logError, logInfo } from "@/lib/server-log";
import { UserRole } from "@/types/user";

type Body = {
  role?: UserRole;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const actorUserId = request.headers.get("x-actor-user-id");
  const body = (await request.json()) as Body;
  const role = body.role;
  logInfo("api/users/[userId]/role.PATCH", "request start", { requestId, actorUserId, role });

  if (role !== "管理者" && role !== "メンバー") {
    logInfo("api/users/[userId]/role.PATCH", "validation failed", { requestId, reason: "invalid role" });
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  try {
    await assertAdminByActorHeader(actorUserId);
    const { userId } = await context.params;
    const updated = await updateUserRole(userId, role);
    logInfo("api/users/[userId]/role.PATCH", "role updated", { requestId, userId, role: updated.role });
    return NextResponse.json({ user: updated });
  } catch (error) {
    logError("api/users/[userId]/role.PATCH", "request failed", error, { requestId, actorUserId, role });
    if (error instanceof Error && error.message === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ロール更新に失敗しました。" },
      { status: 400 }
    );
  }
}
