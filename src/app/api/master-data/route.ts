import { NextRequest, NextResponse } from "next/server";
import { AwsCredentialError, getMasterData, putMasterData } from "@/lib/dynamodb";
import { logError } from "@/lib/server-log";
import { MasterData } from "@/types/master-data";

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function isMasterData(data: MasterData): boolean {
  if (!Array.isArray(data.fullTimeStaff) || !Array.isArray(data.partTimeStaff) || !Array.isArray(data.children)) {
    return false;
  }
  if (!Array.isArray(data.shiftPatterns) || !Array.isArray(data.childRatios) || !Array.isArray(data.nurseryClasses)) {
    return false;
  }

  const validPatterns = data.shiftPatterns.every((pattern) => {
    return Boolean(pattern.code.trim()) && isTime(pattern.startTime) && isTime(pattern.endTime);
  });
  if (!validPatterns) {
    return false;
  }

  const validFullTime = data.fullTimeStaff.every((staff) => {
    return Boolean(staff.id) && Boolean(staff.name.trim()) && Array.isArray(staff.possibleShiftPatternCodes);
  });
  if (!validFullTime) {
    return false;
  }

  const validPartTime = data.partTimeStaff.every((staff) => {
    return (
      Boolean(staff.id) &&
      Boolean(staff.name.trim()) &&
      Array.isArray(staff.availableWeekdays) &&
      staff.availableWeekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      isTime(staff.availableStartTime) &&
      isTime(staff.availableEndTime) &&
      Array.isArray(staff.possibleShiftPatternCodes) &&
      Number.isFinite(staff.weeklyDays)
    );
  });
  if (!validPartTime) {
    return false;
  }

  const validChildren = data.children.every((child) => {
    return (
      Boolean(child.id) &&
      Boolean(child.name.trim()) &&
      isDate(child.birthDate) &&
      typeof child.classId === "string" &&
      typeof child.className === "string" &&
      Array.isArray(child.attendanceByWeekday) &&
      child.attendanceByWeekday.length > 0 &&
      child.attendanceByWeekday.every((slot) => {
        return (
          Number.isInteger(slot.weekday) &&
          slot.weekday >= 0 &&
          slot.weekday <= 6 &&
          typeof slot.enabled === "boolean" &&
          isTime(slot.startTime) &&
          isTime(slot.endTime) &&
          toMinutes(slot.startTime) < toMinutes(slot.endTime)
        );
      }) &&
      new Set(child.attendanceByWeekday.map((slot) => slot.weekday)).size === child.attendanceByWeekday.length
    );
  });
  if (!validChildren) {
    return false;
  }

  const validRatios = data.childRatios.every((ratio) => Number.isInteger(ratio.age) && Number.isFinite(ratio.ratio) && ratio.ratio > 0);
  if (!validRatios) {
    return false;
  }

  return data.nurseryClasses.every((classItem) => {
    return Boolean(classItem.id) && Boolean(classItem.name.trim()) && typeof classItem.ageGroup === "string";
  });
}

export async function GET(): Promise<NextResponse> {
  try {
    const data = await getMasterData();
    return NextResponse.json(data);
  } catch (error) {
    logError("api/master-data.GET", "request failed", error);
    if (error instanceof AwsCredentialError) {
      return NextResponse.json({ error: "aws credentials are invalid or expired" }, { status: 503 });
    }
    return NextResponse.json({ error: "failed to load master data" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as MasterData;
    if (!isMasterData(body)) {
      return NextResponse.json({ error: "invalid master data" }, { status: 400 });
    }

    await putMasterData({
      ...body,
      updatedAt: new Date().toISOString()
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api/master-data.PUT", "request failed", error);
    if (error instanceof AwsCredentialError) {
      return NextResponse.json({ error: "aws credentials are invalid or expired" }, { status: 503 });
    }
    return NextResponse.json({ error: "failed to update master data" }, { status: 500 });
  }
}
