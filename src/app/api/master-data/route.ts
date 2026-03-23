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

function ageFromBirthDate(birthDate: string): number | null {
  if (!birthDate) {
    return null;
  }
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return Math.max(age, 0);
}

function calculateSaturdayRequiredMax(data: MasterData): number {
  const saturday = 6;
  const ratioByAge = new Map<number, number>();
  data.childRatios.forEach((item) => {
    if (Number.isFinite(item.age) && Number.isFinite(item.ratio) && item.ratio > 0) {
      ratioByAge.set(Math.floor(item.age), item.ratio);
    }
  });

  const saturdayAttendances = data.children
    .map((child) => {
      const attendance = child.attendanceByWeekday.find((slot) => slot.weekday === saturday);
      if (!attendance || !attendance.enabled) {
        return null;
      }
      return {
        age: ageFromBirthDate(child.birthDate),
        startMinutes: toMinutes(attendance.startTime),
        endMinutes: toMinutes(attendance.endTime)
      };
    })
    .filter((item): item is { age: number | null; startMinutes: number; endMinutes: number } => item !== null)
    .filter((item) => item.startMinutes < item.endMinutes);

  if (saturdayAttendances.length === 0) {
    return 0;
  }

  const start = Math.max(0, Math.floor(Math.min(...saturdayAttendances.map((item) => item.startMinutes)) / 15) * 15);
  const end = Math.min(24 * 60, Math.ceil(Math.max(...saturdayAttendances.map((item) => item.endMinutes)) / 15) * 15);

  let maxRequired = 0;
  for (let slot = start; slot < end; slot += 15) {
    const ageCount = new Map<number, number>();
    let unknownAgeChildren = 0;
    saturdayAttendances.forEach((item) => {
      if (slot < item.startMinutes || slot >= item.endMinutes) {
        return;
      }
      if (item.age === null) {
        unknownAgeChildren += 1;
        return;
      }
      ageCount.set(item.age, (ageCount.get(item.age) ?? 0) + 1);
    });

    let baseRequirement = 0;
    ageCount.forEach((count, age) => {
      const ratio = ratioByAge.get(age);
      if (!ratio || ratio <= 0) {
        unknownAgeChildren += count;
        return;
      }
      baseRequirement += count / ratio;
    });
    const required = Math.ceil(baseRequirement + unknownAgeChildren);
    if (required > maxRequired) {
      maxRequired = required;
    }
  }

  return maxRequired;
}

function isMasterData(data: MasterData): boolean {
  if (!Array.isArray(data.fullTimeStaff) || !Array.isArray(data.partTimeStaff) || !Array.isArray(data.children)) {
    return false;
  }
  if (!Array.isArray(data.shiftPatterns) || !Array.isArray(data.childRatios) || !Array.isArray(data.nurseryClasses)) {
    return false;
  }
  if (!data.shiftRules || typeof data.shiftRules !== "object") {
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

  const validSaturdayRequirement =
    typeof data.shiftRules.saturdayRequirement?.enabled === "boolean" &&
    Number.isFinite(data.shiftRules.saturdayRequirement?.minTotalStaff) &&
    data.shiftRules.saturdayRequirement.minTotalStaff >= 1 &&
    Array.isArray(data.shiftRules.saturdayRequirement?.combinations) &&
    data.shiftRules.saturdayRequirement.combinations.every(
      (item) =>
        Number.isFinite(item?.partTimeCount) &&
        item.partTimeCount >= 0 &&
        Number.isFinite(item?.fullTimeCount) &&
        item.fullTimeCount >= 0
    );
  if (!validSaturdayRequirement) {
    return false;
  }

  const validCompensatoryHoliday =
    typeof data.shiftRules.compensatoryHoliday?.enabled === "boolean" &&
    typeof data.shiftRules.compensatoryHoliday?.sameWeekRequired === "boolean" &&
    typeof data.shiftRules.compensatoryHoliday?.description === "string";
  if (!validCompensatoryHoliday) {
    return false;
  }

  const validCreationOrder =
    Array.isArray(data.shiftRules.creationOrder) &&
    data.shiftRules.creationOrder.length > 0 &&
    data.shiftRules.creationOrder.every(
      (item) =>
        typeof item?.id === "string" &&
        item.id.length > 0 &&
        Number.isFinite(item?.order) &&
        item.order >= 1 &&
        typeof item?.title === "string" &&
        item.title.trim().length > 0
    );
  if (!validCreationOrder) {
    return false;
  }

  const validAutoGenerationPolicy =
    typeof data.shiftRules.autoGenerationPolicy?.useProgrammaticLogic === "boolean" &&
    typeof data.shiftRules.autoGenerationPolicy?.useAi === "boolean" &&
    typeof data.shiftRules.autoGenerationPolicy?.sundayChildcareEnabled === "boolean" &&
    typeof data.shiftRules.autoGenerationPolicy?.skipSundayProcessing === "boolean" &&
    typeof data.shiftRules.autoGenerationPolicy?.preventFixedFullTimeShift === "boolean" &&
    typeof data.shiftRules.autoGenerationPolicy?.description === "string";
  if (!validAutoGenerationPolicy) {
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
    const hasInvalidSaturdayCombination = body.shiftRules.saturdayRequirement.combinations.some(
      (item) => item.partTimeCount + item.fullTimeCount !== body.shiftRules.saturdayRequirement.minTotalStaff
    );
    if (hasInvalidSaturdayCombination) {
      return NextResponse.json(
        {
          error: `土曜日パターンの合計人数（パート+常勤）は必要人数（${body.shiftRules.saturdayRequirement.minTotalStaff}人）と同じにしてください。`
        },
        { status: 400 }
      );
    }
    if (body.shiftRules.saturdayRequirement.enabled) {
      const saturdayRequiredMax = calculateSaturdayRequiredMax(body);
      if (body.shiftRules.saturdayRequirement.minTotalStaff < saturdayRequiredMax) {
        return NextResponse.json(
          {
            error: `土曜日の最低必要人数は対人数MAX（${saturdayRequiredMax}人）以上で設定してください。`
          },
          { status: 400 }
        );
      }
    }

    const normalizedBody: MasterData = {
      ...body,
      shiftRules: {
        ...body.shiftRules,
        autoGenerationPolicy: {
          ...body.shiftRules.autoGenerationPolicy,
          skipSundayProcessing: !body.shiftRules.autoGenerationPolicy.sundayChildcareEnabled
        }
      }
    };

    await putMasterData({
      ...normalizedBody,
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
