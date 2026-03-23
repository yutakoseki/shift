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

export type SaturdayStaffCombination = {
  partTimeCount: number;
  fullTimeCount: number;
};

export type ShiftRuleSaturdayRequirement = {
  enabled: boolean;
  minTotalStaff: number;
  combinations: SaturdayStaffCombination[];
};

export type ShiftRuleCompensatoryHoliday = {
  enabled: boolean;
  sameWeekRequired: boolean;
  description: string;
};

export type ShiftRuleCreationStep = {
  id: string;
  order: number;
  title: string;
};

export type ShiftAutoGenerationPolicy = {
  useProgrammaticLogic: boolean;
  useAi: boolean;
  sundayChildcareEnabled: boolean;
  skipSundayProcessing: boolean;
  preventFixedFullTimeShift: boolean;
  description: string;
};

export type ShiftRules = {
  saturdayRequirement: ShiftRuleSaturdayRequirement;
  compensatoryHoliday: ShiftRuleCompensatoryHoliday;
  creationOrder: ShiftRuleCreationStep[];
  autoGenerationPolicy: ShiftAutoGenerationPolicy;
};

export type MasterData = {
  fullTimeStaff: FullTimeStaff[];
  partTimeStaff: PartTimeStaff[];
  children: ChildProfile[];
  shiftPatterns: ShiftPattern[];
  childRatios: ChildRatio[];
  nurseryClasses: NurseryClass[];
  shiftRules: ShiftRules;
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
    nurseryClasses: normalizedClasses,
    shiftRules: normalizeShiftRules(data.shiftRules)
  };
}

function normalizeShiftRules(input: ShiftRules | undefined): ShiftRules {
  const defaults = createDefaultShiftRules();
  if (!input) {
    return defaults;
  }

  const normalizedCombinations = Array.isArray(input.saturdayRequirement?.combinations)
    ? input.saturdayRequirement.combinations
        .filter(
          (item) =>
            Number.isFinite(item?.partTimeCount) &&
            Number.isFinite(item?.fullTimeCount) &&
            item.partTimeCount >= 0 &&
            item.fullTimeCount >= 0
        )
        .map((item) => ({
          partTimeCount: Math.max(0, Math.floor(item.partTimeCount)),
          fullTimeCount: Math.max(0, Math.floor(item.fullTimeCount))
        }))
    : defaults.saturdayRequirement.combinations;

  const normalizedCreationOrder = Array.isArray(input.creationOrder)
    ? input.creationOrder
        .filter((item) => typeof item?.title === "string" && item.title.trim().length > 0)
        .map((item, index) => ({
          id: item.id || `step-${index + 1}`,
          order: Number.isFinite(item.order) ? Math.max(1, Math.floor(item.order)) : index + 1,
          title: item.title.trim()
        }))
    : defaults.creationOrder;

  const normalizedSundayChildcareEnabled =
    typeof input.autoGenerationPolicy?.sundayChildcareEnabled === "boolean"
      ? input.autoGenerationPolicy.sundayChildcareEnabled
      : defaults.autoGenerationPolicy.sundayChildcareEnabled;

  return {
    saturdayRequirement: {
      enabled:
        typeof input.saturdayRequirement?.enabled === "boolean"
          ? input.saturdayRequirement.enabled
          : defaults.saturdayRequirement.enabled,
      minTotalStaff: Number.isFinite(input.saturdayRequirement?.minTotalStaff)
        ? Math.max(1, Math.floor(input.saturdayRequirement.minTotalStaff))
        : defaults.saturdayRequirement.minTotalStaff,
      combinations: normalizedCombinations.length > 0 ? normalizedCombinations : defaults.saturdayRequirement.combinations
    },
    compensatoryHoliday: {
      enabled:
        typeof input.compensatoryHoliday?.enabled === "boolean"
          ? input.compensatoryHoliday.enabled
          : defaults.compensatoryHoliday.enabled,
      sameWeekRequired:
        typeof input.compensatoryHoliday?.sameWeekRequired === "boolean"
          ? input.compensatoryHoliday.sameWeekRequired
          : defaults.compensatoryHoliday.sameWeekRequired,
      description:
        typeof input.compensatoryHoliday?.description === "string" && input.compensatoryHoliday.description.trim().length > 0
          ? input.compensatoryHoliday.description.trim()
          : defaults.compensatoryHoliday.description
    },
    creationOrder: normalizedCreationOrder.length > 0 ? normalizedCreationOrder : defaults.creationOrder,
    autoGenerationPolicy: {
      useProgrammaticLogic:
        typeof input.autoGenerationPolicy?.useProgrammaticLogic === "boolean"
          ? input.autoGenerationPolicy.useProgrammaticLogic
          : defaults.autoGenerationPolicy.useProgrammaticLogic,
      useAi: typeof input.autoGenerationPolicy?.useAi === "boolean" ? input.autoGenerationPolicy.useAi : defaults.autoGenerationPolicy.useAi,
      sundayChildcareEnabled: normalizedSundayChildcareEnabled,
      // 日曜保育未実施なら、日曜処理は常に除外する
      skipSundayProcessing: !normalizedSundayChildcareEnabled,
      preventFixedFullTimeShift:
        typeof input.autoGenerationPolicy?.preventFixedFullTimeShift === "boolean"
          ? input.autoGenerationPolicy.preventFixedFullTimeShift
          : defaults.autoGenerationPolicy.preventFixedFullTimeShift,
      description:
        typeof input.autoGenerationPolicy?.description === "string" && input.autoGenerationPolicy.description.trim().length > 0
          ? input.autoGenerationPolicy.description.trim()
          : defaults.autoGenerationPolicy.description
    }
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

export function createDefaultShiftRules(): ShiftRules {
  return {
    saturdayRequirement: {
      enabled: true,
      minTotalStaff: 3,
      combinations: [
        { partTimeCount: 2, fullTimeCount: 1 },
        { partTimeCount: 1, fullTimeCount: 2 },
        { partTimeCount: 0, fullTimeCount: 3 }
      ]
    },
    compensatoryHoliday: {
      enabled: true,
      sameWeekRequired: true,
      description: "土曜日に出勤した職員は、原則として同じ週に振替休日を取得する。"
    },
    creationOrder: [
      { id: "step-1", order: 1, title: "休みを入力" },
      { id: "step-2", order: 2, title: "イベントを入力" },
      { id: "step-3", order: 3, title: "パートさんでほぼ入れる人を入れる" },
      { id: "step-4", order: 4, title: "常勤の早番を入れる" },
      { id: "step-5", order: 5, title: "常勤の遅番を入れる" },
      { id: "step-6", order: 6, title: "週◯回のパートさんを入れる" },
      { id: "step-7", order: 7, title: "常勤で調整する" }
    ],
    autoGenerationPolicy: {
      useProgrammaticLogic: true,
      useAi: true,
      sundayChildcareEnabled: false,
      skipSundayProcessing: true,
      preventFixedFullTimeShift: true,
      description: "シフト自動作成は、ルールベースのプログラムとAI補助を組み合わせて実行する。"
    }
  };
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
    shiftRules: createDefaultShiftRules(),
    updatedAt: new Date().toISOString()
  };
}
