import { NextRequest, NextResponse } from "next/server";
import { createCognitoUser } from "@/lib/cognito-admin";
import { assertAdminByActorHeader } from "@/lib/authz";
import { listUsers, putUserProfile } from "@/lib/dynamodb";
import { logError, logInfo } from "@/lib/server-log";

type CreateUserBody = {
  email?: string;
  password?: string;
};

function validPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const actorUserId = request.headers.get("x-actor-user-id");
  logInfo("api/users.GET", "request start", { requestId, actorUserId });

  try {
    await assertAdminByActorHeader(actorUserId);
    const users = await listUsers();
    logInfo("api/users.GET", "request success", { requestId, userCount: users.length });
    return NextResponse.json({ users });
  } catch (error) {
    logError("api/users.GET", "request failed", error, { requestId, actorUserId });
    if (error instanceof Error && error.message === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "管理者のみ実行できます。" }, { status: 400 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const actorUserId = request.headers.get("x-actor-user-id");
  const body = (await request.json()) as CreateUserBody;
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  logInfo("api/users.POST", "request start", {
    requestId,
    actorUserId,
    email,
    hasPassword: password.length > 0
  });

  if (!email || !password) {
    logInfo("api/users.POST", "validation failed", { requestId, reason: "missing email or password" });
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (!validPassword(password)) {
    logInfo("api/users.POST", "validation failed", { requestId, reason: "password policy mismatch", email });
    return NextResponse.json({ error: "password does not meet the policy" }, { status: 400 });
  }

  try {
    await assertAdminByActorHeader(actorUserId);
    logInfo("api/users.POST", "admin authorized", { requestId, actorUserId });
    const created = await createCognitoUser({
      email,
      temporaryPassword: password
    });
    logInfo("api/users.POST", "cognito user created", { requestId, email, userId: created.userId });
    await putUserProfile({
      userId: created.userId,
      email: created.email,
      role: "メンバー"
    });
    logInfo("api/users.POST", "dynamodb profile inserted", {
      requestId,
      userId: created.userId,
      role: "メンバー"
    });
    return NextResponse.json({ ok: true, user: created });
  } catch (error) {
    logError("api/users.POST", "request failed", error, { requestId, actorUserId, email });
    if (error instanceof Error && error.message === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ユーザー作成に失敗しました。" },
      { status: 400 }
    );
  }
}
