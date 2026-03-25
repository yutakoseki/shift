"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createDefaultShiftRules, MasterData, PartTimeStaff, ShiftRules } from "@/types/master-data";
import { SHIFT_CLASS_GROUPS, ShiftClassGroup, ShiftColumn, ShiftEntry, ShiftMonthResponse } from "@/types/shift";
import FullscreenLoading from "@/components/fullscreen-loading";
import { showToast } from "@/lib/master-data-client";

const REQUIRED_STAFF_TIMES = [
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30"
] as const;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const DATE_GROUP_ROW_COUNT = SHIFT_CLASS_GROUPS.length + 1;

type ShortageItem = {
  date: string;
  time: string;
  required: number;
  assigned: number;
};

type PlannerStep = 1 | 2 | 3 | 4 | 5 | 6;

type AutoGenerateLogLevel = "info" | "warn";

type AutoGenerateLogItem = {
  id: string;
  sequence: number;
  time: string;
  level: AutoGenerateLogLevel;
  step: string;
  message: string;
};

type AutoGenerationSnapshot = {
  id: string;
  label: string;
  note: string;
  cells: Record<string, string>;
  offByDateAndStaff: Record<string, boolean>;
  logs: AutoGenerateLogItem[];
};

type AiShortageSuggestion = {
  date: string;
  time: string;
  staffName: string;
  shiftType: string;
  reason: string;
};

type AiCompensatorySuggestion = {
  staffName: string;
  saturdayDate: string;
  candidateDate: string;
  reason: string;
};

type AiNaturalLanguageOperation = {
  type: "assignShift" | "clearShift" | "setOff";
  date: string;
  staffName: string;
  shiftType?: string;
  enabled?: boolean;
  reason?: string;
};

function createShiftColumnId(shiftType: string): string {
  return `${shiftType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function monthToDates(month: string): string[] {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const lastDay = new Date(year, monthNumber, 0).getDate();

  return Array.from({ length: lastDay }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function keyOf(date: string, columnId: string, classGroup: ShiftClassGroup): string {
  return `${date}|${classGroup}|${columnId}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function isSundayDate(date: string): boolean {
  return new Date(`${date}T00:00:00`).getDay() === 0;
}

function isSaturdayDate(date: string): boolean {
  return new Date(`${date}T00:00:00`).getDay() === 6;
}

function ageAtMonthStart(birthDate: string, month: string): number | null {
  if (!birthDate) {
    return null;
  }
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) {
    return null;
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) {
    return null;
  }
  const reference = new Date(year, monthNumber - 1, 1);

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDiff = reference.getMonth() - birth.getMonth();
  const dayDiff = reference.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return Math.max(age, 0);
}

function resolveRatioForAge(age: number, ratioByAge: Map<number, number>): number | null {
  if (ratioByAge.has(age)) {
    return ratioByAge.get(age) ?? null;
  }
  const ages = Array.from(ratioByAge.keys()).sort((a, b) => a - b);
  if (ages.length === 0) {
    return null;
  }
  if (age < ages[0]) {
    return ratioByAge.get(ages[0]) ?? null;
  }
  if (age > ages[ages.length - 1]) {
    return ratioByAge.get(ages[ages.length - 1]) ?? null;
  }
  for (let index = ages.length - 1; index >= 0; index -= 1) {
    if (ages[index] <= age) {
      return ratioByAge.get(ages[index]) ?? null;
    }
  }
  return null;
}

function requiredCountFromAgeCounts(childCountByAge: Map<number, number>, ratioByAge: Map<number, number>): number {
  let requiredBase = 0;
  childCountByAge.forEach((childCount, age) => {
    const ratio = resolveRatioForAge(age, ratioByAge);
    if (!ratio || ratio <= 0) {
      return;
    }
    requiredBase += childCount / ratio;
  });
  return Math.ceil(requiredBase);
}

function weekdayFromDateText(date: string): number {
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 0;
  }
  return new Date(year, month - 1, day).getDay();
}

function dayLabelFromDateText(date: string): string {
  const dayText = date.split("-")[2];
  const dayNumber = Number(dayText);
  return Number.isFinite(dayNumber) ? String(dayNumber) : date;
}

function shortDateWithWeekday(date: string): string {
  const parts = date.split("-");
  const monthText = parts[1];
  const dayText = parts[2];
  const month = Number(monthText);
  const day = Number(dayText);
  const weekday = weekdayFromDateText(date);
  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    return date;
  }
  return `${month}/${day}(${WEEKDAY_LABELS[weekday]})`;
}

function teacherFriendlyStepLabel(step: string): string {
  const map: Record<string, string> = {
    start: "開始",
    rules: "ルール確認",
    capacity: "その日の配置可能人数確認",
    "step-1": "休み入力の反映",
    "step-2": "イベント入力の反映",
    "step-3": "パート優先配置",
    "step-4": "常勤早番配置",
    "step-5": "常勤遅番配置",
    "step-6": "パート配置",
    "step-7": "常勤調整",
    "step-7b": "振替後の再調整",
    "compensatory-holiday": "振替休日の調整",
    "daily-summary": "1日ごとの結果",
    "saturday-rule": "土曜ルール確認",
    "analysis": "配置バランス確認",
    "hard-rule-time": "時間帯不足チェック",
    "hard-rule": "絶対ルールチェック",
    "soft-rule": "目安不足チェック",
    finish: "完了",
    error: "エラー"
  };
  return map[step] ?? step;
}

function teacherFriendlyMessage(log: AutoGenerateLogItem): string {
  const datePrefixMatch = log.message.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)$/);
  if (datePrefixMatch) {
    return `${shortDateWithWeekday(datePrefixMatch[1])}: ${datePrefixMatch[2]}`;
  }

  const dateTimePrefixMatch = log.message.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}):\s*(.*)$/);
  if (dateTimePrefixMatch) {
    return `${shortDateWithWeekday(dateTimePrefixMatch[1])} ${dateTimePrefixMatch[2]}: ${dateTimePrefixMatch[3]}`;
  }

  return log.message
    .replaceAll("必要目安", "必要")
    .replaceAll("可用", "出勤可能")
    .replaceAll("枠", "入力枠");
}

function headerStripeClass(columnIndex: number): string {
  return columnIndex % 2 === 0 ? "bg-orange-100/70" : "bg-orange-200/60";
}

function bodyStripeClass(columnIndex: number): string {
  return columnIndex % 2 === 0 ? "bg-white/70" : "bg-orange-50/40";
}

function summaryStripeClass(columnIndex: number): string {
  return columnIndex % 2 === 0 ? "bg-orange-100/40" : "bg-orange-200/30";
}

function mapsEqualNumberRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}

