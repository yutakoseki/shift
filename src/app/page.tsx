"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MasterData, PartTimeStaff } from "@/types/master-data";
import { SHIFT_CLASS_GROUPS, ShiftClassGroup, ShiftColumn, ShiftEntry, ShiftMonthResponse } from "@/types/shift";
import FullscreenLoading from "@/components/fullscreen-loading";

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
  const [_, __, dayText] = date.split("-");
  const dayNumber = Number(dayText);
  return Number.isFinite(dayNumber) ? String(dayNumber) : date;
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
  const [viewMode, setViewMode] = useState<"class" | "staff">("class");

  const dates = useMemo(() => monthToDates(month), [month]);
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

        let requiredCountForWeekday = 0;
        childCountByAge.forEach((childCount, age) => {
          const ratio = resolveRatioForAge(age, ratioByAge);
          if (!ratio || ratio <= 0) {
            return;
          }
          requiredCountForWeekday += Math.ceil(childCount / ratio);
        });

        if (requiredCountForWeekday > maxRequiredCount) {
          maxRequiredCount = requiredCountForWeekday;
        }
      }

      return { time, requiredCount: maxRequiredCount };
    });
  }, [masterData, month]);

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
      requiredStaffByTime.forEach((required, index) => {
        const assigned = assignedCounts[index] ?? 0;
        if (assigned < required.requiredCount) {
          items.push({
            date,
            time: required.time,
            required: required.requiredCount,
            assigned
          });
        }
      });
    }
    return items;
  }, [assignedTotalStaffCountByDate, dates, requiredStaffByTime]);

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

  const persistShiftColumns = useCallback(
    async (columns: ShiftColumn[]): Promise<void> => {
      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          entries: buildEntriesFromColumns(columns),
          columns
        })
      });
      if (!response.ok) {
        throw new Error("列構成の保存に失敗しました");
      }
    },
    [buildEntriesFromColumns, month]
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
        body: JSON.stringify({ month, entries: buildEntriesFromColumns(shiftColumns), columns: shiftColumns })
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

  return (
    <>
      {loadingData || loadingMasterData ? <FullscreenLoading /> : null}
      <main className="space-y-4 p-4 md:p-6">
        <section className="rounded-xl bg-white p-4 shadow-sm">
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
                onChange={(event) => setMonth(event.target.value)}
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
          </div>
        </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-orange-700">
            必要先生人数は、各時刻について曜日別に算出した人数の最大値を表示しています。
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                viewMode === "class" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
              }`}
              onClick={() => setViewMode("class")}
            >
              クラス別表示
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                viewMode === "staff" ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
              }`}
              onClick={() => setViewMode("staff")}
            >
              先生別表示
            </button>
          </div>
          <div className="mt-3 overflow-auto">
            {viewMode === "class" ? (
              <div className="flex min-w-max items-start">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="bg-orange-100/70 px-3 py-2 text-left font-semibold text-orange-900">日付</th>
                      <th className="bg-orange-100/70 px-3 py-2 text-left font-semibold text-orange-900">クラス区分</th>
                      {shiftColumns.map((column, columnIndex) => (
                        <th
                          key={column.id}
                          className={`relative cursor-pointer px-3 py-2 text-center font-semibold text-orange-900 ${headerStripeClass(columnIndex)}`}
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
                            <div className="text-center text-xs font-normal text-orange-700">
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
                      const dateText = `${dayLabelFromDateText(date)} (${WEEKDAY_LABELS[weekday]})`;
                      const dateTextClass = weekday === 0 ? "text-red-600" : weekday === 6 ? "text-blue-600" : "text-orange-900";

                      const classRows = SHIFT_CLASS_GROUPS.map((classGroup, classIndex) => (
                        <tr
                          key={`${date}-${classGroup.key}`}
                          className={classIndex === 0 ? "border-t-2 border-orange-200" : undefined}
                        >
                          {classIndex === 0 ? (
                            <td rowSpan={DATE_GROUP_ROW_COUNT} className={`px-3 py-2 text-center align-middle ${dateTextClass}`}>
                              {dateText}
                            </td>
                          ) : null}
                          <td className="whitespace-nowrap px-3 py-2 text-orange-800">{classGroup.label}</td>
                          {shiftColumns.map((column, columnIndex) => {
                            const key = keyOf(date, column.id, classGroup.key);
                            const currentValue = cells[key] ?? "";
                            const warnings = ruleWarnings(date, column.shiftType, currentValue);
                            const options = selectableStaffNames(date, column.shiftType, currentValue);
                            return (
                              <td key={`${classGroup.key}-${column.id}`} className={`p-1 ${bodyStripeClass(columnIndex)}`}>
                                <select
                                  className="w-full rounded bg-white px-2 py-1 outline-none focus:bg-orange-50"
                                  value={currentValue}
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
                        <tr key={`${date}-total`} className="border-b-2 border-orange-200 bg-orange-100/40">
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-orange-900">合計（対人数）</td>
                          {shiftColumns.map((column, columnIndex) => (
                            <td
                              key={`total-${date}-${column.id}`}
                              className={`px-3 py-2 text-center text-xs text-orange-500 ${summaryStripeClass(columnIndex)}`}
                            />
                          ))}
                        </tr>
                      );

                      return [...classRows, totalRow];
                    })}
                  </tbody>
                </table>

                <table className="border-l border-orange-200 text-sm">
                  <tbody>
                    <tr className="h-[26px] bg-orange-100/70">
                      {requiredStaffByTime.map((item, columnIndex) => (
                        <th
                          key={item.time}
                          className={`h-[26px] whitespace-nowrap px-3 py-0 text-left align-middle font-semibold text-orange-900 ${headerStripeClass(columnIndex)}`}
                        >
                          {item.time}
                        </th>
                      ))}
                    </tr>
                    <tr className="h-[26px] odd:bg-orange-50/50">
                      {requiredStaffByTime.map((item, columnIndex) => (
                        <td
                          key={`required-${item.time}`}
                          className={`h-[26px] whitespace-nowrap px-3 py-0 align-middle font-semibold text-orange-900 ${summaryStripeClass(columnIndex)}`}
                        >
                          {item.requiredCount}人
                        </td>
                      ))}
                    </tr>
                    {dates.flatMap((date) =>
                      [
                        ...SHIFT_CLASS_GROUPS.map((classGroup, classIndex) => {
                          const counts = assignedStaffCountByDateAndClass.get(`${date}|${classGroup.key}`) ?? REQUIRED_STAFF_TIMES.map(() => 0);
                          return (
                            <tr
                              key={`assigned-${date}-${classGroup.key}`}
                              className={classIndex === 0 ? "border-t-2 border-orange-200" : undefined}
                            >
                              {counts.map((count, columnIndex) => (
                                <td
                                  key={`${date}-${classGroup.key}-${REQUIRED_STAFF_TIMES[columnIndex]}`}
                                  className={`whitespace-nowrap px-3 py-2 text-orange-900 ${bodyStripeClass(columnIndex)}`}
                                >
                                  {count}人
                                </td>
                              ))}
                            </tr>
                          );
                        }),
                        <tr key={`assigned-${date}-total`} className="border-b-2 border-orange-200 bg-orange-100/40">
                          {(assignedTotalStaffCountByDate.get(date) ?? REQUIRED_STAFF_TIMES.map(() => 0)).map((count, columnIndex) => (
                            <td
                              key={`${date}-total-${REQUIRED_STAFF_TIMES[columnIndex]}`}
                              className={`whitespace-nowrap px-3 py-2 font-semibold ${
                                count < (requiredStaffByTime[columnIndex]?.requiredCount ?? 0) ? "text-red-600" : "text-orange-900"
                              } ${summaryStripeClass(columnIndex)}`}
                            >
                              {count}人
                            </td>
                          ))}
                        </tr>
                      ]
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-orange-100/70">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-orange-900">日付</th>
                    {allStaffNames.map((name, index) => (
                      <th
                        key={`${name}-${index}`}
                        className={`whitespace-nowrap px-3 py-2 text-center font-semibold text-orange-900 ${headerStripeClass(index)}`}
                      >
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date) => {
                    const weekday = weekdayFromDateText(date);
                    const dateText = `${dayLabelFromDateText(date)} (${WEEKDAY_LABELS[weekday]})`;
                    const dateTextClass = weekday === 0 ? "text-red-600" : weekday === 6 ? "text-blue-600" : "text-orange-900";
                    const rowMap = shiftCodesByDateAndStaff.get(date) ?? new Map<string, string>();
                    const assignmentMap = primaryAssignmentByDateAndStaff.get(date) ?? new Map<string, { shiftType: string; classGroup: ShiftClassGroup; count: number }>();
                    return (
                      <tr key={`staff-view-${date}`} className="border-t border-orange-100 odd:bg-orange-50/30">
                        <td className={`whitespace-nowrap px-3 py-2 text-center font-semibold ${dateTextClass}`}>{dateText}</td>
                        {allStaffNames.map((name, index) => {
                          const assignment = assignmentMap.get(name);
                          const offKey = `${date}|${name}`;
                          const currentShiftType = offByDateAndStaff[offKey] ? "__OFF__" : assignment?.shiftType ?? "";
                          const selectable = selectableShiftTypesForStaffView.filter(
                            (shiftType) => shiftType === currentShiftType || canWorkOnShift(date, shiftType, name)
                          );
                          return (
                          <td
                            key={`staff-view-${date}-${name}-${index}`}
                            className={`whitespace-nowrap px-3 py-2 text-center text-orange-900 ${bodyStripeClass(index)}`}
                          >
                            <select
                              className="w-full rounded bg-white px-2 py-1 text-sm outline-none focus:bg-orange-50"
                              value={currentShiftType}
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
            )}
          </div>
        </section>

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
      </main>
    </>
  );
}
