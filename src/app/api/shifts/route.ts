import { NextRequest, NextResponse } from "next/server";
import { getShiftMonth, putShiftMonth } from "@/lib/dynamodb";
import { ShiftEntry } from "@/types/shift";

function validateMonth(month: string | null): month is string {
  if (!month) {
    return false;
  }
  return /^\d{4}-\d{2}$/.test(month);
}

function isValidEntry(entry: ShiftEntry): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    typeof entry.shiftType === "string" &&
    entry.shiftType.trim().length > 0 &&
    typeof entry.staffName === "string"
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const month = request.nextUrl.searchParams.get("month");
  if (!validateMonth(month)) {
    return NextResponse.json({ error: "month is required as YYYY-MM" }, { status: 400 });
  }

  const entries = await getShiftMonth(month);
  return NextResponse.json({ month, entries });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as { month?: string; entries?: ShiftEntry[] };
  const month = body.month ?? null;
  if (!validateMonth(month)) {
    return NextResponse.json({ error: "month is required as YYYY-MM" }, { status: 400 });
  }

  const entries = body.entries ?? [];
  if (!Array.isArray(entries) || !entries.every(isValidEntry)) {
    return NextResponse.json({ error: "invalid entries" }, { status: 400 });
  }

  await putShiftMonth(month, entries);
  return NextResponse.json({ ok: true });
}
