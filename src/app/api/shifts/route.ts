import { NextRequest, NextResponse } from "next/server";
import { AwsCredentialError, getShiftMonth, putShiftMonth } from "@/lib/dynamodb";
import { logError } from "@/lib/server-log";
import { SHIFT_CLASS_GROUPS, ShiftColumn, ShiftEntry } from "@/types/shift";

function validateMonth(month: string | null): month is string {
  if (!month) {
    return false;
  }
  return /^\d{4}-\d{2}$/.test(month);
}

function isValidEntry(entry: ShiftEntry): boolean {
  const allowedClassGroups = SHIFT_CLASS_GROUPS.map((group) => group.key);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    typeof entry.shiftType === "string" &&
    entry.shiftType.trim().length > 0 &&
    (entry.columnKey === undefined || (typeof entry.columnKey === "string" && entry.columnKey.trim().length > 0)) &&
    (entry.classGroup === undefined || allowedClassGroups.includes(entry.classGroup)) &&
    typeof entry.staffName === "string"
  );
}

function isValidColumn(column: ShiftColumn): boolean {
  return typeof column.id === "string" && column.id.trim().length > 0 && typeof column.shiftType === "string" && column.shiftType.trim().length > 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const month = request.nextUrl.searchParams.get("month");
    if (!validateMonth(month)) {
      return NextResponse.json({ error: "month is required as YYYY-MM" }, { status: 400 });
    }

    const data = await getShiftMonth(month);
    return NextResponse.json({ month, entries: data.entries, columns: data.columns });
  } catch (error) {
    logError("api/shifts.GET", "request failed", error);
    if (error instanceof AwsCredentialError) {
      return NextResponse.json({ error: "aws credentials are invalid or expired" }, { status: 503 });
    }
    return NextResponse.json({ error: "failed to load shifts" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { month?: string; entries?: ShiftEntry[]; columns?: ShiftColumn[] };
    const month = body.month ?? null;
    if (!validateMonth(month)) {
      return NextResponse.json({ error: "month is required as YYYY-MM" }, { status: 400 });
    }

    const entries = body.entries ?? [];
    if (!Array.isArray(entries) || !entries.every(isValidEntry)) {
      return NextResponse.json({ error: "invalid entries" }, { status: 400 });
    }
    const columns = body.columns;
    if (columns !== undefined && (!Array.isArray(columns) || !columns.every(isValidColumn))) {
      return NextResponse.json({ error: "invalid columns" }, { status: 400 });
    }

    await putShiftMonth(month, { entries, columns });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api/shifts.PUT", "request failed", error);
    if (error instanceof AwsCredentialError) {
      return NextResponse.json({ error: "aws credentials are invalid or expired" }, { status: 503 });
    }
    return NextResponse.json({ error: "failed to update shifts" }, { status: 500 });
  }
}
