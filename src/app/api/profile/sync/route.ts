import { NextRequest, NextResponse } from "next/server";
import { AwsCredentialError, ensureUserProfile } from "@/lib/dynamodb";
import { logError, logInfo } from "@/lib/server-log";

type Body = {
  userId?: string;
  email?: string;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const body = (await request.json()) as Body;
  const userId = body.userId?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  logInfo("api/profile/sync.POST", "request start", { requestId, userId, email });

  if (!userId || !email) {
    logInfo("api/profile/sync.POST", "validation failed", { requestId });
    return NextResponse.json({ error: "userId and email are required" }, { status: 400 });
  }

  try {
    const profile = await ensureUserProfile({ userId, email, defaultRole: "メンバー" });
    logInfo("api/profile/sync.POST", "profile synced", { requestId, userId: profile.userId, role: profile.role });
    return NextResponse.json({ profile });
  } catch (error) {
    logError("api/profile/sync.POST", "profile sync failed", error, { requestId, userId, email });
    if (error instanceof AwsCredentialError) {
      return NextResponse.json({ error: "aws credentials are invalid or expired" }, { status: 503 });
    }
    return NextResponse.json({ error: "profile sync failed" }, { status: 500 });
  }
}
