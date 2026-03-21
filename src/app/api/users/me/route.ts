import { NextRequest, NextResponse } from "next/server";
import { getUserById } from "@/lib/dynamodb";
import { logError, logInfo } from "@/lib/server-log";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const userId = request.nextUrl.searchParams.get("userId");
  logInfo("api/users/me.GET", "request start", { requestId, userId });
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const profile = await getUserById(userId);
    if (!profile) {
      logInfo("api/users/me.GET", "profile not found", { requestId, userId });
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    logInfo("api/users/me.GET", "request success", { requestId, userId, role: profile.role });
    return NextResponse.json({ profile });
  } catch (error) {
    logError("api/users/me.GET", "request failed", error, { requestId, userId });
    return NextResponse.json({ error: "failed to load profile" }, { status: 500 });
  }
}