export default function HomePage() {
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMasterData, setLoadingMasterData] = useState(false);
  const [masterData, setMasterData] = useState<MasterData | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [offByDateAndStaff, setOffByDateAndStaff] = useState<Record<string, boolean>>({});
  const [shiftColumns, setShiftColumns] = useState<ShiftColumn[]>([
    { id: createShiftColumnId("早番"), shiftType: "早番" },
    { id: createShiftColumnId("中番"), shiftType: "中番" },
    { id: createShiftColumnId("遅番"), shiftType: "遅番" }
  ]);
  const [headerMenuColumnId, setHeaderMenuColumnId] = useState<string | null>(null);
  const [addColumnBaseColumnId, setAddColumnBaseColumnId] = useState<string | null>(null);
  const [addColumnShiftType, setAddColumnShiftType] = useState("");
  const [deleteTargetColumnId, setDeleteTargetColumnId] = useState<string | null>(null);
  const [showShortageModal, setShowShortageModal] = useState(false);
  const [requiredOverrideByTime, setRequiredOverrideByTime] = useState<Record<string, number>>({});
  const [requiredSaturdayOverrideByTime, setRequiredSaturdayOverrideByTime] = useState<Record<string, number>>({});
  const [showResetRequiredModal, setShowResetRequiredModal] = useState(false);
  const [viewMode, setViewMode] = useState<"class" | "staff" | "daily">("class");
  const [dailyViewDate, setDailyViewDate] = useState("");
  const [eventByDate, setEventByDate] = useState<Record<string, string>>({});
  const [noteByDate, setNoteByDate] = useState<Record<string, string>>({});
  const [plannerStep, setPlannerStep] = useState<PlannerStep>(1);
  const [monthConfirmed, setMonthConfirmed] = useState(false);
  const [offInputConfirmed, setOffInputConfirmed] = useState(false);
  const [eventInputConfirmed, setEventInputConfirmed] = useState(false);
  const [ruleConfirmed, setRuleConfirmed] = useState(false);
  const [supplementNote, setSupplementNote] = useState("");
  const [showCreateStepModal, setShowCreateStepModal] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoGenerateError, setAutoGenerateError] = useState("");
  const [autoGenerateLogs, setAutoGenerateLogs] = useState<AutoGenerateLogItem[]>([]);
  const [autoGenerateLogsExpanded, setAutoGenerateLogsExpanded] = useState(false);
  const [aiShortageSuggestions, setAiShortageSuggestions] = useState<AiShortageSuggestion[]>([]);
  const [aiCompensatorySuggestions, setAiCompensatorySuggestions] = useState<AiCompensatorySuggestion[]>([]);
  const [aiLogSummary, setAiLogSummary] = useState("");
  const [aiSummaryBullets, setAiSummaryBullets] = useState<string[]>([]);
  const [aiSupplementGuidance, setAiSupplementGuidance] = useState("");
  const [aiNaturalLanguageInstruction, setAiNaturalLanguageInstruction] = useState("");
  const [aiNaturalLanguageResult, setAiNaturalLanguageResult] = useState("");
  const [aiActionRunning, setAiActionRunning] = useState(false);
  const autoGenerateRunningRef = useRef(false);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const [topScrollWidth, setTopScrollWidth] = useState(0);
  const syncingScrollFrom = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const dates = useMemo(() => monthToDates(month), [month]);
  useEffect(() => {
    if (dates.length === 0) {
      if (dailyViewDate) {
        setDailyViewDate("");
      }
      return;
    }
    if (!dailyViewDate || !dates.includes(dailyViewDate)) {
      setDailyViewDate(dates[0]);
    }
  }, [dailyViewDate, dates]);
  const shiftPatterns = useMemo(() => masterData?.shiftPatterns ?? [], [masterData]);
  const allShiftTypes = useMemo(() => {
    const values = shiftPatterns.map((pattern) => pattern.code.trim()).filter((code) => code.length > 0);
    return values.length > 0 ? values : ["早番", "中番", "遅番"];
  }, [shiftPatterns]);

  useEffect(() => {
    setShiftColumns((prev) => {
      const filtered = prev.filter((column) => allShiftTypes.includes(column.shiftType));
      if (filtered.length > 0) {
        return filtered;
      }
      return allShiftTypes.map((shiftType) => ({ id: createShiftColumnId(shiftType), shiftType }));
    });
  }, [allShiftTypes]);

  const allStaffNames = useMemo(() => {
    if (!masterData) {
      return [];
    }
    const fullNames = masterData.fullTimeStaff.map((staff) => staff.name.trim()).filter((name) => name.length > 0);
    const partNames = masterData.partTimeStaff.map((staff) => staff.name.trim()).filter((name) => name.length > 0);
    return Array.from(new Set([...fullNames, ...partNames]));
  }, [masterData]);
  const offRecordCount = useMemo(
    () => Object.values(offByDateAndStaff).filter((enabled) => enabled).length,
    [offByDateAndStaff]
  );
  const eventInputCount = useMemo(
    () => dates.filter((date) => (eventByDate[date] ?? "").trim().length > 0).length,
    [dates, eventByDate]
  );

  const partTimeByName = useMemo(() => {
    if (!masterData) {
      return new Map<string, PartTimeStaff>();
    }
    return new Map(masterData.partTimeStaff.map((staff) => [staff.name.trim(), staff]));
  }, [masterData]);

  const fullTimeByName = useMemo(() => {
    if (!masterData) {
      return new Map<string, MasterData["fullTimeStaff"][number]>();
    }
    return new Map(masterData.fullTimeStaff.map((staff) => [staff.name.trim(), staff]));
  }, [masterData]);

  const shiftPatternByCode = useMemo(() => {
    return new Map(shiftPatterns.map((pattern) => [pattern.code, pattern]));
  }, [shiftPatterns]);

  const activeAutoGenerationPolicy = useMemo(
    () => masterData?.shiftRules?.autoGenerationPolicy ?? createDefaultShiftRules().autoGenerationPolicy,
    [masterData]
  );
  const sundayShiftInputEnabled = activeAutoGenerationPolicy.sundayChildcareEnabled;
  const activeSaturdayRequirement = useMemo(
    () => masterData?.shiftRules?.saturdayRequirement ?? createDefaultShiftRules().saturdayRequirement,
    [masterData]
  );

  const requiredStaffByTime = useMemo(() => {
    if (!masterData) {
      return REQUIRED_STAFF_TIMES.map((time) => ({ time, requiredCount: 0 }));
    }

    const ratioByAge = new Map(
      masterData.childRatios
        .filter((item) => Number.isFinite(item.age) && Number.isFinite(item.ratio) && item.ratio > 0)
        .map((item) => [item.age, item.ratio])
    );

    return REQUIRED_STAFF_TIMES.map((time) => {
      const targetMinutes = timeToMinutes(time);
      let maxRequiredCount = 0;

      for (let weekday = 0; weekday <= 6; weekday += 1) {
        if (activeAutoGenerationPolicy.skipSundayProcessing && weekday === 0) {
          continue;
        }
        const childCountByAge = new Map<number, number>();

        for (const child of masterData.children) {
          const age = ageAtMonthStart(child.birthDate, month);
          if (age === null) {
            continue;
          }
          const attendance = child.attendanceByWeekday.find((slot) => slot.weekday === weekday);
          if (!attendance || !attendance.enabled) {
            continue;
          }
          const startMinutes = timeToMinutes(attendance.startTime);
          const endMinutes = timeToMinutes(attendance.endTime);
          if (targetMinutes < startMinutes || targetMinutes >= endMinutes) {
            continue;
          }
          childCountByAge.set(age, (childCountByAge.get(age) ?? 0) + 1);
        }

        const requiredCountForWeekday = requiredCountFromAgeCounts(childCountByAge, ratioByAge);

        if (requiredCountForWeekday > maxRequiredCount) {
          maxRequiredCount = requiredCountForWeekday;
        }
      }

      return { time, requiredCount: maxRequiredCount };
    });
  }, [activeAutoGenerationPolicy.skipSundayProcessing, masterData, month]);

  const effectiveRequiredStaffByTime = useMemo(() => {
    return requiredStaffByTime.map((item) => ({
      time: item.time,
      requiredCount:
        requiredOverrideByTime[item.time] !== undefined && Number.isFinite(requiredOverrideByTime[item.time])
          ? Math.max(0, requiredOverrideByTime[item.time])
          : item.requiredCount
    }));
  }, [requiredOverrideByTime, requiredStaffByTime]);

  const calculatedRequiredByTimeMap = useMemo(() => {
    const map: Record<string, number> = {};
    requiredStaffByTime.forEach((item) => {
      map[item.time] = item.requiredCount;
    });
    return map;
  }, [requiredStaffByTime]);

  const saturdayRequiredStaffByTimeCalculated = useMemo(() => {
    if (!masterData) {
      return REQUIRED_STAFF_TIMES.map((time) => ({ time, requiredCount: 0 }));
    }
    const ratioByAge = new Map(
      masterData.childRatios
        .filter((item) => Number.isFinite(item.age) && Number.isFinite(item.ratio) && item.ratio > 0)
        .map((item) => [item.age, item.ratio])
    );
    const saturday = 6;
    return REQUIRED_STAFF_TIMES.map((time) => {
      const targetMinutes = timeToMinutes(time);
      const childCountByAge = new Map<number, number>();
      for (const child of masterData.children) {
        const age = ageAtMonthStart(child.birthDate, month);
        if (age === null) {
          continue;
        }
        const attendance = child.attendanceByWeekday.find((slot) => slot.weekday === saturday);
        if (!attendance || !attendance.enabled) {
          continue;
        }
        const startMinutes = timeToMinutes(attendance.startTime);
        const endMinutes = timeToMinutes(attendance.endTime);
        if (targetMinutes < startMinutes || targetMinutes >= endMinutes) {
          continue;
        }
        childCountByAge.set(age, (childCountByAge.get(age) ?? 0) + 1);
      }
      const requiredCount = requiredCountFromAgeCounts(childCountByAge, ratioByAge);
      return { time, requiredCount };
    });
  }, [masterData, month]);

  const calculatedSaturdayRequiredByTimeMap = useMemo(() => {
    const map: Record<string, number> = {};
    saturdayRequiredStaffByTimeCalculated.forEach((item) => {
      map[item.time] = item.requiredCount;
    });
    return map;
  }, [saturdayRequiredStaffByTimeCalculated]);

  const saturdayRequiredStaffByTime = useMemo(() => {
    return saturdayRequiredStaffByTimeCalculated.map((item) => {
      const override = requiredSaturdayOverrideByTime[item.time];
      return {
        time: item.time,
        requiredCount: Number.isFinite(override) ? Math.max(0, override) : item.requiredCount
      };
    });
  }, [requiredSaturdayOverrideByTime, saturdayRequiredStaffByTimeCalculated]);

  // 旧データ（全時間帯を保存していた形式）を読み込んだ場合も、
  // 現在の自動計算値との差分だけを上書きとして保持する。
  useEffect(() => {
    setRequiredOverrideByTime((prev) => {
      const next: Record<string, number> = {};
      REQUIRED_STAFF_TIMES.forEach((time) => {
        const override = prev[time];
        if (!Number.isFinite(override)) {
          return;
        }
        const normalized = Math.max(0, override);
        if (normalized !== (calculatedRequiredByTimeMap[time] ?? 0)) {
          next[time] = normalized;
        }
      });
      return mapsEqualNumberRecord(prev, next) ? prev : next;
    });
  }, [calculatedRequiredByTimeMap]);

  useEffect(() => {
    setRequiredSaturdayOverrideByTime((prev) => {
      const next: Record<string, number> = {};
      REQUIRED_STAFF_TIMES.forEach((time) => {
        const override = prev[time];
        if (!Number.isFinite(override)) {
          return;
        }
        const normalized = Math.max(0, override);
        if (normalized !== (calculatedSaturdayRequiredByTimeMap[time] ?? 0)) {
          next[time] = normalized;
        }
      });
      return mapsEqualNumberRecord(prev, next) ? prev : next;
    });
  }, [calculatedSaturdayRequiredByTimeMap]);

  const effectiveRequiredStaffCountByDate = useMemo(() => {
    const countByDate = new Map<string, number[]>();
    if (!masterData) {
      for (const date of dates) {
        countByDate.set(date, REQUIRED_STAFF_TIMES.map(() => 0));
      }
      return countByDate;
    }

    const ratioByAge = new Map(
      masterData.childRatios
        .filter((item) => Number.isFinite(item.age) && Number.isFinite(item.ratio) && item.ratio > 0)
        .map((item) => [item.age, item.ratio])
    );

    for (const date of dates) {
      const weekday = weekdayFromDateText(date);
      if (activeAutoGenerationPolicy.skipSundayProcessing && weekday === 0) {
        countByDate.set(date, REQUIRED_STAFF_TIMES.map(() => 0));
        continue;
      }

      const counts = REQUIRED_STAFF_TIMES.map((time) => {
        const targetMinutes = timeToMinutes(time);
        const childCountByAge = new Map<number, number>();

        for (const child of masterData.children) {
          const age = ageAtMonthStart(child.birthDate, month);
          if (age === null) {
            continue;
          }
          const attendance = child.attendanceByWeekday.find((slot) => slot.weekday === weekday);
          if (!attendance || !attendance.enabled) {
            continue;
          }
          const startMinutes = timeToMinutes(attendance.startTime);
          const endMinutes = timeToMinutes(attendance.endTime);
          if (targetMinutes < startMinutes || targetMinutes >= endMinutes) {
            continue;
          }
          childCountByAge.set(age, (childCountByAge.get(age) ?? 0) + 1);
        }

        const requiredCount = requiredCountFromAgeCounts(childCountByAge, ratioByAge);

        const override = requiredOverrideByTime[time];
        const withOverride = Number.isFinite(override) ? Math.max(0, override) : requiredCount;
        if (weekday === 6 && activeSaturdayRequirement.enabled) {
          const saturdayOverride = requiredSaturdayOverrideByTime[time];
          const saturdayCount = Number.isFinite(saturdayOverride)
            ? Math.max(0, saturdayOverride)
            : saturdayRequiredStaffByTime.find((item) => item.time === time)?.requiredCount ?? withOverride;
          return saturdayCount;
        }
        return withOverride;
      });
      countByDate.set(date, counts);
    }

    return countByDate;
  }, [
    activeAutoGenerationPolicy.skipSundayProcessing,
    activeSaturdayRequirement.enabled,
    dates,
    masterData,
    month,
    requiredOverrideByTime,
    requiredSaturdayOverrideByTime,
    saturdayRequiredStaffByTime
  ]);

  const assignedStaffCountByDateAndClass = useMemo(() => {
    const countByDateAndClass = new Map<string, number[]>();
    for (const date of dates) {
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        const counts = REQUIRED_STAFF_TIMES.map((time) => {
          const targetMinutes = timeToMinutes(time);
          const presentStaff = new Set<string>();
          for (const column of shiftColumns) {
            const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
            if (!staffName) {
              continue;
            }
            const pattern = shiftPatternByCode.get(column.shiftType);
            if (!pattern) {
              continue;
            }
            const startMinutes = timeToMinutes(pattern.startTime);
            const endMinutes = timeToMinutes(pattern.endTime);
            if (targetMinutes >= startMinutes && targetMinutes < endMinutes) {
              presentStaff.add(staffName);
            }
          }
          return presentStaff.size;
        });
        countByDateAndClass.set(`${date}|${classGroup.key}`, counts);
      }
    }
    return countByDateAndClass;
  }, [cells, dates, shiftColumns, shiftPatternByCode]);

  const assignedTotalStaffCountByDate = useMemo(() => {
    const countByDate = new Map<string, number[]>();
    for (const date of dates) {
      const counts = REQUIRED_STAFF_TIMES.map((time) => {
        const targetMinutes = timeToMinutes(time);
        const presentStaff = new Set<string>();
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const column of shiftColumns) {
            const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
            if (!staffName) {
              continue;
            }
            const pattern = shiftPatternByCode.get(column.shiftType);
            if (!pattern) {
              continue;
            }
            const startMinutes = timeToMinutes(pattern.startTime);
            const endMinutes = timeToMinutes(pattern.endTime);
            if (targetMinutes >= startMinutes && targetMinutes < endMinutes) {
              presentStaff.add(staffName);
            }
          }
        }
        return presentStaff.size;
      });
      countByDate.set(date, counts);
    }
    return countByDate;
  }, [cells, dates, shiftColumns, shiftPatternByCode]);

  const shortageItems = useMemo(() => {
    const items: ShortageItem[] = [];
    for (const date of dates) {
      const assignedCounts = assignedTotalStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0);
      const requiredCounts = effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0);
      requiredCounts.forEach((requiredCount, index) => {
        const assigned = assignedCounts[index] ?? 0;
        if (assigned < requiredCount) {
          items.push({
            date,
            time: REQUIRED_STAFF_TIMES[index],
            required: requiredCount,
            assigned
          });
        }
      });
    }
    return items;
  }, [assignedTotalStaffCountByDate, dates, effectiveRequiredStaffCountByDate]);

  const assignedStaffCountByDateAndName = useMemo(() => {
    const countByDate = new Map<string, Map<string, number>>();
    for (const date of dates) {
      const countByName = new Map<string, number>();
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
          if (!staffName) {
            continue;
          }
          countByName.set(staffName, (countByName.get(staffName) ?? 0) + 1);
        }
      }
      countByDate.set(date, countByName);
    }
    return countByDate;
  }, [cells, dates, shiftColumns]);

  const offStaffTextByDate = useMemo(() => {
    const byDate = new Map<string, string>();
    for (const date of dates) {
      const names = Object.keys(offByDateAndStaff)
        .filter((recordKey) => offByDateAndStaff[recordKey] && recordKey.startsWith(`${date}|`))
        .map((recordKey) => recordKey.split("|")[1])
        .filter((name) => Boolean(name));
      byDate.set(date, Array.from(new Set(names)).join("、"));
    }
    return byDate;
  }, [dates, offByDateAndStaff]);

  const selectableShiftTypesForStaffView = useMemo(
    () => Array.from(new Set(shiftColumns.map((column) => column.shiftType))),
    [shiftColumns]
  );

  const primaryAssignmentByDateAndStaff = useMemo(() => {
    const result = new Map<string, Map<string, { shiftType: string; classGroup: ShiftClassGroup; count: number }>>();
    for (const date of dates) {
      const byStaff = new Map<string, { shiftType: string; classGroup: ShiftClassGroup; count: number }>();
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
          if (!staffName) {
            continue;
          }
          const current = byStaff.get(staffName);
          if (!current) {
            byStaff.set(staffName, { shiftType: column.shiftType, classGroup: classGroup.key, count: 1 });
          } else {
            byStaff.set(staffName, { ...current, count: current.count + 1 });
          }
        }
      }
      result.set(date, byStaff);
    }
    return result;
  }, [cells, dates, shiftColumns]);

  const shiftCodesByDateAndStaff = useMemo(() => {
    const result = new Map<string, Map<string, string>>();
    for (const date of dates) {
      const codesByName = new Map<string, string[]>();
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
          if (!staffName) {
            continue;
          }
          if (!codesByName.has(staffName)) {
            codesByName.set(staffName, []);
          }
          codesByName.get(staffName)?.push(column.shiftType);
        }
      }

      const textByName = new Map<string, string>();
      codesByName.forEach((codes, name) => {
        textByName.set(name, Array.from(new Set(codes)).join(" / "));
      });
      result.set(date, textByName);
    }
    return result;
  }, [cells, dates, shiftColumns]);

  const assignedShiftTypesByDateAndStaff = useMemo(() => {
    const result = new Map<string, Map<string, string[]>>();
    for (const date of dates) {
      const shiftSetByName = new Map<string, Set<string>>();
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
          if (!staffName) {
            continue;
          }
          if (!shiftSetByName.has(staffName)) {
            shiftSetByName.set(staffName, new Set<string>());
          }
          shiftSetByName.get(staffName)?.add(column.shiftType);
        }
      }
      const shiftTypesByName = new Map<string, string[]>();
      shiftSetByName.forEach((codes, name) => {
        const orderedCodes = Array.from(codes).sort((a, b) => {
          const aStart = timeToMinutes(shiftPatternByCode.get(a)?.startTime ?? "23:59");
          const bStart = timeToMinutes(shiftPatternByCode.get(b)?.startTime ?? "23:59");
          if (aStart !== bStart) {
            return aStart - bStart;
          }
          return a.localeCompare(b, "ja");
        });
        shiftTypesByName.set(name, orderedCodes);
      });
      result.set(date, shiftTypesByName);
    }
    return result;
  }, [cells, dates, shiftColumns, shiftPatternByCode]);

  const dailyTimelineTimes = useMemo(() => {
    const usedShiftTypes = Array.from(new Set(shiftColumns.map((column) => column.shiftType)));
    const minuteRanges = usedShiftTypes
      .map((shiftType) => shiftPatternByCode.get(shiftType))
      .filter((pattern): pattern is NonNullable<typeof pattern> => Boolean(pattern))
      .map((pattern) => ({
        start: timeToMinutes(pattern.startTime),
        end: timeToMinutes(pattern.endTime)
      }))
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);

    const formatMinutes = (minutes: number): string => {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const minuteSet = new Set<number>(REQUIRED_STAFF_TIMES.map((time) => timeToMinutes(time)));
    if (minuteRanges.length > 0) {
      const minStart = Math.min(...minuteRanges.map((item) => item.start));
      const maxEnd = Math.max(...minuteRanges.map((item) => item.end));
      const alignedStart = Math.floor(minStart / 30) * 30;
      const alignedEnd = Math.ceil(maxEnd / 30) * 30;
      for (let current = alignedStart; current < alignedEnd; current += 30) {
        minuteSet.add(current);
      }
    }
    return Array.from(minuteSet)
      .sort((a, b) => a - b)
      .map((minutes) => formatMinutes(minutes));
  }, [shiftColumns, shiftPatternByCode]);

  const dailyRowsByDate = useMemo(() => {
    const result = new Map<
      string,
      {
        name: string;
        shiftText: string;
        timeText: string;
        timelineShiftTypes: string[];
        isOff: boolean;
        hasAssignment: boolean;
      }[]
    >();

    for (const date of dates) {
      const shiftTypesByName = assignedShiftTypesByDateAndStaff.get(date) ?? new Map<string, string[]>();
      const rows = allStaffNames.map((name) => {
        const shiftTypes = shiftTypesByName.get(name) ?? [];
        const isOff = offByDateAndStaff[`${date}|${name}`] === true;
        if (shiftTypes.length === 0) {
          return {
            name,
            shiftText: isOff ? "休み" : "",
            timeText: isOff ? "ー" : "",
            timelineShiftTypes: [],
            isOff,
            hasAssignment: false
          };
        }

        const ranges = shiftTypes
          .map((shiftType) => shiftPatternByCode.get(shiftType))
          .filter((pattern): pattern is NonNullable<typeof pattern> => Boolean(pattern));
        const starts = ranges.map((pattern) => timeToMinutes(pattern.startTime));
        const ends = ranges.map((pattern) => timeToMinutes(pattern.endTime));
        const minStart = starts.length > 0 ? Math.min(...starts) : null;
        const maxEnd = ends.length > 0 ? Math.max(...ends) : null;
        const timeText =
          minStart !== null && maxEnd !== null
            ? `${String(Math.floor(minStart / 60)).padStart(2, "0")}:${String(minStart % 60).padStart(2, "0")} - ${String(
                Math.floor(maxEnd / 60)
              ).padStart(2, "0")}:${String(maxEnd % 60).padStart(2, "0")}`
            : "";

        return {
          name,
          shiftText: shiftTypes.join(" / "),
          timeText,
          timelineShiftTypes: shiftTypes,
          isOff,
          hasAssignment: true
        };
      });

      rows.sort((a, b) => {
        if (a.hasAssignment !== b.hasAssignment) {
          return a.hasAssignment ? -1 : 1;
        }
        if (a.isOff !== b.isOff) {
          return a.isOff ? 1 : -1;
        }
        const aStart = a.timelineShiftTypes.length
          ? Math.min(...a.timelineShiftTypes.map((code) => timeToMinutes(shiftPatternByCode.get(code)?.startTime ?? "23:59")))
          : Number.MAX_SAFE_INTEGER;
        const bStart = b.timelineShiftTypes.length
          ? Math.min(...b.timelineShiftTypes.map((code) => timeToMinutes(shiftPatternByCode.get(code)?.startTime ?? "23:59")))
          : Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) {
          return aStart - bStart;
        }
        return a.name.localeCompare(b.name, "ja");
      });
      result.set(date, rows);
    }

    return result;
  }, [allStaffNames, assignedShiftTypesByDateAndStaff, dates, offByDateAndStaff, shiftPatternByCode]);

  const dailyCoverageByDate = useMemo(() => {
    const result = new Map<string, Map<string, { required: number | null; assigned: number }>>();
    for (const date of dates) {
      const requiredByTime = new Map<string, number>();
      REQUIRED_STAFF_TIMES.forEach((time, index) => {
        const requiredCounts = effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0);
        requiredByTime.set(time, requiredCounts[index] ?? 0);
      });

      const coverageByTime = new Map<string, { required: number | null; assigned: number }>();
      for (const time of dailyTimelineTimes) {
        const targetMinutes = timeToMinutes(time);
        const presentStaff = new Set<string>();
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const column of shiftColumns) {
            const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
            if (!staffName) {
              continue;
            }
            const pattern = shiftPatternByCode.get(column.shiftType);
            if (!pattern) {
              continue;
            }
            const startMinutes = timeToMinutes(pattern.startTime);
            const endMinutes = timeToMinutes(pattern.endTime);
            if (targetMinutes >= startMinutes && targetMinutes < endMinutes) {
              presentStaff.add(staffName);
            }
          }
        }
        coverageByTime.set(time, {
          required: requiredByTime.has(time) ? requiredByTime.get(time) ?? 0 : null,
          assigned: presentStaff.size
        });
      }
      result.set(date, coverageByTime);
    }
    return result;
  }, [cells, dates, dailyTimelineTimes, effectiveRequiredStaffCountByDate, shiftColumns, shiftPatternByCode]);

  const loadMonth = useCallback(async () => {
    setLoadingData(true);
    try {
      const response = await fetch(`/api/shifts?month=${month}`);
      if (!response.ok) {
        throw new Error("シフト取得に失敗しました");
      }
      const data = (await response.json()) as ShiftMonthResponse;
      const nextCells: Record<string, string> = {};
      const nextOffByDateAndStaff: Record<string, boolean> = {};
      const loadedColumns: ShiftColumn[] = [];
      const firstColumnIdByShiftType = new Map<string, string>();

      if (Array.isArray(data.columns) && data.columns.length > 0) {
        data.columns.forEach((column) => {
          loadedColumns.push({ id: column.id, shiftType: column.shiftType });
          if (!firstColumnIdByShiftType.has(column.shiftType)) {
            firstColumnIdByShiftType.set(column.shiftType, column.id);
          }
        });
      } else {
        const loadedColumnKeySet = new Set<string>();
        for (const entry of data.entries) {
          if (entry.columnKey && !loadedColumnKeySet.has(entry.columnKey)) {
            loadedColumnKeySet.add(entry.columnKey);
            loadedColumns.push({ id: entry.columnKey, shiftType: entry.shiftType });
            if (!firstColumnIdByShiftType.has(entry.shiftType)) {
              firstColumnIdByShiftType.set(entry.shiftType, entry.columnKey);
            }
          }
        }
      }

      if (loadedColumns.length > 0) {
        setShiftColumns(loadedColumns);
      } else {
        const fallbackColumns = allShiftTypes.map((shiftType) => ({ id: createShiftColumnId(shiftType), shiftType }));
        setShiftColumns(fallbackColumns);
        fallbackColumns.forEach((column) => {
          if (!firstColumnIdByShiftType.has(column.shiftType)) {
            firstColumnIdByShiftType.set(column.shiftType, column.id);
          }
        });
      }

      for (const entry of data.entries) {
        if (entry.shiftType === "休み") {
          const staffName = entry.staffName.trim();
          if (staffName) {
            nextOffByDateAndStaff[`${entry.date}|${staffName}`] = true;
          }
          continue;
        }
        const classGroup = entry.classGroup ?? "0-1";
        const columnId = entry.columnKey ?? firstColumnIdByShiftType.get(entry.shiftType);
        if (!columnId) {
          continue;
        }
        nextCells[keyOf(entry.date, columnId, classGroup)] = entry.staffName;
      }
      setCells(nextCells);
      setOffByDateAndStaff(nextOffByDateAndStaff);
      const nextRequiredOverrideByTime: Record<string, number> = {};
      (data.requiredByTime ?? []).forEach((item) => {
        if (REQUIRED_STAFF_TIMES.includes(item.time as (typeof REQUIRED_STAFF_TIMES)[number]) && Number.isFinite(item.requiredCount) && item.requiredCount >= 0) {
          nextRequiredOverrideByTime[item.time] = item.requiredCount;
        }
      });
      const hasLegacyFullSnapshot = Object.keys(nextRequiredOverrideByTime).length >= REQUIRED_STAFF_TIMES.length;
      setRequiredOverrideByTime(hasLegacyFullSnapshot ? {} : nextRequiredOverrideByTime);
      const nextRequiredSaturdayOverrideByTime: Record<string, number> = {};
      (data.requiredByTimeSaturday ?? []).forEach((item) => {
        if (REQUIRED_STAFF_TIMES.includes(item.time as (typeof REQUIRED_STAFF_TIMES)[number]) && Number.isFinite(item.requiredCount) && item.requiredCount >= 0) {
          nextRequiredSaturdayOverrideByTime[item.time] = item.requiredCount;
        }
      });
      const hasLegacySaturdayFullSnapshot = Object.keys(nextRequiredSaturdayOverrideByTime).length >= REQUIRED_STAFF_TIMES.length;
      setRequiredSaturdayOverrideByTime(hasLegacySaturdayFullSnapshot ? {} : nextRequiredSaturdayOverrideByTime);
      const nextEventByDate: Record<string, string> = {};
      const nextNoteByDate: Record<string, string> = {};
      (data.dateMemos ?? []).forEach((item) => {
        nextEventByDate[item.date] = item.event;
        nextNoteByDate[item.date] = item.note;
      });
      setEventByDate(nextEventByDate);
      setNoteByDate(nextNoteByDate);
    } finally {
      setLoadingData(false);
    }
  }, [allShiftTypes, month]);

  const buildEntriesFromColumns = useCallback(
    (columns: ShiftColumn[]): ShiftEntry[] => {
      const entries: ShiftEntry[] = [];
      for (const date of dates) {
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const column of columns) {
            const staffName = (cells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
            if (staffName.length > 0) {
              entries.push({
                date,
                classGroup: classGroup.key,
                shiftType: column.shiftType,
                columnKey: column.id,
                staffName
              });
            }
          }
        }
      }
      for (const recordKey of Object.keys(offByDateAndStaff)) {
        if (!offByDateAndStaff[recordKey]) {
          continue;
        }
        const [date, staffName] = recordKey.split("|");
        if (!date || !staffName) {
          continue;
        }
        entries.push({
          date,
          shiftType: "休み",
          staffName
        });
      }
      return entries;
    },
    [cells, dates, offByDateAndStaff]
  );

  const buildRequiredByTimePayload = useCallback(() => {
    return REQUIRED_STAFF_TIMES.flatMap((time) => {
      const override = requiredOverrideByTime[time];
      if (!Number.isFinite(override)) {
        return [];
      }
      return [{ time, requiredCount: Math.max(0, override) }];
    });
  }, [requiredOverrideByTime]);

  const buildRequiredByTimeSaturdayPayload = useCallback(() => {
    return REQUIRED_STAFF_TIMES.flatMap((time) => {
      const override = requiredSaturdayOverrideByTime[time];
      if (!Number.isFinite(override)) {
        return [];
      }
      return [{ time, requiredCount: Math.max(0, override) }];
    });
  }, [requiredSaturdayOverrideByTime]);

  const buildDateMemosPayload = useCallback(() => {
    return dates
      .map((date) => ({
        date,
        event: (eventByDate[date] ?? "").trim(),
        note: (noteByDate[date] ?? "").trim()
      }))
      .filter((item) => item.event.length > 0 || item.note.length > 0);
  }, [dates, eventByDate, noteByDate]);

  const persistShiftColumns = useCallback(
    async (columns: ShiftColumn[]): Promise<void> => {
      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          entries: buildEntriesFromColumns(columns),
          columns,
          requiredByTime: buildRequiredByTimePayload(),
          requiredByTimeSaturday: buildRequiredByTimeSaturdayPayload(),
          dateMemos: buildDateMemosPayload()
        })
      });
      if (!response.ok) {
        throw new Error("列構成の保存に失敗しました");
      }
    },
    [buildDateMemosPayload, buildEntriesFromColumns, buildRequiredByTimePayload, buildRequiredByTimeSaturdayPayload, month]
  );

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  async function performSaveMonth(): Promise<void> {
    setSaving(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          entries: buildEntriesFromColumns(shiftColumns),
          columns: shiftColumns,
          requiredByTime: buildRequiredByTimePayload(),
          requiredByTimeSaturday: buildRequiredByTimeSaturdayPayload(),
          dateMemos: buildDateMemosPayload()
        })
      });
      if (!response.ok) {
        throw new Error("保存に失敗しました");
      }
      alert("保存しました");
    } catch (error) {
      alert(error instanceof Error ? error.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function saveMonth(): Promise<void> {
    if (shortageItems.length > 0) {
      setShowShortageModal(true);
      return;
    }
    await performSaveMonth();
  }

  useEffect(() => {
    void (async () => {
      setLoadingMasterData(true);
      try {
        const response = await fetch("/api/master-data");
        if (!response.ok) {
          throw new Error("マスターデータ取得に失敗しました");
        }
        const data = (await response.json()) as MasterData;
        setMasterData(data);
      } catch {
        setMasterData(null);
      } finally {
        setLoadingMasterData(false);
      }
    })();
  }, []);

  function ruleWarnings(date: string, shiftCode: string, staffName: string): string[] {
    const staff = partTimeByName.get(staffName.trim());
    if (!staff) {
      return [];
    }
    const warnings: string[] = [];
    const day = new Date(date).getDay();
    if (!staff.availableWeekdays.includes(day)) {
      warnings.push("出勤可能曜日外です");
    }
    if (staff.possibleShiftPatternCodes.length > 0 && !staff.possibleShiftPatternCodes.includes(shiftCode)) {
      warnings.push("可能シフトパターン外です");
    }
    const pattern = shiftPatternByCode.get(shiftCode);
    if (pattern) {
      const patternStart = timeToMinutes(pattern.startTime);
      const patternEnd = timeToMinutes(pattern.endTime);
      const availableStart = timeToMinutes(staff.availableStartTime);
      const availableEnd = timeToMinutes(staff.availableEndTime);
      if (patternStart < availableStart || patternEnd > availableEnd) {
        warnings.push("出勤可能時間外です");
      }
    }
    return warnings;
  }

  function canWorkOnShift(date: string, shiftType: string, staffName: string): boolean {
    const normalizedName = staffName.trim();
    if (!normalizedName) {
      return false;
    }

    const fullTime = fullTimeByName.get(normalizedName);
    if (fullTime) {
      return fullTime.possibleShiftPatternCodes.length === 0 || fullTime.possibleShiftPatternCodes.includes(shiftType);
    }

    const partTime = partTimeByName.get(normalizedName);
    if (!partTime) {
      return false;
    }

    const weekday = new Date(date).getDay();
    if (!partTime.availableWeekdays.includes(weekday)) {
      return false;
    }
    if (partTime.possibleShiftPatternCodes.length > 0 && !partTime.possibleShiftPatternCodes.includes(shiftType)) {
      return false;
    }
    const pattern = shiftPatternByCode.get(shiftType);
    if (!pattern) {
      return true;
    }
    const patternStart = timeToMinutes(pattern.startTime);
    const patternEnd = timeToMinutes(pattern.endTime);
    const availableStart = timeToMinutes(partTime.availableStartTime);
    const availableEnd = timeToMinutes(partTime.availableEndTime);
    return patternStart >= availableStart && patternEnd <= availableEnd;
  }

  function selectableStaffNames(date: string, shiftType: string, currentValue: string): string[] {
    const countByName = assignedStaffCountByDateAndName.get(date) ?? new Map<string, number>();
    const normalizedCurrentValue = currentValue.trim();
    return allStaffNames.filter((name) => {
      const offKey = `${date}|${name}`;
      const isOff = offByDateAndStaff[offKey] === true;
      if (isOff && name !== normalizedCurrentValue) {
        return false;
      }
      if (!canWorkOnShift(date, shiftType, name)) {
        return false;
      }
      const currentCount = countByName.get(name) ?? 0;
      const usedByOtherCell = name === normalizedCurrentValue ? currentCount - 1 : currentCount;
      return usedByOtherCell <= 0;
    });
  }

  function setStaffShiftForDate(date: string, staffName: string, nextShiftType: string): void {
    if (!sundayShiftInputEnabled && isSundayDate(date)) {
      return;
    }
    setCells((prev) => {
      const nextCells = { ...prev };
      let existingClassGroup: ShiftClassGroup = "0-1";
      let foundExisting = false;

      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const currentKey = keyOf(date, column.id, classGroup.key);
          if ((nextCells[currentKey] ?? "").trim() === staffName) {
            if (!foundExisting) {
              existingClassGroup = classGroup.key;
              foundExisting = true;
            }
            nextCells[currentKey] = "";
          }
        }
      }

      if (!nextShiftType) {
        return nextCells;
      }

      const targetColumn = shiftColumns.find((column) => column.shiftType === nextShiftType);
      if (!targetColumn) {
        return nextCells;
      }

      nextCells[keyOf(date, targetColumn.id, existingClassGroup)] = staffName;
      return nextCells;
    });
    setOffByDateAndStaff((prev) => {
      const key = `${date}|${staffName}`;
      const next = { ...prev };
      if (nextShiftType === "__OFF__") {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function resetRequiredStaffToCalculated(): void {
    setRequiredOverrideByTime({});
    setRequiredSaturdayOverrideByTime({});
  }

  function fillEmptyCellsWithOff(): void {
    if (allStaffNames.length === 0 || dates.length === 0) {
      showToast("対象データがありません");
      return;
    }

    const nextOffByDateAndStaff = { ...offByDateAndStaff };
    let filledCount = 0;

    for (const date of dates) {
      if (!sundayShiftInputEnabled && isSundayDate(date)) {
        continue;
      }
      const assignedByName = assignedStaffCountByDateAndName.get(date) ?? new Map<string, number>();
      for (const name of allStaffNames) {
        const recordKey = `${date}|${name}`;
        if (nextOffByDateAndStaff[recordKey]) {
          continue;
        }
        if ((assignedByName.get(name) ?? 0) > 0) {
          continue;
        }
        nextOffByDateAndStaff[recordKey] = true;
        filledCount += 1;
      }
    }

    if (filledCount === 0) {
      showToast("空きマスはありませんでした");
      return;
    }

    setOffByDateAndStaff(nextOffByDateAndStaff);
    showToast(`空きマス ${filledCount} 件を休みに設定しました`);
  }

  const compactClass = "text-[12px]";
  const compactHeadCellClass = "px-2 py-1.5";
  const compactBodyCellClass = "px-2 py-1.5";
  const compactSelectClass = "w-full rounded bg-white px-1.5 py-1 text-center text-xs outline-none focus:bg-orange-50";
  const sundayRowClass = "bg-gray-200/70";

  useEffect(() => {
    const updateTopScrollWidth = (): void => {
      const width = bottomScrollRef.current?.scrollWidth ?? 0;
      setTopScrollWidth(width);
    };

    updateTopScrollWidth();
    const observed = bottomScrollRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (observed && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateTopScrollWidth());
      resizeObserver.observe(observed);
    }
    window.addEventListener("resize", updateTopScrollWidth);
    return () => {
      window.removeEventListener("resize", updateTopScrollWidth);
      resizeObserver?.disconnect();
    };
  }, [viewMode, shiftColumns.length, allStaffNames.length, dates.length]);

  function handleTopScroll(): void {
    if (!topScrollRef.current || !bottomScrollRef.current) {
      return;
    }
    if (syncingScrollFrom.current === "bottom") {
      return;
    }
    syncingScrollFrom.current = "top";
    bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncingScrollFrom.current = null;
    });
  }

  function handleBottomScroll(): void {
    if (!topScrollRef.current || !bottomScrollRef.current) {
      return;
    }
    if (syncingScrollFrom.current === "top") {
      return;
    }
    syncingScrollFrom.current = "bottom";
    topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncingScrollFrom.current = null;
    });
  }

  function performDeleteShiftColumn(columnId: string): void {
    if (shiftColumns.length <= 1) {
      alert("最低1つはシフトヘッダーを残してください。");
      return;
    }
    const previousColumns = shiftColumns;
    const nextColumns = shiftColumns.filter((column) => column.id !== columnId);
    setShiftColumns(nextColumns);
    setHeaderMenuColumnId(null);
    void (async () => {
      try {
        await persistShiftColumns(nextColumns);
      } catch (error) {
        setShiftColumns(previousColumns);
        alert(error instanceof Error ? error.message : "列構成の保存に失敗しました");
      }
    })();
  }

  function handleDeleteShiftColumn(columnId: string): void {
    setDeleteTargetColumnId(columnId);
    setHeaderMenuColumnId(null);
  }

  function confirmDeleteShiftColumn(): void {
    if (!deleteTargetColumnId) {
      return;
    }
    const target = deleteTargetColumnId;
    setDeleteTargetColumnId(null);
    performDeleteShiftColumn(target);
  }

  function handleAddShiftTypeRight(baseColumnId: string, nextType: string): void {
    if (!nextType) {
      alert("追加するシフトパターンを選択してください。");
      return;
    }
    const baseIndex = shiftColumns.findIndex((column) => column.id === baseColumnId);
    if (baseIndex < 0) {
      return;
    }
    const previousColumns = shiftColumns;
    const nextColumns = [...shiftColumns];
    nextColumns.splice(baseIndex + 1, 0, { id: createShiftColumnId(nextType), shiftType: nextType });
    setShiftColumns(nextColumns);
    setHeaderMenuColumnId(null);
    setAddColumnBaseColumnId(null);
    setAddColumnShiftType("");
    void (async () => {
      try {
        await persistShiftColumns(nextColumns);
      } catch (error) {
        setShiftColumns(previousColumns);
        alert(error instanceof Error ? error.message : "列構成の保存に失敗しました");
      }
    })();
  }

  function openAddColumnModal(baseColumnId: string): void {
    if (allShiftTypes.length === 0) {
      alert("追加できるシフトパターンがありません。");
      return;
    }
    setAddColumnBaseColumnId(baseColumnId);
    setAddColumnShiftType(allShiftTypes[0]);
    setHeaderMenuColumnId(null);
  }

  useEffect(() => {
    if (!headerMenuColumnId) {
      return;
    }
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('[data-header-menu="true"]') || target.closest('[data-header-trigger="true"]')) {
        return;
      }
      setHeaderMenuColumnId(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [headerMenuColumnId]);

  useEffect(() => {
    if (plannerStep === 3 && viewMode !== "staff") {
      setViewMode("staff");
    }
  }, [plannerStep, viewMode]);

  const stepDefinitions = [
    { id: 1 as PlannerStep, title: "ルール確認" },
    { id: 2 as PlannerStep, title: "対象月の選択" },
    { id: 3 as PlannerStep, title: "休み入力（先生別）" },
    { id: 4 as PlannerStep, title: "イベント入力" },
    { id: 5 as PlannerStep, title: "補足事項入力" },
    { id: 6 as PlannerStep, title: "自動作成" }
  ];

  function stepCompleted(step: PlannerStep): boolean {
    if (step === 1) {
      return ruleConfirmed;
    }
    if (step === 2) {
      return monthConfirmed;
    }
    if (step === 3) {
      return offInputConfirmed;
    }
    if (step === 4) {
      return eventInputConfirmed;
    }
    if (step === 5) {
      return supplementNote.trim().length > 0 || plannerStep === 6;
    }
    return false;
  }

  function currentStepCanProceed(): boolean {
    if (plannerStep === 2) {
      return month.trim().length > 0;
    }
    return plannerStep >= 1 && plannerStep <= 6;
  }

  function nextStep(): void {
    if (plannerStep === 6) {
      return;
    }
    if (!currentStepCanProceed()) {
      const message = plannerStep === 2 ? "対象月を選択してください。" : "次へ進むための条件を確認してください。";
      alert(message);
      return;
    }
    if (plannerStep === 1) {
      setRuleConfirmed(true);
      setPlannerStep(2);
      return;
    }
    if (plannerStep === 2) {
      setMonthConfirmed(true);
      setPlannerStep(3);
      return;
    }
    if (plannerStep === 3) {
      setOffInputConfirmed(true);
      setPlannerStep(4);
      return;
    }
    if (plannerStep === 4) {
      setEventInputConfirmed(true);
      setPlannerStep(5);
      return;
    }
    if (plannerStep === 5) {
      setPlannerStep(6);
    }
  }

  function prevStep(): void {
    if (plannerStep === 6) {
      setPlannerStep(5);
      return;
    }
    if (plannerStep === 5) {
      setPlannerStep(4);
      return;
    }
    if (plannerStep === 4) {
      setPlannerStep(3);
      return;
    }
    if (plannerStep === 3) {
      setPlannerStep(2);
      return;
    }
    if (plannerStep === 2) {
      setPlannerStep(1);
    }
  }

  function handleMonthChange(value: string): void {
    setMonth(value);
    setMonthConfirmed(false);
    setOffInputConfirmed(false);
    setEventInputConfirmed(false);
    setSupplementNote("");
    setAutoGenerateError("");
    setAutoGenerateLogs([]);
    setAiShortageSuggestions([]);
    setAiCompensatorySuggestions([]);
    setAiLogSummary("");
    setAiSummaryBullets([]);
    setAiSupplementGuidance("");
    setAiNaturalLanguageInstruction("");
    setAiNaturalLanguageResult("");
    setPlannerStep((prev) => (prev <= 2 ? prev : 2));
  }

  function weekDatesForSaturday(date: string): string[] {
    const target = new Date(`${date}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      return [];
    }
    const day = target.getDay();
    const mondayDiff = day === 0 ? -6 : 1 - day;
    const monday = new Date(target);
    monday.setDate(target.getDate() + mondayDiff);
    return Array.from({ length: 6 }, (_, index) => {
      const current = new Date(monday);
      current.setDate(monday.getDate() + index);
      if (current.getMonth() !== target.getMonth()) {
        return "";
      }
      return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    }).filter((item) => item.length > 0);
  }

  function removeStaffAssignmentFromDate(
    sourceCells: Record<string, string>,
    date: string,
    staffName: string
  ): { nextCells: Record<string, string>; removed: boolean; removedShiftTypes: string[] } {
    const nextCells = { ...sourceCells };
    let removed = false;
    const removedShiftTypes: string[] = [];
    for (const classGroup of SHIFT_CLASS_GROUPS) {
      for (const column of shiftColumns) {
        const cellKey = keyOf(date, column.id, classGroup.key);
        if ((nextCells[cellKey] ?? "").trim() === staffName) {
          delete nextCells[cellKey];
          removed = true;
          removedShiftTypes.push(column.shiftType);
        }
      }
    }
    return { nextCells, removed, removedShiftTypes };
  }

  function replaceStaffAssignmentForDate(
    sourceCells: Record<string, string>,
    date: string,
    fromStaffName: string,
    toStaffName: string
  ): { nextCells: Record<string, string>; replaced: boolean; replacedShiftTypes: string[] } {
    const nextCells = { ...sourceCells };
    let replaced = false;
    const replacedShiftTypes: string[] = [];
    for (const classGroup of SHIFT_CLASS_GROUPS) {
      for (const column of shiftColumns) {
        const cellKey = keyOf(date, column.id, classGroup.key);
        if ((nextCells[cellKey] ?? "").trim() === fromStaffName) {
          nextCells[cellKey] = toStaffName;
          replaced = true;
          replacedShiftTypes.push(column.shiftType);
        }
      }
    }
    return { nextCells, replaced, replacedShiftTypes };
  }

  function assignedCountByTimeForDate(sourceCells: Record<string, string>, date: string): number[] {
    return REQUIRED_STAFF_TIMES.map((time) => {
      const targetMinutes = timeToMinutes(time);
      const presentStaff = new Set<string>();
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const staffName = (sourceCells[keyOf(date, column.id, classGroup.key)] ?? "").trim();
          if (!staffName) {
            continue;
          }
          const pattern = shiftPatternByCode.get(column.shiftType);
          if (!pattern) {
            continue;
          }
          const startMinutes = timeToMinutes(pattern.startTime);
          const endMinutes = timeToMinutes(pattern.endTime);
          if (targetMinutes >= startMinutes && targetMinutes < endMinutes) {
            presentStaff.add(staffName);
          }
        }
      }
      return presentStaff.size;
    });
  }

  function shortageItemsForCells(sourceCells: Record<string, string>): ShortageItem[] {
    const items: ShortageItem[] = [];
    for (const date of dates) {
      if (activeAutoGenerationPolicy.skipSundayProcessing && isSundayDate(date)) {
        continue;
      }
      const assignedCounts = assignedCountByTimeForDate(sourceCells, date);
      const requiredCounts = effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0);
      requiredCounts.forEach((requiredCount, index) => {
        const assigned = assignedCounts[index] ?? 0;
        if (assigned < requiredCount) {
          items.push({
            date,
            time: REQUIRED_STAFF_TIMES[index],
            required: requiredCount,
            assigned
          });
        }
      });
    }
    return items;
  }

  async function callShiftAi<T>(action: string, payload: unknown): Promise<T | null> {
    try {
      const response = await fetch("/api/shift-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload })
      });
      const data = (await response.json()) as { error?: string; result?: T };
      if (!response.ok || !data.result) {
        if (data.error) {
          setAutoGenerateError(data.error);
        }
        return null;
      }
      return data.result;
    } catch (error) {
      setAutoGenerateError(error instanceof Error ? error.message : "AI処理に失敗しました。");
      return null;
    }
  }

  function sanitizeAiShortageSuggestions(input: AiShortageSuggestion[]): AiShortageSuggestion[] {
    const staffSet = new Set(allStaffNames);
    const dateSet = new Set(dates);
    const shiftTypeSet = new Set(allShiftTypes);
    const seen = new Set<string>();
    const result: AiShortageSuggestion[] = [];
    for (const item of input) {
      const date = item.date?.trim();
      const time = item.time?.trim();
      const staffName = item.staffName?.trim();
      const shiftType = item.shiftType?.trim();
      const reason = item.reason?.trim() || "AI提案";
      if (!dateSet.has(date) || !staffSet.has(staffName) || !shiftTypeSet.has(shiftType)) {
        continue;
      }
      if (!/^\d{2}:\d{2}$/.test(time)) {
        continue;
      }
      if (!canWorkOnShift(date, shiftType, staffName)) {
        continue;
      }
      const key = `${date}|${time}|${staffName}|${shiftType}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ date, time, staffName, shiftType, reason });
    }
    return result;
  }

  function sanitizeAiCompensatorySuggestions(input: AiCompensatorySuggestion[]): AiCompensatorySuggestion[] {
    const staffSet = new Set(allStaffNames);
    const dateSet = new Set(dates);
    const seen = new Set<string>();
    const result: AiCompensatorySuggestion[] = [];
    for (const item of input) {
      const staffName = item.staffName?.trim();
      const saturdayDate = item.saturdayDate?.trim();
      const candidateDate = item.candidateDate?.trim();
      const reason = item.reason?.trim() || "AI提案";
      if (!staffSet.has(staffName) || !dateSet.has(saturdayDate) || !dateSet.has(candidateDate)) {
        continue;
      }
      if (!isSaturdayDate(saturdayDate)) {
        continue;
      }
      const candidateWeekday = new Date(`${candidateDate}T00:00:00`).getDay();
      if (candidateWeekday < 1 || candidateWeekday > 5) {
        continue;
      }
      if (!weekDatesForSaturday(saturdayDate).includes(candidateDate)) {
        continue;
      }
      const key = `${staffName}|${saturdayDate}|${candidateDate}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ staffName, saturdayDate, candidateDate, reason });
    }
    return result;
  }

  function sanitizeSupplementGuidance(text: string): { displayText: string; aiUsableText: string } {
    const trimmed = text.trim();
    if (!trimmed) {
      return { displayText: "", aiUsableText: "" };
    }
    const hardConstraintLike = ["全員", "必ず", "絶対", "強制"];
    if (hardConstraintLike.some((token) => trimmed.includes(token))) {
      return {
        displayText: `${trimmed}（補足解釈は提案扱い。最終判断は既存ルールを優先）`,
        aiUsableText: ""
      };
    }
    return { displayText: trimmed, aiUsableText: trimmed };
  }

  function applyAiOperations(operations: AiNaturalLanguageOperation[]): { applied: number; skipped: string[] } {
    const nextCells = { ...cells };
    const nextOffByDateAndStaff = { ...offByDateAndStaff };
    const skipped: string[] = [];
    let applied = 0;
    const validDates = new Set(dates);

    const removeStaffFromDate = (date: string, staffName: string): void => {
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const cellKey = keyOf(date, column.id, classGroup.key);
          if ((nextCells[cellKey] ?? "").trim() === staffName) {
            delete nextCells[cellKey];
          }
        }
      }
    };

    const staffAlreadyAssignedOnDate = (date: string, staffName: string): boolean => {
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of shiftColumns) {
          const cellKey = keyOf(date, column.id, classGroup.key);
          if ((nextCells[cellKey] ?? "").trim() === staffName) {
            return true;
          }
        }
      }
      return false;
    };

    const assignStaffToShift = (date: string, staffName: string, shiftType: string): boolean => {
      const targetColumns = shiftColumns.filter((column) => column.shiftType === shiftType);
      if (targetColumns.length === 0) {
        return false;
      }
      for (const classGroup of SHIFT_CLASS_GROUPS) {
        for (const column of targetColumns) {
          const cellKey = keyOf(date, column.id, classGroup.key);
          const existing = (nextCells[cellKey] ?? "").trim();
          if (!existing) {
            nextCells[cellKey] = staffName;
            return true;
          }
        }
      }
      return false;
    };

    operations.forEach((operation) => {
      const staffName = operation.staffName?.trim();
      if (!staffName || !validDates.has(operation.date)) {
        skipped.push(`不正な操作をスキップ: ${operation.type}`);
        return;
      }
      if (!allStaffNames.includes(staffName)) {
        skipped.push(`${staffName}: 職員名が見つからないためスキップ`);
        return;
      }

      if (operation.type === "setOff") {
        const enabled = operation.enabled !== false;
        nextOffByDateAndStaff[`${operation.date}|${staffName}`] = enabled;
        if (enabled) {
          removeStaffFromDate(operation.date, staffName);
        }
        applied += 1;
        return;
      }

      if (operation.type === "clearShift") {
        removeStaffFromDate(operation.date, staffName);
        applied += 1;
        return;
      }

      if (operation.type === "assignShift") {
        const shiftType = operation.shiftType?.trim();
        if (!shiftType) {
          skipped.push(`${staffName}: shiftType が空のためスキップ`);
          return;
        }
        if (nextOffByDateAndStaff[`${operation.date}|${staffName}`]) {
          skipped.push(`${staffName}: 休み設定のため配置できません`);
          return;
        }
        if (!canWorkOnShift(operation.date, shiftType, staffName)) {
          skipped.push(`${staffName}: ${operation.date} ${shiftType} は勤務条件外`);
          return;
        }
        if (staffAlreadyAssignedOnDate(operation.date, staffName)) {
          removeStaffFromDate(operation.date, staffName);
        }
        if (!assignStaffToShift(operation.date, staffName, shiftType)) {
          skipped.push(`${operation.date} ${shiftType}: 空き枠がなく配置できません`);
          return;
        }
        applied += 1;
      }
    });

    if (applied > 0) {
      setCells(nextCells);
      setOffByDateAndStaff(nextOffByDateAndStaff);
    }
    return { applied, skipped };
  }

  async function handleAiNaturalLanguageEdit(): Promise<void> {
    const instruction = aiNaturalLanguageInstruction.trim();
    if (!instruction || !masterData) {
      return;
    }
    setAiActionRunning(true);
    setAiNaturalLanguageResult("");
    try {
      const assignments = Object.entries(cells)
        .map(([cellKey, staffName]) => ({ cellKey, staffName: staffName.trim() }))
        .filter((item) => item.staffName.length > 0)
        .map((item) => {
          const [date, classGroup, columnId] = item.cellKey.split("|");
          const column = shiftColumns.find((entry) => entry.id === columnId);
          return {
            date,
            classGroup,
            shiftType: column?.shiftType ?? "",
            staffName: item.staffName
          };
        })
        .filter((item) => item.date && item.shiftType);
      const offRecords = Object.entries(offByDateAndStaff)
        .filter(([, enabled]) => enabled)
        .map(([key]) => {
          const [date, staffName] = key.split("|");
          return { date, staffName };
        });
      const staffProfiles = [
        ...masterData.fullTimeStaff.map((item) => ({
          name: item.name,
          kind: "full-time",
          possibleShiftPatternCodes: item.possibleShiftPatternCodes
        })),
        ...masterData.partTimeStaff.map((item) => ({
          name: item.name,
          kind: "part-time",
          possibleShiftPatternCodes: item.possibleShiftPatternCodes,
          availableWeekdays: item.availableWeekdays,
          availableStartTime: item.availableStartTime,
          availableEndTime: item.availableEndTime
        }))
      ];

      const result = await callShiftAi<{ operations?: AiNaturalLanguageOperation[]; summary?: string }>("naturalLanguageEdit", {
        month,
        instruction,
        availableShiftTypes: allShiftTypes,
        assignments,
        offRecords,
        staffProfiles
      });
      const operations = result?.operations ?? [];
      if (operations.length === 0) {
        setAiNaturalLanguageResult("変更提案が見つかりませんでした。");
        return;
      }
      const applyResult = applyAiOperations(operations);
      const skipText = applyResult.skipped.length > 0 ? ` / スキップ: ${applyResult.skipped.slice(0, 3).join("、")}` : "";
      setAiNaturalLanguageResult(
        `${result?.summary ?? "AI提案を適用しました。"}（適用 ${applyResult.applied} 件${skipText}）`
      );
      if (applyResult.applied > 0) {
        showToast(`AI提案を ${applyResult.applied} 件反映しました`);
      }
    } finally {
      setAiActionRunning(false);
    }
  }

  function applyAiShortageSuggestion(item: AiShortageSuggestion): void {
    const result = applyAiOperations([
      {
        type: "assignShift",
        date: item.date,
        staffName: item.staffName,
        shiftType: item.shiftType,
        reason: item.reason
      }
    ]);
    if (result.applied > 0) {
      showToast(`提案を反映: ${item.date} ${item.staffName} ${item.shiftType}`);
    } else {
      alert(result.skipped[0] ?? "提案を反映できませんでした。");
    }
  }

  async function handleInterpretSupplementNote(): Promise<void> {
    const note = supplementNote.trim();
    if (!note) {
      return;
    }
    setAiActionRunning(true);
    try {
      const result = await callShiftAi<{ guidance?: string; priorityRules?: string[] }>("interpretSupplementNote", {
        month,
        supplementNote: note
      });
      const guidance = result?.guidance?.trim() ?? "";
      const normalized = sanitizeSupplementGuidance(guidance);
      const rules = (result?.priorityRules ?? []).filter((item) => item.trim().length > 0);
      if (normalized.displayText) {
        setAiSupplementGuidance(normalized.displayText);
      }
      if (rules.length > 0) {
        setAiSummaryBullets(rules.slice(0, 5));
      }
    } finally {
      setAiActionRunning(false);
    }
  }

  async function handleAutoGenerateDraft(): Promise<void> {
    if (autoGenerateRunningRef.current) {
      return;
    }
    if (!(monthConfirmed && offInputConfirmed && eventInputConfirmed && ruleConfirmed)) {
      setAutoGenerateError("Step1〜4を完了してから自動作成へ進んでください。");
      return;
    }
    if (!masterData) {
      setAutoGenerateError("マスターデータが未取得のため自動作成できません。");
      return;
    }
    setAutoGenerateError("");
    setAutoGenerateLogsExpanded(false);
    setAiShortageSuggestions([]);
    setAiCompensatorySuggestions([]);
    setAiLogSummary("");
    setAiSummaryBullets([]);
    setAiSupplementGuidance("");
    autoGenerateRunningRef.current = true;
    setAutoGenerating(true);
    // Ensure loading state is painted before heavy synchronous work starts.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    const executionLogs: AutoGenerateLogItem[] = [];
    let logSequence = 0;
    const nowText = (): string =>
      new Date().toLocaleTimeString("ja-JP", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    const appendLog = (level: AutoGenerateLogLevel, step: string, message: string): void => {
      logSequence += 1;
      executionLogs.push({
        id: `log-${Date.now()}-${logSequence}`,
        sequence: logSequence,
        time: nowText(),
        level,
        step,
        message
      });
    };

    try {
      const rules: ShiftRules = masterData.shiftRules ?? createDefaultShiftRules();
      const skipSundayProcessing = rules.autoGenerationPolicy.skipSundayProcessing;
      const preventFixedFullTimeShift = rules.autoGenerationPolicy.preventFixedFullTimeShift;
      const useAiAssistance = rules.autoGenerationPolicy.useAi;
      const orderedRuleSteps = [...rules.creationOrder].sort((a, b) => a.order - b.order).map((item) => item.title);
      const titleAt = (index: number, fallback: string): string => orderedRuleSteps[index] ?? fallback;
      let supplementGuidance = "";
      let supplementGuidanceForAi = "";
      if (useAiAssistance && supplementNote.trim().length > 0) {
        const guidanceResult = await callShiftAi<{ guidance?: string; priorityRules?: string[] }>("interpretSupplementNote", {
          month,
          supplementNote: supplementNote.trim(),
          creationOrder: orderedRuleSteps
        });
        const normalizedGuidance = sanitizeSupplementGuidance(guidanceResult?.guidance?.trim() ?? "");
        supplementGuidance = normalizedGuidance.displayText;
        supplementGuidanceForAi = normalizedGuidance.aiUsableText;
        if (supplementGuidance) {
          setAiSupplementGuidance(supplementGuidance);
          appendLog("info", "rules", `AI補足解釈: ${supplementGuidance}`);
          if (!supplementGuidanceForAi) {
            appendLog("warn", "rules", "補足解釈が強すぎるため、AI再ランキングには反映しません。");
          }
        }
      }

      let nextCells: Record<string, string> = {};
      const nextOffByDateAndStaff = { ...offByDateAndStaff };
      const snapshots: AutoGenerationSnapshot[] = [];
      const pushSnapshot = (id: string, label: string, note: string): void => {
        snapshots.push({
          id,
          label,
          note,
          cells: { ...nextCells },
          offByDateAndStaff: { ...nextOffByDateAndStaff },
          logs: [...executionLogs]
        });
      };
      const publishSnapshots = (preferredSnapshotId?: string): void => {
        if (snapshots.length > 0) {
          const targetIndex = preferredSnapshotId
            ? Math.max(
                0,
                snapshots.findIndex((snapshot) => snapshot.id === preferredSnapshotId)
              )
            : 0;
          const target = snapshots[targetIndex] ?? snapshots[0];
          setCells(target.cells);
          setOffByDateAndStaff(target.offByDateAndStaff);
          setAutoGenerateLogs(target.logs);
          setViewMode("staff");
        }
      };
      const fullTimeNames = masterData.fullTimeStaff.map((item) => item.name.trim()).filter((item) => item.length > 0);
      const partStaff = masterData.partTimeStaff
        .map((item) => ({ ...item, normalizedName: item.name.trim() }))
        .filter((item) => item.normalizedName.length > 0);
      const partTimeNames = partStaff.map((item) => item.normalizedName);
      const staffPool = Array.from(new Set([...fullTimeNames, ...partTimeNames]));
      const fullTimeSet = new Set(fullTimeNames);
      const partByName = new Map(partStaff.map((item) => [item.normalizedName, item]));
      const fullTimeShiftUsageByName = new Map<string, Map<string, number>>(
        fullTimeNames.map((name) => [name, new Map<string, number>()])
      );
      const getFullTimeShiftUsageCount = (staffName: string, shiftType: string): number => {
        return fullTimeShiftUsageByName.get(staffName)?.get(shiftType) ?? 0;
      };
      const incrementFullTimeShiftUsage = (staffName: string, shiftType: string): void => {
        if (!fullTimeSet.has(staffName)) {
          return;
        }
        const staffMap = fullTimeShiftUsageByName.get(staffName);
        if (!staffMap) {
          return;
        }
        staffMap.set(shiftType, (staffMap.get(shiftType) ?? 0) + 1);
      };
      const decrementFullTimeShiftUsage = (staffName: string, shiftType: string): void => {
        if (!fullTimeSet.has(staffName)) {
          return;
        }
        const staffMap = fullTimeShiftUsageByName.get(staffName);
        if (!staffMap) {
          return;
        }
        const current = staffMap.get(shiftType) ?? 0;
        if (current <= 1) {
          staffMap.delete(shiftType);
          return;
        }
        staffMap.set(shiftType, current - 1);
      };

      const assignmentCountByStaff = new Map(staffPool.map((name) => [name, 0]));
      const saturdayAssignmentCountByStaff = new Map(staffPool.map((name) => [name, 0]));
      const assignedByDate = new Map<string, Set<string>>(dates.map((date) => [date, new Set<string>()]));
      const slotCapacityPerDate = shiftColumns.length * SHIFT_CLASS_GROUPS.length;
      const requiredPeak = Math.max(
        3,
        ...dates.map((date) => Math.max(...(effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0))))
      );
      const targetByDate = new Map<string, number>();
      const remainingByDate = new Map<string, number>();
      const overflowRemainingByDate = new Map<string, number>();
      const compensatoryQuotaByDate = new Map<string, number>();

      let createdCount = 0;
      let saturdayAssignedCount = 0;
      let substituteHolidayCount = 0;
      let unassignedSlotCount = 0;
      let saturdayViolationCount = 0;
      const unresolvedCompensatoryRequests: Array<{ saturdayDate: string; staffNames: string[] }> = [];

      appendLog("info", "start", `自動作成を開始: 対象月 ${month}`);
      appendLog(
        "info",
        "rules",
        `登録順番: ${orderedRuleSteps.map((title, index) => `(${index + 1})${title}`).join(" -> ")}`
      );
      appendLog(
        "info",
        "rules",
        `必要人数目安=${requiredPeak}人/日, 土曜必要人数=${rules.saturdayRequirement.minTotalStaff}, 振替休日(同週)=${
          rules.compensatoryHoliday.sameWeekRequired ? "有効" : "無効"
        }, 日曜除外=${skipSundayProcessing ? "有効" : "無効"}, 常勤固定シフト回避=${
          preventFixedFullTimeShift ? "有効" : "無効"
        }`
      );
      if (supplementNote.trim().length > 0) {
        appendLog("info", "rules", `補足事項: ${supplementNote.trim()}`);
      }

      const shiftTypesByStart = shiftColumns
        .map((column) => ({
          shiftType: column.shiftType,
          minutes: timeToMinutes(shiftPatternByCode.get(column.shiftType)?.startTime ?? "23:59")
        }))
        .sort((a, b) => a.minutes - b.minutes)
        .map((item) => item.shiftType);

      const earlyShift = shiftTypesByStart[0] ?? shiftColumns[0]?.shiftType ?? "";
      const lateShift = shiftTypesByStart[shiftTypesByStart.length - 1] ?? shiftColumns[0]?.shiftType ?? "";
      const middleShift = shiftTypesByStart[Math.floor(shiftTypesByStart.length / 2)] ?? earlyShift;
      const shiftStartOrder = new Map(shiftTypesByStart.map((shiftType, index) => [shiftType, index]));
      const sortedShiftColumns = [...shiftColumns].sort((a, b) => {
        const aIndex = shiftStartOrder.get(a.shiftType) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = shiftStartOrder.get(b.shiftType) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        return a.id.localeCompare(b.id, "ja");
      });
      const baseDateIndexByDate = new Map(dates.map((date, index) => [date, index]));
      const weekKeyByDate = new Map<string, string>();
      const weekDatesByKey = new Map<string, string[]>();
      for (const date of dates) {
        const target = new Date(`${date}T00:00:00`);
        if (Number.isNaN(target.getTime())) {
          continue;
        }
        const day = target.getDay();
        const mondayDiff = day === 0 ? -6 : 1 - day;
        const monday = new Date(target);
        monday.setDate(target.getDate() + mondayDiff);
        const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
        weekKeyByDate.set(date, weekKey);
        const currentDates = weekDatesByKey.get(weekKey) ?? [];
        currentDates.push(date);
        weekDatesByKey.set(weekKey, currentDates);
      }
      for (const [weekKey, weekDates] of weekDatesByKey.entries()) {
        weekDatesByKey.set(weekKey, [...weekDates].sort((a, b) => a.localeCompare(b)));
      }
      const fullTimeWeeklyAssignedByName = new Map<string, Map<string, number>>(
        fullTimeNames.map((name) => [name, new Map<string, number>()])
      );
      const fullTimeWeeklyTargetByName = new Map<string, Map<string, number>>(
        fullTimeNames.map((name) => [
          name,
          new Map(
            Array.from(weekDatesByKey.entries()).map(([weekKey, weekDates]) => {
              const availableDays = weekDates.filter((candidateDate) => {
                if (skipSundayProcessing && isSundayDate(candidateDate)) {
                  return false;
                }
                if (nextOffByDateAndStaff[`${candidateDate}|${name}`]) {
                  return false;
                }
                return shiftColumns.some((column) => canWorkOnShift(candidateDate, column.shiftType, name));
              }).length;
              return [weekKey, Math.min(5, availableDays)];
            })
          )
        ])
      );
      const fullTimeWeekKeyForDate = (date: string): string => weekKeyByDate.get(date) ?? "";
      const getFullTimeWeeklyAssignedCount = (staffName: string, date: string): number => {
        const weekKey = fullTimeWeekKeyForDate(date);
        if (!weekKey) {
          return 0;
        }
        return fullTimeWeeklyAssignedByName.get(staffName)?.get(weekKey) ?? 0;
      };
      const getFullTimeWeeklyTargetCount = (staffName: string, date: string): number => {
        const weekKey = fullTimeWeekKeyForDate(date);
        if (!weekKey) {
          return 0;
        }
        return fullTimeWeeklyTargetByName.get(staffName)?.get(weekKey) ?? 0;
      };
      const fullTimeWeeklyDeficit = (staffName: string, date: string): number => {
        if (!fullTimeSet.has(staffName)) {
          return 0;
        }
        const target = getFullTimeWeeklyTargetCount(staffName, date);
        const assigned = getFullTimeWeeklyAssignedCount(staffName, date);
        return Math.max(0, target - assigned);
      };
      const hasRemainingFullTimeWeeklyQuota = (staffName: string, date: string): boolean => {
        if (!fullTimeSet.has(staffName)) {
          return true;
        }
        const target = getFullTimeWeeklyTargetCount(staffName, date);
        if (target <= 0) {
          return false;
        }
        return getFullTimeWeeklyAssignedCount(staffName, date) < target;
      };
      const incrementFullTimeWeeklyAssignment = (staffName: string, date: string): void => {
        if (!fullTimeSet.has(staffName)) {
          return;
        }
        const weekKey = fullTimeWeekKeyForDate(date);
        if (!weekKey) {
          return;
        }
        const staffWeeklyMap = fullTimeWeeklyAssignedByName.get(staffName);
        if (!staffWeeklyMap) {
          return;
        }
        staffWeeklyMap.set(weekKey, (staffWeeklyMap.get(weekKey) ?? 0) + 1);
      };
      const decrementFullTimeWeeklyAssignment = (staffName: string, date: string): void => {
        if (!fullTimeSet.has(staffName)) {
          return;
        }
        const weekKey = fullTimeWeekKeyForDate(date);
        if (!weekKey) {
          return;
        }
        const staffWeeklyMap = fullTimeWeeklyAssignedByName.get(staffName);
        if (!staffWeeklyMap) {
          return;
        }
        const current = staffWeeklyMap.get(weekKey) ?? 0;
        if (current <= 1) {
          staffWeeklyMap.delete(weekKey);
          return;
        }
        staffWeeklyMap.set(weekKey, current - 1);
      };
      const orderedCandidatesByDate = (candidates: string[]): string[] => {
        return [...candidates];
      };
      const aiRerankCache = new Map<string, string[]>();
      let aiRerankCalls = 0;
      const maxAiRerankCalls = 24;
      const shiftTypeCoversTime = (shiftType: string, time: string): boolean => {
        const pattern = shiftPatternByCode.get(shiftType);
        if (!pattern) {
          return false;
        }
        const targetMinutes = timeToMinutes(time);
        const startMinutes = timeToMinutes(pattern.startTime);
        const endMinutes = timeToMinutes(pattern.endTime);
        return targetMinutes >= startMinutes && targetMinutes < endMinutes;
      };
      const findAssignableSlot = (
        date: string,
        staffName: string,
        preferredShiftType?: string,
        requiredTime?: string
      ): { classGroup: ShiftClassGroup; column: ShiftColumn } | null => {
        const columnsByRequiredTime = requiredTime
          ? sortedShiftColumns.filter((column) => shiftTypeCoversTime(column.shiftType, requiredTime))
          : sortedShiftColumns;
        const preferredColumns = preferredShiftType
          ? columnsByRequiredTime.filter((column) => column.shiftType === preferredShiftType)
          : [];
        const fallbackColumns = columnsByRequiredTime.filter((column) => !preferredColumns.some((item) => item.id === column.id));
        const orderedColumns = [...preferredColumns, ...fallbackColumns];
        if (orderedColumns.length === 0) {
          return null;
        }
        const requiredByTime = effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0);
        const currentCounts = assignedCountByTimeForDate(nextCells, date);
        const shortages = requiredByTime.map((required, index) => Math.max(0, required - (currentCounts[index] ?? 0)));
        const scoreForShiftType = (shiftType: string): number => {
          const pattern = shiftPatternByCode.get(shiftType);
          if (!pattern) {
            return 0;
          }
          const startMinutes = timeToMinutes(pattern.startTime);
          const endMinutes = timeToMinutes(pattern.endTime);
          let score = 0;
          REQUIRED_STAFF_TIMES.forEach((time, index) => {
            const targetMinutes = timeToMinutes(time);
            if (targetMinutes >= startMinutes && targetMinutes < endMinutes) {
              score += shortages[index] ?? 0;
            }
          });
          return score;
        };

        let best:
          | { classGroup: ShiftClassGroup; column: ShiftColumn; score: number; bonus: number; usage: number }
          | null = null;
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const column of orderedColumns) {
            const cellKey = keyOf(date, column.id, classGroup.key);
            if ((nextCells[cellKey] ?? "").trim().length > 0) {
              continue;
            }
            if (!canWorkOnShift(date, column.shiftType, staffName)) {
              continue;
            }
            const baseScore = scoreForShiftType(column.shiftType);
            const bonus = preferredShiftType && column.shiftType === preferredShiftType ? 1 : 0;
            const usage =
              preventFixedFullTimeShift && fullTimeSet.has(staffName) ? getFullTimeShiftUsageCount(staffName, column.shiftType) : 0;
            const usagePenalty = preventFixedFullTimeShift && fullTimeSet.has(staffName) ? usage * 0.35 : 0;
            const score = baseScore + bonus - usagePenalty;
            if (
              !best ||
              score > best.score ||
              (score === best.score && bonus > best.bonus) ||
              (score === best.score && bonus === best.bonus && usage < best.usage)
            ) {
              best = { classGroup: classGroup.key, column, score, bonus, usage };
            }
          }
        }
        if (!best || best.score <= 0) {
          return null;
        }
        return { classGroup: best.classGroup, column: best.column };
      };
      const isEarlyShiftType = (shiftType: string): boolean => {
        const pattern = shiftPatternByCode.get(shiftType);
        if (!pattern) {
          return false;
        }
        return timeToMinutes(pattern.startTime) <= timeToMinutes("08:30");
      };
      const wasAssignedEarlyShiftPreviousDate = (date: string, staffName: string): boolean => {
        const dateIndex = baseDateIndexByDate.get(date) ?? -1;
        if (dateIndex <= 0) {
          return false;
        }
        const previousDate = dates[dateIndex - 1];
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const column of shiftColumns) {
            const cellKey = keyOf(previousDate, column.id, classGroup.key);
            if ((nextCells[cellKey] ?? "").trim() !== staffName) {
              continue;
            }
            if (isEarlyShiftType(column.shiftType)) {
              return true;
            }
          }
        }
        return false;
      };

      for (const date of dates) {
        if (skipSundayProcessing && isSundayDate(date)) {
          targetByDate.set(date, 0);
          remainingByDate.set(date, 0);
          overflowRemainingByDate.set(date, 0);
          compensatoryQuotaByDate.set(date, 0);
          appendLog("info", "capacity", `${date}: 日曜除外ルールにより処理対象外`);
          continue;
        }
        const day = new Date(`${date}T00:00:00`).getDay();
        const isSaturday = day === 6;
        const requiredForDate = Math.max(
          1,
          ...(effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0)),
          isSaturday && rules.saturdayRequirement.enabled ? rules.saturdayRequirement.minTotalStaff : 0
        );
        const availableCount = staffPool.filter(
          (name) => !nextOffByDateAndStaff[`${date}|${name}`] && shiftColumns.some((column) => canWorkOnShift(date, column.shiftType, name))
        ).length;
        const targetCount = Math.max(1, Math.min(requiredForDate, slotCapacityPerDate));
        const maxAssignableCount = Math.max(0, Math.min(availableCount, slotCapacityPerDate));
        targetByDate.set(date, targetCount);
        remainingByDate.set(date, targetCount);
        overflowRemainingByDate.set(date, Math.max(0, maxAssignableCount - targetCount));
        compensatoryQuotaByDate.set(date, Math.max(0, maxAssignableCount - targetCount));
        if (maxAssignableCount < requiredForDate) {
          appendLog(
            "warn",
            "capacity",
            `${date}: 必要目安${requiredForDate}人に対して、割当可能上限は${maxAssignableCount}人（可用${availableCount} / 枠${slotCapacityPerDate}）`
          );
        } else {
          appendLog("info", "capacity", `${date}: 必要目安${requiredForDate}人 / 時間帯充足に向け最大${maxAssignableCount}人まで割当可能`);
        }
      }

      appendLog("info", "step-1", `${titleAt(0, "休みを入力")}: 休み入力 ${Object.keys(nextOffByDateAndStaff).length} 件を固定`);
      appendLog("info", "step-2", `${titleAt(1, "イベントを入力")}: イベント入力 ${eventInputCount} 日を反映`);
      pushSnapshot("step-1-2", "Step1-2 休み/イベント反映", "手入力情報を固定した状態");

      const runAssignmentPhase = async (
        stepLabel: string,
        ruleTitle: string,
        staffCandidates: string[],
        preferredShiftResolver: (name: string) => string,
        maxAssignmentsPerDateResolver: (date: string) => number,
        options?: { avoidConsecutiveEarly?: boolean }
      ): Promise<void> => {
        appendLog("info", stepLabel, `${ruleTitle}: 割当フェーズを開始（候補 ${staffCandidates.length} 名）`);
        for (const date of dates) {
          if (skipSundayProcessing && isSundayDate(date)) {
            continue;
          }
          const phaseMaxAssignments = Math.max(0, maxAssignmentsPerDateResolver(date));
          let phaseAssigned = 0;
          let guard = 0;
          while ((remainingByDate.get(date) ?? 0) > 0 && phaseAssigned < phaseMaxAssignments && guard < slotCapacityPerDate * 2) {
            guard += 1;
            const shortagesForDate = shortageItemsForCells(nextCells)
              .filter((item) => item.date === date)
              .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
            if (shortagesForDate.length === 0) {
              break;
            }
            const highestPriorityShortageTime = shortagesForDate[0]?.time;
            const assignedCountForDate = (assignedByDate.get(date) ?? new Set<string>()).size;
            const targetCountForDate = targetByDate.get(date) ?? 0;
            if (assignedCountForDate >= targetCountForDate) {
              break;
            }
            const assignedNames = assignedByDate.get(date) ?? new Set<string>();
            const availableCandidates = staffCandidates
              .filter((name) => !assignedNames.has(name))
              .filter((name) => !nextOffByDateAndStaff[`${date}|${name}`])
              .filter((name) => shiftColumns.some((column) => canWorkOnShift(date, column.shiftType, name)));
            const quotaCandidates = availableCandidates.filter((name) => hasRemainingFullTimeWeeklyQuota(name, date));
            const candidatePool = quotaCandidates.length > 0 ? quotaCandidates : availableCandidates;

            if (candidatePool.length === 0) {
              break;
            }

            const staffOrder = orderedCandidatesByDate(staffCandidates).filter((name) => candidatePool.includes(name));
            const prioritizeSaturdayFairness = isSaturdayDate(date);
            const sortedByWorkload = [...staffOrder].sort((a, b) => {
              const aDeficit = fullTimeWeeklyDeficit(a, date);
              const bDeficit = fullTimeWeeklyDeficit(b, date);
              if (aDeficit !== bDeficit) {
                return bDeficit - aDeficit;
              }
              if (prioritizeSaturdayFairness) {
                const aSaturdayCount = saturdayAssignmentCountByStaff.get(a) ?? 0;
                const bSaturdayCount = saturdayAssignmentCountByStaff.get(b) ?? 0;
                if (aSaturdayCount !== bSaturdayCount) {
                  return aSaturdayCount - bSaturdayCount;
                }
              }
              const aCount = assignmentCountByStaff.get(a) ?? 0;
              const bCount = assignmentCountByStaff.get(b) ?? 0;
              if (aCount !== bCount) {
                return aCount - bCount;
              }
              return 0;
            });
            let aiRankedCandidates = [...sortedByWorkload];
            if (
              useAiAssistance &&
              highestPriorityShortageTime &&
              sortedByWorkload.length > 1 &&
              aiRerankCalls < maxAiRerankCalls
            ) {
              const rankingTarget = sortedByWorkload.slice(0, 6);
              const cacheKey = `${date}|${highestPriorityShortageTime}|${stepLabel}|${rankingTarget.join(",")}`;
              const cached = aiRerankCache.get(cacheKey);
              if (cached && cached.length > 0) {
                const front = cached.filter((name) => sortedByWorkload.includes(name));
                const tail = sortedByWorkload.filter((name) => !front.includes(name));
                aiRankedCandidates = [...front, ...tail];
              } else {
                aiRerankCalls += 1;
                const result = await callShiftAi<{ rankedStaffNames?: string[]; reason?: string }>("rerankCandidates", {
                  month,
                  date,
                  shortageTime: highestPriorityShortageTime,
                  stepLabel,
                  ruleTitle,
                  supplementNote: supplementNote.trim(),
                  supplementGuidance: supplementGuidanceForAi,
                  candidates: rankingTarget.map((name) => ({
                    staffName: name,
                    isFullTime: fullTimeSet.has(name),
                    monthlyAssignments: assignmentCountByStaff.get(name) ?? 0,
                    saturdayAssignments: saturdayAssignmentCountByStaff.get(name) ?? 0,
                    weeklyDaysTarget: partByName.get(name)?.weeklyDays ?? null,
                    preferredShift: preferredShiftResolver(name)
                  }))
                });
                const ranked = (result?.rankedStaffNames ?? []).filter((name) => sortedByWorkload.includes(name));
                if (ranked.length > 0) {
                  aiRerankCache.set(cacheKey, ranked);
                  const tail = sortedByWorkload.filter((name) => !ranked.includes(name));
                  aiRankedCandidates = [...ranked, ...tail];
                  if (result?.reason) {
                    appendLog("info", stepLabel, `${date}: AI再ランキング採用（${result.reason}）`);
                  }
                }
              }
            }
            const selectSlotFromCandidates = (
              candidates: string[]
            ): { selectedName: string; targetSlot: { classGroup: ShiftClassGroup; column: ShiftColumn } } | null => {
              for (const candidate of candidates) {
                const preferredShift = preferredShiftResolver(candidate);
                const slot = findAssignableSlot(date, candidate, preferredShift, highestPriorityShortageTime);
                if (!slot) {
                  continue;
                }
                if (options?.avoidConsecutiveEarly && isEarlyShiftType(slot.column.shiftType) && wasAssignedEarlyShiftPreviousDate(date, candidate)) {
                  continue;
                }
                return { selectedName: candidate, targetSlot: slot };
              }
              return null;
            };

            let selected = selectSlotFromCandidates(aiRankedCandidates);
            if (!selected && options?.avoidConsecutiveEarly) {
              // Fall back: keep filling shortages even if early shifts become consecutive.
              selected = selectSlotFromCandidates(staffOrder);
            }
            if (!selected) {
              appendLog("warn", stepLabel, `${date}: 時間帯不足を埋める配置候補が見つからずフェーズを終了`);
              break;
            }
            const { selectedName, targetSlot } = selected;

            nextCells[keyOf(date, targetSlot.column.id, targetSlot.classGroup)] = selectedName;
            assignedNames.add(selectedName);
            assignedByDate.set(date, assignedNames);
            incrementFullTimeShiftUsage(selectedName, targetSlot.column.shiftType);
            incrementFullTimeWeeklyAssignment(selectedName, date);
            remainingByDate.set(date, Math.max(0, (remainingByDate.get(date) ?? 0) - 1));
            phaseAssigned += 1;
            createdCount += 1;
            const nextCount = (assignmentCountByStaff.get(selectedName) ?? 0) + 1;
            assignmentCountByStaff.set(selectedName, nextCount);
            if (isSaturdayDate(date)) {
              saturdayAssignmentCountByStaff.set(selectedName, (saturdayAssignmentCountByStaff.get(selectedName) ?? 0) + 1);
            }

            const reasonParts = [
              `ルール=${ruleTitle}`,
              fullTimeSet.has(selectedName) ? "区分=常勤" : "区分=パート",
              `月内割当=${nextCount}回`,
              `フェーズ内=${phaseAssigned}/${phaseMaxAssignments}`,
              `残自動枠=${remainingByDate.get(date) ?? 0}人`
            ];
            if (preventFixedFullTimeShift && fullTimeSet.has(selectedName)) {
              const shiftUsageCount = getFullTimeShiftUsageCount(selectedName, targetSlot.column.shiftType);
              reasonParts.push(`同シフト回数=${shiftUsageCount}回`);
            }
            if (isSaturdayDate(date)) {
              reasonParts.push(`土曜回数=${saturdayAssignmentCountByStaff.get(selectedName) ?? 0}回`);
            }
            const weeklyDays = partByName.get(selectedName)?.weeklyDays;
            if (weeklyDays) {
              reasonParts.push(`週勤務目安=${weeklyDays}回`);
            }
            appendLog(
              "info",
              stepLabel,
              `${date} ${targetSlot.column.shiftType}: ${selectedName} を配置（${reasonParts.join(" / ")}）`
            );
          }
          if (phaseAssigned >= phaseMaxAssignments && (remainingByDate.get(date) ?? 0) > 0) {
            appendLog("info", stepLabel, `${date}: フェーズ割当上限 ${phaseMaxAssignments} 件に達したため次フェーズへ移行`);
          }
        }
      };

      const partPriorityNames = partStaff
        .filter((staff) => staff.weeklyDays >= 4)
        .map((staff) => staff.normalizedName);
      const partWeeklyNames = partStaff
        .filter((staff) => staff.weeklyDays > 0)
        .sort((a, b) => b.weeklyDays - a.weeklyDays)
        .map((staff) => staff.normalizedName);

      await runAssignmentPhase(
        "step-3",
        titleAt(2, "パートさんでほぼ入れる人を入れる"),
        partPriorityNames,
        (name) => partByName.get(name)?.defaultShiftPatternCode ?? middleShift,
        (date) => Math.min(partPriorityNames.length, Math.max(2, Math.ceil((targetByDate.get(date) ?? 0) * 0.3)))
      );
      pushSnapshot("step-3", "Step3 パート優先配置", titleAt(2, "パートさんでほぼ入れる人を入れる"));
      await runAssignmentPhase(
        "step-4",
        titleAt(3, "常勤の早番を入れる"),
        fullTimeNames,
        () => earlyShift,
        (date) => Math.max(2, Math.ceil((targetByDate.get(date) ?? 0) * 0.35)),
        { avoidConsecutiveEarly: true }
      );
      pushSnapshot("step-4", "Step4 常勤早番配置", titleAt(3, "常勤の早番を入れる"));
      await runAssignmentPhase(
        "step-5",
        titleAt(4, "常勤の遅番を入れる"),
        fullTimeNames,
        () => lateShift,
        (date) => Math.max(2, Math.ceil((targetByDate.get(date) ?? 0) * 0.35))
      );
      pushSnapshot("step-5", "Step5 常勤遅番配置", titleAt(4, "常勤の遅番を入れる"));
      await runAssignmentPhase(
        "step-6",
        titleAt(5, "週◯回のパートさんを入れる"),
        partWeeklyNames,
        (name) => partByName.get(name)?.defaultShiftPatternCode ?? middleShift,
        (date) => Math.max(1, Math.ceil((targetByDate.get(date) ?? 0) * 0.2))
      );
      pushSnapshot("step-6", "Step6 週回数パート配置", titleAt(5, "週◯回のパートさんを入れる"));
      await runAssignmentPhase(
        "step-7",
        titleAt(6, "常勤で調整する"),
        fullTimeNames,
        () => middleShift,
        (date) => targetByDate.get(date) ?? 0
      );
      pushSnapshot("step-7", "Step7 常勤調整", titleAt(6, "常勤で調整する"));

      if (rules.compensatoryHoliday.enabled && rules.compensatoryHoliday.sameWeekRequired) {
        const compensatoryLoadByDate = new Map<string, number>();
        for (const date of dates) {
          const weekday = new Date(`${date}T00:00:00`).getDay();
          if (weekday !== 6) {
            continue;
          }
          const saturdayStaff = Array.from(assignedByDate.get(date) ?? []).filter((staffName) => fullTimeSet.has(staffName));
          const unresolvedStaffNames: string[] = [];
          for (const staffName of saturdayStaff) {
            const weekDates = weekDatesForSaturday(date).filter((candidateDate) => candidateDate !== date);
            const candidateDates = weekDates
              .filter((candidateDate) => {
                const day = new Date(`${candidateDate}T00:00:00`).getDay();
                return day >= 1 && day <= 5;
              })
              .sort((a, b) => {
                const aLoad = compensatoryLoadByDate.get(a) ?? 0;
                const bLoad = compensatoryLoadByDate.get(b) ?? 0;
                if (aLoad !== bLoad) {
                  return aLoad - bLoad;
                }
                const remainingDiff = (remainingByDate.get(b) ?? 0) - (remainingByDate.get(a) ?? 0);
                if (remainingDiff !== 0) {
                  return remainingDiff;
                }
                return a.localeCompare(b);
              });
            let secured = false;
            for (const candidateDate of candidateDates) {
              const key = `${candidateDate}|${staffName}`;
              if (nextOffByDateAndStaff[key]) {
                continue;
              }
              const removedResult = removeStaffAssignmentFromDate(nextCells, candidateDate, staffName);
              const quota = compensatoryQuotaByDate.get(candidateDate) ?? 0;
              const canUseQuota = quota > 0;
              const canRemoveWithoutShortage =
                removedResult.removed &&
                !shortageItemsForCells(removedResult.nextCells).some((item) => item.date === candidateDate);

              if (canUseQuota && (!removedResult.removed || canRemoveWithoutShortage)) {
                nextOffByDateAndStaff[key] = true;
                compensatoryQuotaByDate.set(candidateDate, Math.max(0, quota - 1));
                nextCells = removedResult.nextCells;
                if (removedResult.removed) {
                  const assignedNames = assignedByDate.get(candidateDate) ?? new Set<string>();
                  assignedNames.delete(staffName);
                  assignedByDate.set(candidateDate, assignedNames);
                  remainingByDate.set(candidateDate, (remainingByDate.get(candidateDate) ?? 0) + 1);
                  assignmentCountByStaff.set(staffName, Math.max(0, (assignmentCountByStaff.get(staffName) ?? 0) - 1));
                  decrementFullTimeWeeklyAssignment(staffName, candidateDate);
                  for (const removedShiftType of removedResult.removedShiftTypes) {
                    decrementFullTimeShiftUsage(staffName, removedShiftType);
                  }
                }
                substituteHolidayCount += 1;
                compensatoryLoadByDate.set(candidateDate, (compensatoryLoadByDate.get(candidateDate) ?? 0) + 1);
                appendLog(
                  "info",
                  "compensatory-holiday",
                  `${staffName}: ${date} 土曜勤務の振替として ${candidateDate} を休みに設定（同週振替ルール / 日次余力を使用 / 分散配置）`
                );
                secured = true;
                break;
              }

              if (!removedResult.removed || removedResult.removedShiftTypes.length !== 1) {
                continue;
              }
              const targetShiftType = removedResult.removedShiftTypes[0];
              const assignedNames = assignedByDate.get(candidateDate) ?? new Set<string>();
              const replacementCandidates = staffPool
                .filter((name) => name !== staffName)
                .filter((name) => !assignedNames.has(name))
                .filter((name) => !nextOffByDateAndStaff[`${candidateDate}|${name}`])
                .filter((name) => canWorkOnShift(candidateDate, targetShiftType, name))
                .sort((a, b) => {
                  const aDeficit = fullTimeWeeklyDeficit(a, candidateDate);
                  const bDeficit = fullTimeWeeklyDeficit(b, candidateDate);
                  if (aDeficit !== bDeficit) {
                    return bDeficit - aDeficit;
                  }
                  const aCount = assignmentCountByStaff.get(a) ?? 0;
                  const bCount = assignmentCountByStaff.get(b) ?? 0;
                  if (aCount !== bCount) {
                    return aCount - bCount;
                  }
                  if (preventFixedFullTimeShift) {
                    const aUsage = fullTimeSet.has(a) ? getFullTimeShiftUsageCount(a, targetShiftType) : 0;
                    const bUsage = fullTimeSet.has(b) ? getFullTimeShiftUsageCount(b, targetShiftType) : 0;
                    if (aUsage !== bUsage) {
                      return aUsage - bUsage;
                    }
                  }
                  return a.localeCompare(b, "ja");
                });
              const replacementName = replacementCandidates[0];
              if (!replacementName) {
                continue;
              }

              const replacedResult = replaceStaffAssignmentForDate(nextCells, candidateDate, staffName, replacementName);
              if (!replacedResult.replaced) {
                continue;
              }
              nextCells = replacedResult.nextCells;
              nextOffByDateAndStaff[key] = true;
              assignedNames.delete(staffName);
              assignedNames.add(replacementName);
              assignedByDate.set(candidateDate, assignedNames);
              assignmentCountByStaff.set(staffName, Math.max(0, (assignmentCountByStaff.get(staffName) ?? 0) - 1));
              assignmentCountByStaff.set(replacementName, (assignmentCountByStaff.get(replacementName) ?? 0) + 1);
              decrementFullTimeWeeklyAssignment(staffName, candidateDate);
              incrementFullTimeWeeklyAssignment(replacementName, candidateDate);
              for (const shiftType of replacedResult.replacedShiftTypes) {
                decrementFullTimeShiftUsage(staffName, shiftType);
                incrementFullTimeShiftUsage(replacementName, shiftType);
              }
              substituteHolidayCount += 1;
              compensatoryLoadByDate.set(candidateDate, (compensatoryLoadByDate.get(candidateDate) ?? 0) + 1);
              appendLog(
                "info",
                "compensatory-holiday",
                `${staffName}: ${date} 土曜勤務の振替として ${candidateDate} を休みに設定（${replacementName} が ${targetShiftType} を代替 / 分散配置）`
              );
              secured = true;
              break;
            }

            if (!secured) {
              unresolvedStaffNames.push(staffName);
            }
          }
          if (unresolvedStaffNames.length > 0) {
            unresolvedCompensatoryRequests.push({ saturdayDate: date, staffNames: [...unresolvedStaffNames] });
            const preview = unresolvedStaffNames.slice(0, 4).join("、");
            appendLog(
              "warn",
              "compensatory-holiday",
              `${date} 土曜勤務者のうち ${unresolvedStaffNames.length} 名は同週振替を確保できませんでした（例: ${preview}${
                unresolvedStaffNames.length > 4 ? " など" : ""
              }）`
            );
          }
          const saturdayPartTimeCount = Array.from(assignedByDate.get(date) ?? []).filter((staffName) => !fullTimeSet.has(staffName)).length;
          if (saturdayPartTimeCount > 0) {
            appendLog(
              "info",
              "compensatory-holiday",
              `${date}: パート ${saturdayPartTimeCount} 名は振替休日対象外（週勤務回数ルールのみ適用）`
            );
          }
        }
      }
      pushSnapshot("compensatory", "振替休日反映", "同週振替ルールの反映後");

      await runAssignmentPhase(
        "step-7b",
        `${titleAt(6, "常勤で調整する")}（振替後再調整）`,
        [...partWeeklyNames, ...fullTimeNames],
        () => middleShift,
        (date) => targetByDate.get(date) ?? 0
      );
      pushSnapshot("step-7b", "最終再調整", "振替後の不足再調整");

      // 通常フェーズでは日ごとの必要人数を上限に抑える。
      // それでも時間帯不足が残る日だけ、例外的に追加配置（超過）を許可する。
      appendLog("info", "step-7b", "例外調整: 時間帯不足が残る日のみ必要人数を超える配置を検討");
      for (const date of dates) {
        if (skipSundayProcessing && isSundayDate(date)) {
          continue;
        }
        let guard = 0;
        while ((overflowRemainingByDate.get(date) ?? 0) > 0 && guard < slotCapacityPerDate * 2) {
          guard += 1;
          const shortagesForDate = shortageItemsForCells(nextCells)
            .filter((item) => item.date === date)
            .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
          if (shortagesForDate.length === 0) {
            break;
          }
          const highestPriorityShortageTime = shortagesForDate[0]?.time;
          const assignedNames = assignedByDate.get(date) ?? new Set<string>();
          const availableCandidates = staffPool
            .filter((name) => !assignedNames.has(name))
            .filter((name) => !nextOffByDateAndStaff[`${date}|${name}`])
            .filter((name) => shiftColumns.some((column) => canWorkOnShift(date, column.shiftType, name)))
            .filter((name) => {
              if (!highestPriorityShortageTime) {
                return true;
              }
              return shiftColumns.some(
                (column) => canWorkOnShift(date, column.shiftType, name) && shiftTypeCoversTime(column.shiftType, highestPriorityShortageTime)
              );
            });
          const quotaCandidates = availableCandidates.filter((name) => hasRemainingFullTimeWeeklyQuota(name, date));
          const candidatePool = quotaCandidates.length > 0 ? quotaCandidates : availableCandidates;
          if (candidatePool.length === 0) {
            break;
          }

          const sortedCandidates = [...candidatePool].sort((a, b) => {
            const aDeficit = fullTimeWeeklyDeficit(a, date);
            const bDeficit = fullTimeWeeklyDeficit(b, date);
            if (aDeficit !== bDeficit) {
              return bDeficit - aDeficit;
            }
            if (isSaturdayDate(date)) {
              const aSaturdayCount = saturdayAssignmentCountByStaff.get(a) ?? 0;
              const bSaturdayCount = saturdayAssignmentCountByStaff.get(b) ?? 0;
              if (aSaturdayCount !== bSaturdayCount) {
                return aSaturdayCount - bSaturdayCount;
              }
            }
            const aCount = assignmentCountByStaff.get(a) ?? 0;
            const bCount = assignmentCountByStaff.get(b) ?? 0;
            if (aCount !== bCount) {
              return aCount - bCount;
            }
            return a.localeCompare(b, "ja");
          });
          let selectedName = "";
          let targetSlot: { classGroup: ShiftClassGroup; column: ShiftColumn } | null = null;
          for (const candidateName of sortedCandidates) {
            const candidateSlot = findAssignableSlot(date, candidateName, middleShift, highestPriorityShortageTime);
            if (candidateSlot) {
              selectedName = candidateName;
              targetSlot = candidateSlot;
              break;
            }
          }
          if (!targetSlot) {
            break;
          }

          nextCells[keyOf(date, targetSlot.column.id, targetSlot.classGroup)] = selectedName;
          assignedNames.add(selectedName);
          assignedByDate.set(date, assignedNames);
          incrementFullTimeShiftUsage(selectedName, targetSlot.column.shiftType);
          incrementFullTimeWeeklyAssignment(selectedName, date);
          overflowRemainingByDate.set(date, Math.max(0, (overflowRemainingByDate.get(date) ?? 0) - 1));
          createdCount += 1;
          const nextCount = (assignmentCountByStaff.get(selectedName) ?? 0) + 1;
          assignmentCountByStaff.set(selectedName, nextCount);
          if (isSaturdayDate(date)) {
            saturdayAssignmentCountByStaff.set(selectedName, (saturdayAssignmentCountByStaff.get(selectedName) ?? 0) + 1);
          }
          appendLog(
            "warn",
            "step-7b",
            `${date} ${targetSlot.column.shiftType}: 時間帯不足解消のため ${selectedName} を例外追加（必要人数超過を許容${
              isSaturdayDate(date) ? ` / 土曜回数=${saturdayAssignmentCountByStaff.get(selectedName) ?? 0}回` : ""
            }）`
          );
        }
      }
      pushSnapshot("step-7c", "時間帯不足の例外調整", "必要人数超過を抑えつつ不足解消を優先");

      for (const date of dates) {
        if (skipSundayProcessing && isSundayDate(date)) {
          appendLog("info", "daily-summary", `${date}: 日曜除外ルールにより集計対象外`);
          continue;
        }
        const assignedCount = (assignedByDate.get(date) ?? new Set<string>()).size;
        const targetCount = targetByDate.get(date) ?? 0;
        const shortage = Math.max(0, targetCount - assignedCount);
        if (shortage > 0) {
          unassignedSlotCount += shortage;
          appendLog("warn", "daily-summary", `${date}: 必要目安 ${targetCount}人 / 配置 ${assignedCount}人 / 不足 ${shortage}人`);
        } else {
          appendLog("info", "daily-summary", `${date}: 必要目安 ${targetCount}人 / 配置 ${assignedCount}人 / 不足 0人`);
        }
        const weekday = new Date(`${date}T00:00:00`).getDay();
        if (weekday === 6) {
          saturdayAssignedCount += assignedCount;
          if (rules.saturdayRequirement.enabled && assignedCount < rules.saturdayRequirement.minTotalStaff) {
            saturdayViolationCount += 1;
            appendLog(
              "warn",
              "saturday-rule",
              `${date}: 土曜必要人数 ${rules.saturdayRequirement.minTotalStaff}人に対して ${assignedCount}人（違反）`
            );
          }
        }
      }

      const staffLoadSummary = Array.from(assignmentCountByStaff.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}:${count}`)
        .join(" / ");
      appendLog("info", "analysis", `職員別割当回数: ${staffLoadSummary}`);
      pushSnapshot("analysis", "分析結果", "日次集計まで反映");

      const timeBasedShortages = shortageItemsForCells(nextCells);
      if (useAiAssistance) {
        const shortageCandidatePayload = timeBasedShortages.slice(0, 6).map((item) => {
          const assignedNames = assignedByDate.get(item.date) ?? new Set<string>();
          const candidates = staffPool
            .filter((name) => !assignedNames.has(name))
            .filter((name) => !nextOffByDateAndStaff[`${item.date}|${name}`])
            .filter((name) => shiftColumns.some((column) => canWorkOnShift(item.date, column.shiftType, name)))
            .slice(0, 8)
            .map((name) => ({
              staffName: name,
              isFullTime: fullTimeSet.has(name),
              monthlyAssignments: assignmentCountByStaff.get(name) ?? 0,
              saturdayAssignments: saturdayAssignmentCountByStaff.get(name) ?? 0,
              weeklyDaysTarget: partByName.get(name)?.weeklyDays ?? null,
              candidateShiftTypes: shiftColumns
                .filter((column) => shiftTypeCoversTime(column.shiftType, item.time) && canWorkOnShift(item.date, column.shiftType, name))
                .map((column) => column.shiftType)
            }));
          return { ...item, candidates };
        });
        const shortageSuggestionResult = await callShiftAi<{ suggestions?: AiShortageSuggestion[] }>("suggestShortageFixes", {
          month,
          supplementNote: supplementNote.trim(),
          supplementGuidance: supplementGuidanceForAi,
          shortages: shortageCandidatePayload
        });
        const validShortageSuggestions = sanitizeAiShortageSuggestions(shortageSuggestionResult?.suggestions ?? []).slice(0, 5);
        const removedShortageSuggestionCount = (shortageSuggestionResult?.suggestions ?? []).length - validShortageSuggestions.length;
        if (removedShortageSuggestionCount > 0) {
          appendLog("warn", "analysis", `AI不足提案を ${removedShortageSuggestionCount} 件除外（無効な職員名/日付/シフトを検出）`);
        }
        setAiShortageSuggestions(validShortageSuggestions);

        const compensatorySuggestionResult = await callShiftAi<{ suggestions?: AiCompensatorySuggestion[] }>(
          "suggestCompensatoryHolidays",
          {
            month,
            supplementNote: supplementNote.trim(),
            unresolvedCompensatoryRequests,
            assignmentCountByStaff: Array.from(assignmentCountByStaff.entries()).map(([name, count]) => ({ name, count })),
            saturdayAssignmentCountByStaff: Array.from(saturdayAssignmentCountByStaff.entries()).map(([name, count]) => ({ name, count }))
          }
        );
        const validCompensatorySuggestions = sanitizeAiCompensatorySuggestions(compensatorySuggestionResult?.suggestions ?? []).slice(0, 8);
        const removedCompensatorySuggestionCount =
          (compensatorySuggestionResult?.suggestions ?? []).length - validCompensatorySuggestions.length;
        if (removedCompensatorySuggestionCount > 0) {
          appendLog("warn", "analysis", `AI振替提案を ${removedCompensatorySuggestionCount} 件除外（具体日付の不足や同週条件違反）`);
        }
        setAiCompensatorySuggestions(validCompensatorySuggestions);

        const summarizeResult = await callShiftAi<{ summary?: string; bullets?: string[] }>("summarizeLogs", {
          month,
          supplementNote: supplementNote.trim(),
          logs: executionLogs.slice(-120).map((item) => ({
            level: item.level,
            step: item.step,
            message: item.message
          }))
        });
        setAiLogSummary(summarizeResult?.summary?.trim() ?? "");
        setAiSummaryBullets((summarizeResult?.bullets ?? []).filter((item) => item.trim().length > 0).slice(0, 5));
      }
      if (timeBasedShortages.length > 0) {
        const preview = timeBasedShortages.slice(0, 20);
        for (const item of preview) {
          appendLog(
            "warn",
            "hard-rule-time",
            `${item.date} ${item.time}: 必要${item.required}人 / 配置${item.assigned}人（不足${item.required - item.assigned}）`
          );
        }
        if (timeBasedShortages.length > preview.length) {
          appendLog(
            "warn",
            "hard-rule-time",
            `時間帯不足ログを省略: 残り ${timeBasedShortages.length - preview.length} 件`
          );
        }
        appendLog(
          "warn",
          "hard-rule",
          `絶対ルール違反: 時間帯ベースの必要人数未達が ${timeBasedShortages.length} 件あります。下書きは反映しません。`
        );
        setAutoGenerateError(
          `時間帯ベースの必要人数未達が ${timeBasedShortages.length} 件あるため、自動作成結果は反映していません。`
        );
        pushSnapshot("hard-rule-failed", "絶対ルール違反", "時間帯不足のため反映不可");
        publishSnapshots("hard-rule-failed");
        return;
      }

      if (unassignedSlotCount > 0) {
        appendLog(
          "warn",
          "soft-rule",
          `日次目標ベースで未充足が ${unassignedSlotCount} 件あります（時間帯ベース必須条件は満たしています）。`
        );
      }

      const totalTargetCount = Array.from(targetByDate.values()).reduce((sum, value) => sum + value, 0);
      const finalAssignedCount = Array.from(assignedByDate.values()).reduce((sum, value) => sum + value.size, 0);
      const summary = `下書きを作成しました（必要目安 ${totalTargetCount} 件 / 配置 ${finalAssignedCount} 件 / 未充足 ${unassignedSlotCount} 件 / 土曜違反 ${saturdayViolationCount} 日）`;
      appendLog(
        "info",
        "finish",
        `完了: 必要目安 ${totalTargetCount} 件, 配置 ${finalAssignedCount} 件, 未充足 ${unassignedSlotCount} 件, 土曜配置 ${saturdayAssignedCount} 件, 振替休日 ${substituteHolidayCount} 件, 土曜違反 ${saturdayViolationCount} 日（割当アクション ${createdCount} 件）`
      );
      pushSnapshot("finish", "最終下書き", summary);
      publishSnapshots("finish");
      showToast(summary);
    } catch (error) {
      setAutoGenerateError(error instanceof Error ? error.message : "下書き作成に失敗しました。");
      appendLog("warn", "error", error instanceof Error ? error.message : "下書き作成に失敗しました。");
      setAutoGenerateLogs(executionLogs);
    } finally {
      setAutoGenerating(false);
      autoGenerateRunningRef.current = false;
      setShowCreateStepModal(false);
    }
  }

  return (
    <>
      {loadingData || loadingMasterData ? <FullscreenLoading /> : null}
      {autoGenerating ? (
        <div className="sticky top-2 z-20 mx-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 shadow-sm md:mx-6">
          <span className="inline-flex items-center gap-2 font-semibold">
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-300 border-t-orange-600"
              aria-hidden="true"
            />
            自動作成中です。完了までお待ちください...
          </span>
        </div>
      ) : null}
      <main className="space-y-4 p-4 md:p-6">
        <section className="rounded-xl bg-white p-2 shadow-sm md:p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-orange-900">保育園シフト管理</h1>
            <p className="text-sm text-orange-700">縦: 日付 / 横: シフトパターン（データ管理で編集）</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-orange-900">
              月:
              <input
                type="month"
                className="ml-2 rounded-md bg-orange-50 px-2 py-1"
                value={month}
                onChange={(event) => handleMonthChange(event.target.value)}
              />
            </label>
            <button
              className="rounded-md bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
              onClick={() => void loadMonth()}
              disabled={loadingData}
            >
              再読込
            </button>
            <button
              className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              onClick={() => void saveMonth()}
              disabled={saving || loadingData}
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              onClick={() => setShowCreateStepModal(true)}
              disabled={loadingData}
            >
              シフト自動作成
            </button>
          </div>
        </div>
        </section>
        {autoGenerateError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{autoGenerateError}</p> : null}
        {autoGenerateLogs.length > 0 ? (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <div className="rounded-md border border-orange-200 bg-white">
              <div className="flex items-center justify-between border-b border-orange-100 px-3 py-2">
                <p className="text-sm font-semibold text-orange-900">自動作成ログ</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-orange-700">{autoGenerateLogs.length}件</p>
                  <button
                    className="rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200"
                    onClick={() => setAutoGenerateLogsExpanded((prev) => !prev)}
                  >
                    {autoGenerateLogsExpanded ? "折りたたむ" : "表示する"}
                  </button>
                </div>
              </div>
              {autoGenerateLogsExpanded ? (
                <div className="max-h-72 overflow-auto px-3 py-2">
                  <p className="mb-2 text-xs text-orange-700">先生向けにわかりやすい表現で表示しています。</p>
                  <ul className="space-y-1">
                    {autoGenerateLogs.map((log) => (
                      <li
                        key={log.id}
                        className={`rounded px-2 py-1 text-xs ${
                          log.level === "warn" ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-800"
                        }`}
                      >
                        {`${String(log.sequence).padStart(3, "0")} ${log.time} [${teacherFriendlyStepLabel(log.step)}] ${teacherFriendlyMessage(log)}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {aiLogSummary || aiShortageSuggestions.length > 0 || aiCompensatorySuggestions.length > 0 || aiSupplementGuidance ? (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-orange-900">AI提案・要約</h2>
            {aiSupplementGuidance ? (
              <p className="mt-2 rounded bg-orange-50 px-3 py-2 text-sm text-orange-800">補足事項の解釈: {aiSupplementGuidance}</p>
            ) : null}
            {aiLogSummary ? (
              <div className="mt-2 rounded bg-orange-50 px-3 py-2 text-sm text-orange-800">
                <p className="font-semibold text-orange-900">先生向けサマリー</p>
                <p className="mt-1">{aiLogSummary}</p>
                {aiSummaryBullets.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {aiSummaryBullets.map((item, index) => (
                      <li key={`ai-summary-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {aiShortageSuggestions.length > 0 ? (
              <div className="mt-3">
                <p className="text-sm font-semibold text-orange-900">未充足への提案（クリック適用）</p>
                <div className="mt-2 space-y-2">
                  {aiShortageSuggestions.map((item, index) => (
                    <div key={`shortage-suggestion-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded bg-orange-50 px-3 py-2 text-sm">
                      <p className="text-orange-900">
                        {`${item.date} ${item.time} / ${item.staffName} を ${item.shiftType} に配置 - ${item.reason}`}
                      </p>
                      <button
                        className="rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-600"
                        onClick={() => applyAiShortageSuggestion(item)}
                      >
                        反映
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {aiCompensatorySuggestions.length > 0 ? (
              <div className="mt-3">
                <p className="text-sm font-semibold text-orange-900">振替休日候補（提案のみ）</p>
                <div className="mt-2 space-y-2">
                  {aiCompensatorySuggestions.map((item, index) => (
                    <p key={`comp-suggestion-${index}`} className="rounded bg-orange-50 px-3 py-2 text-sm text-orange-900">
                      {`${item.staffName}: ${item.saturdayDate} の振替候補 ${item.candidateDate}（${item.reason}）`}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-orange-900">自然言語でシフト修正（AI）</h2>
          <p className="mt-1 text-sm text-orange-700">例: 「4/18のA先生を休みにして、代わりにB先生を遅番へ」</p>
          <textarea
            className="mt-2 h-20 w-full rounded bg-orange-50 px-3 py-2 text-sm text-orange-900"
            value={aiNaturalLanguageInstruction}
            onChange={(event) => setAiNaturalLanguageInstruction(event.target.value)}
            placeholder="変更依頼を自然な文章で入力"
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
              onClick={() => void handleAiNaturalLanguageEdit()}
              disabled={aiActionRunning || aiNaturalLanguageInstruction.trim().length === 0}
            >
              {aiActionRunning ? "AI処理中..." : "AIで修正案を適用"}
            </button>
          </div>
          {aiNaturalLanguageResult ? (
            <p className="mt-2 rounded bg-orange-50 px-3 py-2 text-sm text-orange-800">{aiNaturalLanguageResult}</p>
          ) : null}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  viewMode === "class" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                }`}
                onClick={() => setViewMode("class")}
                disabled={plannerStep === 3}
              >
                クラス別表示
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  viewMode === "staff" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                }`}
                onClick={() => setViewMode("staff")}
              >
                先生別表示
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                  viewMode === "daily" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                }`}
                onClick={() => setViewMode("daily")}
              >
                日別表示
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md bg-orange-100 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-200"
                onClick={() => fillEmptyCellsWithOff()}
              >
                空きマスを休みで埋める
              </button>
              <button
                className="rounded-md bg-orange-100 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-200"
                onClick={() => setShowResetRequiredModal(true)}
              >
                必要人数リセット
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div
              ref={topScrollRef}
              onScroll={() => handleTopScroll()}
              className="overflow-x-auto overflow-y-hidden"
              aria-label="上部スクロールバー"
            >
              <div style={{ width: `${Math.max(topScrollWidth, 1)}px`, height: "1px" }} />
            </div>
            <div ref={bottomScrollRef} onScroll={() => handleBottomScroll()} className="overflow-auto">
              {viewMode === "class" ? (
              <div className="flex min-w-max items-start">
                <table className={compactClass}>
                  <thead>
                    <tr>
                      <th className={`h-[52px] bg-orange-100/70 text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}>日付</th>
                      <th className={`h-[52px] bg-orange-100/70 text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}>クラス区分</th>
                      {shiftColumns.map((column, columnIndex) => (
                        <th
                          key={column.id}
                        className={`relative h-[52px] cursor-pointer text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass} ${headerStripeClass(columnIndex)}`}
                          onMouseDown={(event) => {
                            const target = event.target;
                            if (target instanceof Element && target.closest('[data-header-menu="true"]')) {
                              return;
                            }
                            event.preventDefault();
                            setHeaderMenuColumnId((prev) => (prev === column.id ? null : column.id));
                          }}
                          data-header-trigger="true"
                        >
                          <div className="text-center">{column.shiftType}</div>
                          {shiftPatternByCode.get(column.shiftType) ? (
                            <div className="text-center text-xs leading-tight font-normal text-orange-700">
                              {shiftPatternByCode.get(column.shiftType)?.startTime} - {shiftPatternByCode.get(column.shiftType)?.endTime}
                            </div>
                          ) : null}
                          {headerMenuColumnId === column.id ? (
                            <div
                              className="absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 rounded-md border border-orange-200 bg-white p-1 shadow-md"
                              data-header-menu="true"
                            >
                              <button
                                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs text-orange-800 hover:bg-orange-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAddColumnModal(column.id);
                                }}
                              >
                                右に列を追加
                              </button>
                              <button
                                className="mt-1 block w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteShiftColumn(column.id);
                                }}
                              >
                                列を削除
                              </button>
                            </div>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map((date) => {
                      const weekday = weekdayFromDateText(date);
                      const isDisabledSunday = !sundayShiftInputEnabled && weekday === 0;
                      const dateText = `${dayLabelFromDateText(date)} (${WEEKDAY_LABELS[weekday]})`;
                      const dateTextClass =
                        weekday === 0 ? "text-red-600" : weekday === 6 ? "text-blue-600" : "text-orange-900";

                      const classRows = SHIFT_CLASS_GROUPS.map((classGroup, classIndex) => (
                        <tr
                          key={`${date}-${classGroup.key}`}
                          className={`${classIndex === 0 ? "h-9 border-t-2 border-orange-200" : "h-9"} ${isDisabledSunday ? sundayRowClass : ""}`}
                        >
                          {classIndex === 0 ? (
                          <td
                            rowSpan={DATE_GROUP_ROW_COUNT}
                            className={`${compactBodyCellClass} text-center align-middle ${dateTextClass} ${
                              isDisabledSunday ? "bg-white" : ""
                            }`}
                          >
                              {dateText}
                            </td>
                          ) : null}
                          <td className={`whitespace-nowrap text-center text-orange-800 ${compactBodyCellClass}`}>{classGroup.label}</td>
                          {shiftColumns.map((column, columnIndex) => {
                            const key = keyOf(date, column.id, classGroup.key);
                            const currentValue = cells[key] ?? "";
                            const warnings = ruleWarnings(date, column.shiftType, currentValue);
                            const options = selectableStaffNames(date, column.shiftType, currentValue);
                            return (
                              <td key={`${classGroup.key}-${column.id}`} className={`p-1 text-center align-middle ${bodyStripeClass(columnIndex)}`}>
                                <select
                                  className={`${compactSelectClass} ${isDisabledSunday ? "cursor-not-allowed bg-gray-100 text-gray-500" : ""}`}
                                  value={currentValue}
                                  disabled={isDisabledSunday}
                                  onChange={(event) =>
                                    setCells((prev) => ({
                                      ...prev,
                                      [key]: event.target.value
                                    }))
                                  }
                                >
                                  <option value="" />
                                  {options.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                                {warnings.length > 0 ? <p className="mt-1 text-xs text-red-600">{warnings.join(" / ")}</p> : null}
                              </td>
                            );
                          })}
                        </tr>
                      ));

                      const totalRow = (
                        <tr
                          key={`${date}-total`}
                          className={`h-9 border-b-2 border-orange-200 ${isDisabledSunday ? sundayRowClass : "bg-orange-100/40"}`}
                        >
                          <td className={`whitespace-nowrap font-semibold text-orange-900 ${compactBodyCellClass}`}>合計（対人数）</td>
                          {shiftColumns.map((column, columnIndex) => (
                            <td
                              key={`total-${date}-${column.id}`}
                            className={`${compactBodyCellClass} text-center text-xs text-orange-500 ${summaryStripeClass(columnIndex)}`}
                            />
                          ))}
                        </tr>
                      );

                      return [...classRows, totalRow];
                    })}
                  </tbody>
                </table>

                <table className={`border-l border-orange-200 ${compactClass}`}>
                  <tbody>
                    <tr className="h-[26px] bg-orange-100/70">
                      {effectiveRequiredStaffByTime.map((item, columnIndex) => (
                        <th
                          key={item.time}
                          className={`h-[26px] whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(columnIndex)}`}
                        >
                          {item.time}
                        </th>
                      ))}
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length
                        )}`}
                      >
                        <span className="block text-center">休み</span>
                      </th>
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length + 1
                        )}`}
                      >
                        <span className="block text-center">イベント</span>
                      </th>
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length + 2
                        )}`}
                      >
                        <span className="block text-center">備考</span>
                      </th>
                    </tr>
                    <tr className="h-[26px] odd:bg-orange-50/50">
                      {effectiveRequiredStaffByTime.map((item, columnIndex) => (
                        <td
                          key={`required-${item.time}`}
                          className={`h-[26px] whitespace-nowrap px-2 py-0 align-middle font-semibold text-orange-900 ${summaryStripeClass(columnIndex)}`}
                        >
                          <input
                            type="number"
                            min={0}
                            className="w-14 rounded bg-white px-1.5 py-0.5 text-right text-xs text-orange-900"
                            value={item.requiredCount}
                            onChange={(event) => {
                              const nextValue = Math.max(0, Number(event.target.value) || 0);
                              setRequiredOverrideByTime((prev) => {
                                const base = calculatedRequiredByTimeMap[item.time] ?? 0;
                                if (nextValue === base) {
                                  if (prev[item.time] === undefined) {
                                    return prev;
                                  }
                                  const next = { ...prev };
                                  delete next[item.time];
                                  return next;
                                }
                                return { ...prev, [item.time]: nextValue };
                              });
                            }}
                          />
                          <span className="ml-1">人(</span>
                          <input
                            type="number"
                            min={0}
                            className="w-12 rounded bg-white px-1.5 py-0.5 text-right text-xs text-orange-900"
                            value={saturdayRequiredStaffByTime[columnIndex]?.requiredCount ?? 0}
                            onChange={(event) => {
                              const nextValue = Math.max(0, Number(event.target.value) || 0);
                              setRequiredSaturdayOverrideByTime((prev) => {
                                const base = calculatedSaturdayRequiredByTimeMap[item.time] ?? 0;
                                if (nextValue === base) {
                                  if (prev[item.time] === undefined) {
                                    return prev;
                                  }
                                  const next = { ...prev };
                                  delete next[item.time];
                                  return next;
                                }
                                return { ...prev, [item.time]: nextValue };
                              });
                            }}
                          />
                          <span className="ml-1">人)</span>
                        </td>
                      ))}
                    </tr>
                    {dates.flatMap((date) => {
                      const isDisabledSunday = !sundayShiftInputEnabled && weekdayFromDateText(date) === 0;
                      return [
                        ...SHIFT_CLASS_GROUPS.map((classGroup, classIndex) => {
                          const counts = assignedStaffCountByDateAndClass.get(`${date}|${classGroup.key}`) ?? REQUIRED_STAFF_TIMES.map(() => 0);
                          return (
                            <tr key={`assigned-${date}-${classGroup.key}`} className={classIndex === 0 ? "h-9 border-t-2 border-orange-200" : "h-9"}>
                              {counts.map((count, columnIndex) => (
                                <td
                                  key={`${date}-${classGroup.key}-${REQUIRED_STAFF_TIMES[columnIndex]}`}
                                  className={`whitespace-nowrap px-2 py-1.5 text-center text-orange-900 ${bodyStripeClass(columnIndex)}`}
                                >
                                  {count}人
                                </td>
                              ))}
                              {classIndex === 0 ? (
                                <td
                                  rowSpan={DATE_GROUP_ROW_COUNT}
                                  className={`whitespace-nowrap px-2 py-1.5 text-center align-middle text-orange-900 ${bodyStripeClass(
                                    effectiveRequiredStaffByTime.length
                                  )}`}
                                >
                                  {offStaffTextByDate.get(date) ?? ""}
                                </td>
                              ) : null}
                              {classIndex === 0 ? (
                                <td
                                  rowSpan={DATE_GROUP_ROW_COUNT}
                                  className={`px-2 py-1.5 text-center align-middle ${bodyStripeClass(
                                    effectiveRequiredStaffByTime.length + 1
                                  )}`}
                                >
                                  <textarea
                                    className={`mx-auto h-24 w-44 resize-y rounded px-2 py-1 text-xs ${
                                      isDisabledSunday ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-orange-900"
                                    }`}
                                    value={eventByDate[date] ?? ""}
                                    disabled={isDisabledSunday}
                                    onChange={(event) =>
                                      setEventByDate((prev) => ({
                                        ...prev,
                                        [date]: event.target.value
                                      }))
                                    }
                                  />
                                </td>
                              ) : null}
                              {classIndex === 0 ? (
                                <td
                                  rowSpan={DATE_GROUP_ROW_COUNT}
                                  className={`px-2 py-1.5 text-center align-middle ${bodyStripeClass(
                                    effectiveRequiredStaffByTime.length + 2
                                  )}`}
                                >
                                  <textarea
                                    className={`mx-auto h-24 w-56 resize-y rounded px-2 py-1 text-xs ${
                                      isDisabledSunday ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-orange-900"
                                    }`}
                                    value={noteByDate[date] ?? ""}
                                    disabled={isDisabledSunday}
                                    onChange={(event) =>
                                      setNoteByDate((prev) => ({
                                        ...prev,
                                        [date]: event.target.value
                                      }))
                                    }
                                  />
                                </td>
                              ) : null}
                            </tr>
                          );
                        }),
                        <tr
                          key={`assigned-${date}-total`}
                          className={`h-9 border-b-2 border-orange-200 ${isDisabledSunday ? sundayRowClass : "bg-orange-100/40"}`}
                        >
                          {(assignedTotalStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0)).map((count, columnIndex) => (
                            <td
                              key={`${date}-total-${REQUIRED_STAFF_TIMES[columnIndex]}`}
                              className={`whitespace-nowrap px-2 py-1.5 text-center font-semibold ${
                                count < ((effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0))[columnIndex] ?? 0)
                                  ? "text-red-600"
                                  : "text-orange-900"
                              } ${summaryStripeClass(columnIndex)}`}
                            >
                              {count}人
                            </td>
                          ))}
                        </tr>
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              ) : viewMode === "staff" ? (
              <div className="flex min-w-max items-start">
                <table className={`min-w-max ${compactClass}`}>
                  <thead className="bg-orange-100/70">
                    <tr className="h-[26px]">
                      <th
                        rowSpan={2}
                        className={`w-20 min-w-20 ${compactHeadCellClass} text-center align-middle font-semibold text-orange-900`}
                      >
                        日付
                      </th>
                      {allStaffNames.map((name, index) => (
                        <th
                          key={`${name}-${index}`}
                          rowSpan={2}
                          className={`w-16 min-w-16 whitespace-nowrap px-1 py-1 text-center text-[11px] font-semibold text-orange-900 ${headerStripeClass(index)}`}
                        >
                          <span className="block truncate">{name}</span>
                        </th>
                      ))}
                    </tr>
                    <tr className="h-[26px]" />
                  </thead>
                  <tbody>
                    {dates.map((date) => {
                      const weekday = weekdayFromDateText(date);
                      const isDisabledSunday = !sundayShiftInputEnabled && weekday === 0;
                      const dateText = `${dayLabelFromDateText(date)} (${WEEKDAY_LABELS[weekday]})`;
                      const dateTextClass =
                        weekday === 0 ? "text-red-600" : weekday === 6 ? "text-blue-600" : "text-orange-900";
                      const rowMap = shiftCodesByDateAndStaff.get(date) ?? new Map<string, string>();
                      const assignmentMap = primaryAssignmentByDateAndStaff.get(date) ?? new Map<string, { shiftType: string; classGroup: ShiftClassGroup; count: number }>();
                      return (
                        <tr
                          key={`staff-view-${date}`}
                          className={`h-9 border-t border-orange-100 odd:bg-orange-50/30 ${isDisabledSunday ? sundayRowClass : ""}`}
                        >
                          <td
                            className={`h-9 w-20 min-w-20 whitespace-nowrap ${compactBodyCellClass} text-center align-middle font-semibold ${dateTextClass} ${
                              isDisabledSunday ? "bg-white" : ""
                            }`}
                          >
                            {dateText}
                          </td>
                          {allStaffNames.map((name, index) => {
                            const assignment = assignmentMap.get(name);
                            const offKey = `${date}|${name}`;
                            const currentShiftType = offByDateAndStaff[offKey] ? "__OFF__" : assignment?.shiftType ?? "";
                            const isOffCell = currentShiftType === "__OFF__";
                            const selectable = selectableShiftTypesForStaffView.filter(
                              (shiftType) => shiftType === currentShiftType || canWorkOnShift(date, shiftType, name)
                            );
                            return (
                              <td
                                key={`staff-view-${date}-${name}-${index}`}
                                className={`h-9 w-16 min-w-16 whitespace-nowrap px-1 py-1 text-center align-middle text-orange-900 ${
                                  isOffCell && !isDisabledSunday ? "bg-yellow-100" : bodyStripeClass(index)
                                }`}
                              >
                                <select
                                  className={`h-7 w-full rounded px-1 py-0.5 text-center text-[11px] outline-none ${
                                    isDisabledSunday
                                      ? "cursor-not-allowed bg-gray-100 text-gray-500"
                                      : isOffCell
                                        ? "bg-yellow-50 focus:bg-yellow-100"
                                        : "bg-white focus:bg-orange-50"
                                  }`}
                                  value={currentShiftType}
                                  disabled={isDisabledSunday}
                                  onChange={(event) => setStaffShiftForDate(date, name, event.target.value)}
                                >
                                  <option value="" />
                                  <option value="__OFF__">休み</option>
                                  {selectable.map((shiftType) => (
                                    <option key={`${date}-${name}-${shiftType}`} value={shiftType}>
                                      {shiftType}
                                    </option>
                                  ))}
                                </select>
                                {assignment && assignment.count > 1 ? (
                                  <p className="mt-1 text-[10px] text-red-600">{rowMap.get(name)}</p>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <table className={`border-l border-orange-200 ${compactClass}`}>
                  <tbody>
                    <tr className="h-[26px] bg-orange-100/70">
                      {effectiveRequiredStaffByTime.map((item, columnIndex) => (
                        <th
                          key={`staff-required-time-${item.time}`}
                          className={`h-[26px] whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(columnIndex)}`}
                        >
                          {item.time}
                        </th>
                      ))}
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length
                        )}`}
                      >
                        <span className="block text-center">休み</span>
                      </th>
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length + 1
                        )}`}
                      >
                        <span className="block text-center">イベント</span>
                      </th>
                      <th
                        rowSpan={2}
                        className={`whitespace-nowrap px-2 py-0 text-center align-middle font-semibold text-orange-900 ${headerStripeClass(
                          effectiveRequiredStaffByTime.length + 2
                        )}`}
                      >
                        <span className="block text-center">備考</span>
                      </th>
                    </tr>
                    <tr className="h-[26px]">
                      {effectiveRequiredStaffByTime.map((item, columnIndex) => (
                        <td
                          key={`staff-required-count-${item.time}`}
                          className={`h-[26px] whitespace-nowrap px-2 py-0 align-middle font-semibold text-orange-900 ${summaryStripeClass(columnIndex)}`}
                        >
                          <input
                            type="number"
                            min={0}
                            className="w-14 rounded bg-white px-1.5 py-0.5 text-right text-xs text-orange-900"
                            value={item.requiredCount}
                            onChange={(event) => {
                              const nextValue = Math.max(0, Number(event.target.value) || 0);
                              setRequiredOverrideByTime((prev) => {
                                const base = calculatedRequiredByTimeMap[item.time] ?? 0;
                                if (nextValue === base) {
                                  if (prev[item.time] === undefined) {
                                    return prev;
                                  }
                                  const next = { ...prev };
                                  delete next[item.time];
                                  return next;
                                }
                                return { ...prev, [item.time]: nextValue };
                              });
                            }}
                          />
                          <span className="ml-1">人(</span>
                          <input
                            type="number"
                            min={0}
                            className="w-12 rounded bg-white px-1.5 py-0.5 text-right text-xs text-orange-900"
                            value={saturdayRequiredStaffByTime[columnIndex]?.requiredCount ?? 0}
                            onChange={(event) => {
                              const nextValue = Math.max(0, Number(event.target.value) || 0);
                              setRequiredSaturdayOverrideByTime((prev) => {
                                const base = calculatedSaturdayRequiredByTimeMap[item.time] ?? 0;
                                if (nextValue === base) {
                                  if (prev[item.time] === undefined) {
                                    return prev;
                                  }
                                  const next = { ...prev };
                                  delete next[item.time];
                                  return next;
                                }
                                return { ...prev, [item.time]: nextValue };
                              });
                            }}
                          />
                          <span className="ml-1">人)</span>
                        </td>
                      ))}
                    </tr>
                    {dates.map((date) => (
                      <tr
                        key={`staff-total-${date}`}
                        className={`h-9 border-t border-orange-100 odd:bg-orange-50/30 ${
                          !sundayShiftInputEnabled && weekdayFromDateText(date) === 0 ? sundayRowClass : ""
                        }`}
                      >
                        {(assignedTotalStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0)).map((count, columnIndex) => (
                          <td
                            key={`staff-total-${date}-${REQUIRED_STAFF_TIMES[columnIndex]}`}
                            className={`h-9 whitespace-nowrap px-2 py-0 text-center align-middle font-semibold ${
                              count < ((effectiveRequiredStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0))[columnIndex] ?? 0)
                                ? "text-red-600"
                                : "text-orange-900"
                            } ${bodyStripeClass(columnIndex)}`}
                          >
                            {count}人
                          </td>
                        ))}
                        <td
                          className={`h-9 whitespace-nowrap px-2 py-0 text-center align-middle text-orange-900 ${bodyStripeClass(
                            effectiveRequiredStaffByTime.length
                          )}`}
                        >
                          {offStaffTextByDate.get(date) ?? ""}
                        </td>
                        <td
                          className={`h-9 px-2 py-0 text-center align-middle ${bodyStripeClass(
                            effectiveRequiredStaffByTime.length + 1
                          )}`}
                        >
                          <textarea
                            className={`mx-auto h-6 w-44 resize-none rounded px-2 py-0.5 text-xs leading-tight ${
                              !sundayShiftInputEnabled && weekdayFromDateText(date) === 0
                                ? "cursor-not-allowed bg-gray-100 text-gray-500"
                                : "bg-white text-orange-900"
                            }`}
                            value={eventByDate[date] ?? ""}
                            disabled={!sundayShiftInputEnabled && weekdayFromDateText(date) === 0}
                            onChange={(event) =>
                              setEventByDate((prev) => ({
                                ...prev,
                                [date]: event.target.value
                              }))
                            }
                          />
                        </td>
                        <td
                          className={`h-9 px-2 py-0 text-center align-middle ${bodyStripeClass(
                            effectiveRequiredStaffByTime.length + 2
                          )}`}
                        >
                          <textarea
                            className={`mx-auto h-6 w-56 resize-none rounded px-2 py-0.5 text-xs leading-tight ${
                              !sundayShiftInputEnabled && weekdayFromDateText(date) === 0
                                ? "cursor-not-allowed bg-gray-100 text-gray-500"
                                : "bg-white text-orange-900"
                            }`}
                            value={noteByDate[date] ?? ""}
                            disabled={!sundayShiftInputEnabled && weekdayFromDateText(date) === 0}
                            onChange={(event) =>
                              setNoteByDate((prev) => ({
                                ...prev,
                                [date]: event.target.value
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              ) : (
              <div className="min-w-max space-y-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="daily-view-date" className="text-sm font-semibold text-orange-800">
                    表示日
                  </label>
                  <select
                    id="daily-view-date"
                    className="rounded-md border border-orange-200 bg-white px-2 py-1 text-sm text-orange-900"
                    value={dailyViewDate}
                    onChange={(event) => setDailyViewDate(event.target.value)}
                  >
                    {dates.map((date) => {
                      const weekday = weekdayFromDateText(date);
                      return (
                        <option key={`daily-date-${date}`} value={date}>
                          {`${dayLabelFromDateText(date)} (${WEEKDAY_LABELS[weekday]})`}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <table className={`min-w-max border border-orange-200 ${compactClass}`}>
                  <thead className="bg-orange-100/70">
                    <tr>
                      <th className={`w-40 min-w-40 text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}>先生</th>
                      <th className={`w-32 min-w-32 text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}>シフト</th>
                      <th className={`w-32 min-w-32 text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}>勤務時間</th>
                      {dailyTimelineTimes.map((time, index) => (
                        <th
                          key={`daily-time-${time}`}
                          className={`min-w-14 whitespace-nowrap text-center align-middle text-[10px] font-semibold text-orange-900 ${compactHeadCellClass} ${headerStripeClass(
                            index
                          )}`}
                        >
                          {time}
                        </th>
                      ))}
                    </tr>
                    {(() => {
                      const coverageForDate = dailyCoverageByDate.get(dailyViewDate) ?? new Map<string, { required: number | null; assigned: number }>();
                      return (
                        <>
                          <tr>
                            <th
                              colSpan={3}
                              className={`whitespace-nowrap text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}
                            >
                              必要人数
                            </th>
                            {dailyTimelineTimes.map((time, index) => {
                              const required = coverageForDate.get(time)?.required ?? null;
                              return (
                                <th
                                  key={`daily-required-${dailyViewDate}-${time}`}
                                  className={`whitespace-nowrap text-center align-middle text-[10px] font-semibold text-orange-900 ${compactHeadCellClass} ${summaryStripeClass(
                                    index
                                  )}`}
                                >
                                  {required === null ? "-" : required}
                                </th>
                              );
                            })}
                          </tr>
                          <tr>
                            <th
                              colSpan={3}
                              className={`whitespace-nowrap text-center align-middle font-semibold text-orange-900 ${compactHeadCellClass}`}
                            >
                              配置人数
                            </th>
                            {dailyTimelineTimes.map((time, index) => {
                              const coverage = coverageForDate.get(time) ?? { required: null, assigned: 0 };
                              const isShortage = coverage.required !== null && coverage.assigned < coverage.required;
                              return (
                                <th
                                  key={`daily-assigned-${dailyViewDate}-${time}`}
                                  className={`whitespace-nowrap text-center align-middle text-[10px] font-semibold ${
                                    isShortage ? "text-red-600" : "text-orange-900"
                                  } ${compactHeadCellClass} ${summaryStripeClass(index)}`}
                                >
                                  {coverage.assigned}
                                </th>
                              );
                            })}
                          </tr>
                        </>
                      );
                    })()}
                  </thead>
                  <tbody>
                    {(dailyRowsByDate.get(dailyViewDate) ?? []).map((row, rowIndex) => (
                      <tr key={`daily-row-${dailyViewDate}-${row.name}`} className={`h-8 border-t border-orange-100 ${rowIndex % 2 === 0 ? "bg-white" : "bg-orange-50/30"}`}>
                        <td className={`whitespace-nowrap text-orange-900 ${compactBodyCellClass}`}>{row.name}</td>
                        <td className={`whitespace-nowrap text-center text-orange-900 ${compactBodyCellClass}`}>{row.shiftText}</td>
                        <td className={`whitespace-nowrap text-center text-orange-900 ${compactBodyCellClass}`}>{row.timeText}</td>
                        {dailyTimelineTimes.map((time, index) => {
                          const targetMinutes = timeToMinutes(time);
                          const isWorking = row.timelineShiftTypes.some((shiftType) => {
                            const pattern = shiftPatternByCode.get(shiftType);
                            if (!pattern) {
                              return false;
                            }
                            const start = timeToMinutes(pattern.startTime);
                            const end = timeToMinutes(pattern.endTime);
                            return targetMinutes >= start && targetMinutes < end;
                          });
                          return (
                            <td
                              key={`daily-cell-${dailyViewDate}-${row.name}-${time}`}
                              className={`h-8 min-w-14 border-l border-orange-100 ${isWorking ? "bg-orange-300/70 text-orange-900" : bodyStripeClass(index)}`}
                            >
                              {isWorking ? <span className="block text-center text-[10px] font-semibold">●</span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          </div>
        </section>

        {isMounted && showCreateStepModal
          ? createPortal(
          <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-4xl rounded-lg bg-white p-5 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-orange-900">作成ステップ</h3>
                  <p className="mt-1 text-sm text-orange-700">シフト作成ボタンから、モーダルで手順を順番に進めます。</p>
                </div>
                <button
                  className="rounded-md bg-orange-100 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-200"
                  onClick={() => setShowCreateStepModal(false)}
                >
                  閉じる
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-6">
                {stepDefinitions.map((step) => {
                  const active = plannerStep === step.id;
                  const completed = stepCompleted(step.id);
                  return (
                    <button
                      key={`modal-step-${step.id}`}
                      className={`rounded-md border px-3 py-3 text-left text-sm ${
                        active
                          ? "border-orange-400 bg-orange-100 text-orange-900"
                          : completed
                            ? "border-yellow-300 bg-yellow-50 text-yellow-800"
                            : "border-orange-200 bg-white text-orange-700"
                      }`}
                      onClick={() => setPlannerStep(step.id)}
                    >
                      <div className="font-semibold">Step {step.id}</div>
                      <div className="mt-1">{step.title}</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-sm font-semibold text-orange-800">現在: Step {plannerStep} / 6</p>

              <div className="mt-4 rounded-md bg-orange-50 p-3">
                {plannerStep === 1 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">
                      ルールを確認してください。「ルールを確認」を押すと管理画面を開きます。
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href="/data/shift-rules"
                        className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-md bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-200"
                      >
                        ルールを確認
                      </Link>
                    </div>
                  </div>
                ) : null}

                {plannerStep === 2 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">何月分のシフトを作成するかを選択してください。</p>
                    <div className="flex justify-center">
                      <label className="text-sm font-semibold text-orange-900">
                        月:
                        <input
                          type="month"
                          className="ml-2 h-11 rounded-md bg-white px-3 py-2 text-base"
                          value={month}
                          onChange={(event) => handleMonthChange(event.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {plannerStep === 3 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">休み入力ステップです。「入力」で先生別表示タブに移動します。</p>
                    <p className="text-sm text-orange-700">入力済み: {offRecordCount}件</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200"
                        onClick={() => {
                          setViewMode("staff");
                          setShowCreateStepModal(false);
                        }}
                      >
                        入力
                      </button>
                    </div>
                  </div>
                ) : null}

                {plannerStep === 4 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">イベント入力ステップです。休み入力と同じく「入力」または「次へ」で進めます。</p>
                    <p className="text-sm text-orange-700">入力済み: {eventInputCount}日</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200"
                        onClick={() => {
                          setViewMode("staff");
                          setShowCreateStepModal(false);
                        }}
                      >
                        入力
                      </button>
                    </div>
                  </div>
                ) : null}

                {plannerStep === 5 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">補足事項を入力してください。</p>
                    <textarea
                      className="h-24 w-full resize-y rounded bg-white px-2 py-1 text-sm text-orange-900"
                      value={supplementNote}
                      onChange={(event) => setSupplementNote(event.target.value)}
                      placeholder="例: 4/15は行事準備のため、午後はきりん組を厚めに配置したい"
                    />
                    <div className="flex justify-end">
                      <button
                        className="rounded bg-orange-100 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-60"
                        onClick={() => void handleInterpretSupplementNote()}
                        disabled={aiActionRunning || supplementNote.trim().length === 0}
                      >
                        {aiActionRunning ? "解析中..." : "AIで補足事項を解釈"}
                      </button>
                    </div>
                    {aiSupplementGuidance ? (
                      <p className="rounded bg-white px-3 py-2 text-sm text-orange-800">AI解釈: {aiSupplementGuidance}</p>
                    ) : null}
                  </div>
                ) : null}

                {plannerStep === 6 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-orange-900">準備完了です。自動作成を実行してください。</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        className="inline-flex min-h-11 min-w-44 items-center justify-center rounded-md bg-orange-500 px-4 py-2 text-base font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
                        onClick={() => handleAutoGenerateDraft()}
                        disabled={autoGenerating}
                      >
                        {autoGenerating ? "自動作成中..." : "自動作成を実行"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-3 border-t border-orange-200 pt-3">
                  <button
                    className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                    onClick={() => prevStep()}
                    disabled={plannerStep === 1}
                  >
                    前へ
                  </button>
                  {plannerStep < 6 ? (
                    <button
                      className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-md bg-orange-500 px-4 py-2 text-base font-semibold text-white hover:bg-orange-600"
                      onClick={() => nextStep()}
                    >
                      次へ
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
            ,
            document.body
          )
          : null}

        {addColumnBaseColumnId ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
              <h3 className="text-base font-semibold text-orange-900">右に列を追加</h3>
              <p className="mt-1 text-sm text-orange-700">追加するシフトパターンを選択してください。</p>
              <select
                className="mt-3 w-full rounded border border-orange-200 bg-white px-2 py-2 text-sm text-orange-900"
                value={addColumnShiftType}
                onChange={(event) => setAddColumnShiftType(event.target.value)}
              >
                {allShiftTypes.map((candidate) => {
                  const pattern = shiftPatternByCode.get(candidate);
                  const timeText = pattern ? `${pattern.startTime} - ${pattern.endTime}` : "時間未設定";
                  const customText = pattern?.isCustom ? " / カスタム" : "";
                  return (
                    <option key={candidate} value={candidate}>
                      {`${candidate}（${timeText}${customText}）`}
                    </option>
                  );
                })}
              </select>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
                  onClick={() => {
                    setAddColumnBaseColumnId(null);
                    setAddColumnShiftType("");
                  }}
                >
                  キャンセル
                </button>
                <button
                  className="rounded bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600"
                  onClick={() => handleAddShiftTypeRight(addColumnBaseColumnId, addColumnShiftType)}
                >
                  追加する
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteTargetColumnId ? (
          <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/40">
            <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
              <h3 className="text-base font-semibold text-orange-900">列削除の確認</h3>
              <p className="mt-1 text-sm text-orange-700">この列を削除してよいですか？</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
                  onClick={() => setDeleteTargetColumnId(null)}
                >
                  キャンセル
                </button>
                <button
                  className="rounded bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
                  onClick={() => confirmDeleteShiftColumn()}
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showShortageModal ? (
          <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/40">
            <div className="mx-4 w-full max-w-2xl rounded-lg bg-white p-4 shadow-lg">
              <h3 className="text-base font-semibold text-orange-900">必要人数に対して不足があります</h3>
              <p className="mt-1 text-sm text-orange-700">不足を確認したうえで、このまま保存することもできます。</p>
              <div className="mt-3 max-h-72 overflow-auto rounded border border-orange-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-orange-100/70">
                    <tr>
                      <th className="px-3 py-2 text-left text-orange-900">日付</th>
                      <th className="px-3 py-2 text-left text-orange-900">時刻</th>
                      <th className="px-3 py-2 text-left text-orange-900">必要</th>
                      <th className="px-3 py-2 text-left text-orange-900">配置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shortageItems.map((item, index) => (
                      <tr key={`${item.date}-${item.time}-${index}`} className="odd:bg-orange-50/40">
                        <td className="px-3 py-2 text-orange-900">{item.date}</td>
                        <td className="px-3 py-2 text-orange-900">{item.time}</td>
                        <td className="px-3 py-2 font-semibold text-orange-900">{item.required}人</td>
                        <td className="px-3 py-2 font-semibold text-red-600">{item.assigned}人</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
                  onClick={() => setShowShortageModal(false)}
                >
                  キャンセル
                </button>
                <button
                  className="rounded bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600"
                  onClick={() => {
                    setShowShortageModal(false);
                    void performSaveMonth();
                  }}
                >
                  このまま保存
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showResetRequiredModal ? (
          <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/40">
            <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
              <h3 className="text-base font-semibold text-orange-900">必要人数リセットの確認</h3>
              <p className="mt-1 text-sm text-orange-700">
                手動で修正した必要人数（通常/土曜）を自動計算値に戻します。よろしいですか？
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
                  onClick={() => setShowResetRequiredModal(false)}
                >
                  キャンセル
                </button>
                <button
                  className="rounded bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
                  onClick={() => {
                    setShowResetRequiredModal(false);
                    resetRequiredStaffToCalculated();
                  }}
                >
                  リセットする
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
