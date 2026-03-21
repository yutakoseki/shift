export type StaffBase = {
  id: string;
  name: string;
  mainClass: string;
  possibleShiftPatternCodes: string[];
};

export type FullTimeStaff = StaffBase;

export type PartTimeStaff = StaffBase & {
  availableWeekdays: number[];
  availableStartTime: string;
  availableEndTime: string;
  defaultShiftPatternCode: string;
  weeklyDays: number;
  notes: string;
};

export type ChildAttendanceSlot = {
  weekday: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type ChildProfile = {
  id: string;
  name: string;
  birthDate: string;
  classId: string;
  className: string;
  attendanceByWeekday: ChildAttendanceSlot[];
};

export type ShiftPattern = {
  code: string;
  label: string;
  startTime: string;
  endTime: string;
  isCustom: boolean;
};

export type ChildRatio = {
  age: number;
  ratio: number;
};

export type NurseryClass = {
  id: string;
  name: string;
  ageGroup: string;
};

export type MasterData = {
  fullTimeStaff: FullTimeStaff[];
  partTimeStaff: PartTimeStaff[];
  children: ChildProfile[];
  shiftPatterns: ShiftPattern[];
  childRatios: ChildRatio[];
  nurseryClasses: NurseryClass[];
  updatedAt: string;
};

type LegacyNurseryClass = {
  id: string;
  name: string;
  count?: number;
  ageGroup?: string;
};

export function createDefaultChildAttendance(): ChildAttendanceSlot[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    enabled: weekday >= 1 && weekday <= 5,
    startTime: "08:00",
    endTime: "18:00"
  }));
}

type LegacyChildProfile = {
  id: string;
  name: string;
  birthDate: string;
  classId?: string;
  className?: string;
  class?: string;
  attendanceWeekdays?: number[];
  attendanceStartTime?: string;
  attendanceEndTime?: string;
};

export function normalizeChildProfile(input: ChildProfile | LegacyChildProfile): ChildProfile {
  const maybeChild = input as ChildProfile;
  if (Array.isArray(maybeChild.attendanceByWeekday)) {
    const normalized = createDefaultChildAttendance().map((slot) => {
      const found = maybeChild.attendanceByWeekday.find((item) => item.weekday === slot.weekday);
      if (!found) {
        return slot;
      }
      return {
        weekday: slot.weekday,
        enabled: Boolean(found.enabled),
        startTime: found.startTime || slot.startTime,
        endTime: found.endTime || slot.endTime
      };
    });
    return {
      id: maybeChild.id,
      name: maybeChild.name,
      birthDate: maybeChild.birthDate,
      classId: maybeChild.classId || "",
      className: maybeChild.className || "",
      attendanceByWeekday: normalized
    };
  }

  const legacy = input as LegacyChildProfile;
  const weekdays = legacy.attendanceWeekdays ?? [1, 2, 3, 4, 5];
  const startTime = legacy.attendanceStartTime ?? "08:00";
  const endTime = legacy.attendanceEndTime ?? "18:00";
  return {
    id: legacy.id,
    name: legacy.name,
    birthDate: legacy.birthDate,
    classId: legacy.classId ?? "",
    className: legacy.className ?? legacy.class ?? "",
    attendanceByWeekday: createDefaultChildAttendance().map((slot) => ({
      weekday: slot.weekday,
      enabled: weekdays.includes(slot.weekday),
      startTime,
      endTime
    }))
  };
}

export function normalizeMasterData(data: MasterData): MasterData {
  const normalizeAgeGroupFromName = (name: string): string => {
    if (name.includes("0-1")) {
      return "0-1歳児";
    }
    if (name.includes("2-3")) {
      return "2-3歳児";
    }
    if (name.includes("4-5")) {
      return "4-5歳児";
    }
    return "";
  };

  const normalizedClasses = ((data.nurseryClasses ?? []) as LegacyNurseryClass[]).map((classItem) => ({
    id: classItem.id,
    name: classItem.name,
    ageGroup: classItem.ageGroup ?? normalizeAgeGroupFromName(classItem.name)
  }));

  return {
    ...data,
    children: (data.children ?? []).map((child) => normalizeChildProfile(child)),
    nurseryClasses: normalizedClasses
  };
}

function defaultShiftPatterns(): ShiftPattern[] {
  return [
    { code: "A1", label: "A1", startTime: "06:00", endTime: "15:00", isCustom: false },
    { code: "A2", label: "A2", startTime: "06:15", endTime: "15:15", isCustom: false },
    { code: "A3", label: "A3", startTime: "06:30", endTime: "15:30", isCustom: false },
    { code: "A4", label: "A4", startTime: "06:45", endTime: "15:45", isCustom: false },
    { code: "B1", label: "B1", startTime: "07:00", endTime: "16:00", isCustom: false },
    { code: "B2", label: "B2", startTime: "07:15", endTime: "16:15", isCustom: false },
    { code: "B3", label: "B3", startTime: "07:30", endTime: "16:30", isCustom: false },
    { code: "B4", label: "B4", startTime: "07:45", endTime: "16:45", isCustom: false },
    { code: "C1", label: "C1", startTime: "08:00", endTime: "17:00", isCustom: false },
    { code: "C2", label: "C2", startTime: "08:15", endTime: "17:15", isCustom: false },
    { code: "C3", label: "C3", startTime: "08:30", endTime: "17:30", isCustom: false },
    { code: "C4", label: "C4", startTime: "08:45", endTime: "17:45", isCustom: false },
    { code: "D1", label: "D1", startTime: "09:00", endTime: "18:00", isCustom: false },
    { code: "D2", label: "D2", startTime: "09:15", endTime: "18:15", isCustom: false },
    { code: "D3", label: "D3", startTime: "09:30", endTime: "18:30", isCustom: false },
    { code: "D4", label: "D4", startTime: "09:45", endTime: "18:45", isCustom: false }
  ];
}

export function createDefaultMasterData(): MasterData {
  return {
    fullTimeStaff: [],
    partTimeStaff: [],
    children: [],
    shiftPatterns: defaultShiftPatterns(),
    childRatios: [
      { age: 0, ratio: 3 },
      { age: 1, ratio: 6 },
      { age: 2, ratio: 6 },
      { age: 3, ratio: 15 },
      { age: 4, ratio: 25 },
      { age: 5, ratio: 25 }
    ],
    nurseryClasses: [],
    updatedAt: new Date().toISOString()
  };
}
