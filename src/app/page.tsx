"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MasterData, PartTimeStaff } from "@/types/master-data";
import { SHIFT_CLASS_GROUPS, ShiftClassGroup, ShiftEntry, ShiftMonthResponse } from "@/types/shift";
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

function keyOf(date: string, shiftType: string, classGroup: ShiftClassGroup): string {
  return `${date}|${classGroup}|${shiftType}`;
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
  const [visibleShiftTypes, setVisibleShiftTypes] = useState<string[]>(["早番", "中番", "遅番"]);
  const [headerMenuShiftType, setHeaderMenuShiftType] = useState<string | null>(null);
  const [addColumnBaseShiftType, setAddColumnBaseShiftType] = useState<string | null>(null);
  const [addColumnShiftType, setAddColumnShiftType] = useState("");

  const dates = useMemo(() => monthToDates(month), [month]);
  const shiftPatterns = useMemo(() => masterData?.shiftPatterns ?? [], [masterData]);
  const allShiftTypes = useMemo(() => {
    const values = shiftPatterns.map((pattern) => pattern.code.trim()).filter((code) => code.length > 0);
    return values.length > 0 ? values : ["早番", "中番", "遅番"];
  }, [shiftPatterns]);
  const shiftTypes = visibleShiftTypes;
  const addableShiftTypes = useMemo(
    () => allShiftTypes.filter((shiftType) => !shiftTypes.includes(shiftType)),
    [allShiftTypes, shiftTypes]
  );

  useEffect(() => {
    setVisibleShiftTypes((prev) => {
      const preserved = prev.filter((shiftType) => allShiftTypes.includes(shiftType));
      return preserved.length > 0 ? preserved : allShiftTypes;
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
          for (const shiftType of shiftTypes) {
            const staffName = (cells[keyOf(date, shiftType, classGroup.key)] ?? "").trim();
            if (!staffName) {
              continue;
            }
            const pattern = shiftPatternByCode.get(shiftType);
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
  }, [cells, dates, shiftPatternByCode, shiftTypes]);

  const assignedTotalStaffCountByDate = useMemo(() => {
    const countByDate = new Map<string, number[]>();
    for (const date of dates) {
      const counts = REQUIRED_STAFF_TIMES.map((time) => {
        const targetMinutes = timeToMinutes(time);
        const presentStaff = new Set<string>();
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const shiftType of shiftTypes) {
            const staffName = (cells[keyOf(date, shiftType, classGroup.key)] ?? "").trim();
            if (!staffName) {
              continue;
            }
            const pattern = shiftPatternByCode.get(shiftType);
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
  }, [cells, dates, shiftPatternByCode, shiftTypes]);

  const loadMonth = useCallback(async () => {
    setLoadingData(true);
    try {
      const response = await fetch(`/api/shifts?month=${month}`);
      if (!response.ok) {
        throw new Error("シフト取得に失敗しました");
      }
      const data = (await response.json()) as ShiftMonthResponse;
      const nextCells: Record<string, string> = {};
      data.entries.forEach((entry) => {
        const classGroup = entry.classGroup ?? "0-1";
        nextCells[keyOf(entry.date, entry.shiftType, classGroup)] = entry.staffName;
      });
      setCells(nextCells);
    } finally {
      setLoadingData(false);
    }
  }, [month]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  async function saveMonth(): Promise<void> {
    setSaving(true);
    try {
      const entries: ShiftEntry[] = [];
      for (const date of dates) {
        for (const classGroup of SHIFT_CLASS_GROUPS) {
          for (const shiftType of shiftTypes) {
            const staffName = (cells[keyOf(date, shiftType, classGroup.key)] ?? "").trim();
            if (staffName.length > 0) {
              entries.push({ date, classGroup: classGroup.key, shiftType, staffName });
            }
          }
        }
      }

      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, entries })
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

  function handleDeleteShiftType(shiftType: string): void {
    if (shiftTypes.length <= 1) {
      alert("最低1つはシフトヘッダーを残してください。");
      return;
    }
    setVisibleShiftTypes((prev) => prev.filter((item) => item !== shiftType));
    setHeaderMenuShiftType(null);
  }

  function handleAddShiftTypeRight(baseShiftType: string, nextType: string): void {
    if (!nextType) {
      alert("追加するシフトパターンを選択してください。");
      return;
    }
    if (!addableShiftTypes.includes(nextType)) {
      alert("追加できるシフトヘッダーがありません。");
      return;
    }
    setVisibleShiftTypes((prev) => {
      if (prev.includes(nextType)) {
        return prev;
      }
      const index = prev.indexOf(baseShiftType);
      if (index < 0) {
        return [...prev, nextType];
      }
      const next = [...prev];
      next.splice(index + 1, 0, nextType);
      return next;
    });
    setHeaderMenuShiftType(null);
    setAddColumnBaseShiftType(null);
    setAddColumnShiftType("");
  }

  function openAddColumnModal(baseShiftType: string): void {
    if (addableShiftTypes.length === 0) {
      alert("追加できるシフトヘッダーがありません。");
      return;
    }
    setAddColumnBaseShiftType(baseShiftType);
    setAddColumnShiftType(addableShiftTypes[0]);
    setHeaderMenuShiftType(null);
  }

  useEffect(() => {
    if (!headerMenuShiftType) {
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
      setHeaderMenuShiftType(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [headerMenuShiftType]);

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
          <div className="mt-3 overflow-auto">
            <div className="flex min-w-max items-start">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="bg-orange-100/70 px-3 py-2 text-left font-semibold text-orange-900">日付</th>
                    <th className="bg-orange-100/70 px-3 py-2 text-left font-semibold text-orange-900">クラス区分</th>
                    {shiftTypes.map((type, columnIndex) => (
                      <th
                        key={type}
                        className={`relative cursor-pointer px-3 py-2 text-center font-semibold text-orange-900 ${headerStripeClass(columnIndex)}`}
                        onMouseDown={(event) => {
                          const target = event.target;
                          if (target instanceof Element && target.closest('[data-header-menu="true"]')) {
                            return;
                          }
                          event.preventDefault();
                          setHeaderMenuShiftType((prev) => (prev === type ? null : type));
                        }}
                        data-header-trigger="true"
                      >
                        <div className="text-center">{type}</div>
                        {shiftPatternByCode.get(type) ? (
                          <div className="text-center text-xs font-normal text-orange-700">
                            {shiftPatternByCode.get(type)?.startTime} - {shiftPatternByCode.get(type)?.endTime}
                          </div>
                        ) : null}
                        {headerMenuShiftType === type ? (
                          <div
                            className="absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 rounded-md border border-orange-200 bg-white p-1 shadow-md"
                            data-header-menu="true"
                          >
                            <button
                              className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs text-orange-800 hover:bg-orange-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAddColumnModal(type);
                              }}
                            >
                              右に列を追加
                            </button>
                            <button
                              className="mt-1 block w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteShiftType(type);
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
                        {shiftTypes.map((shiftType, columnIndex) => {
                          const key = keyOf(date, shiftType, classGroup.key);
                          const warnings = ruleWarnings(date, shiftType, cells[key] ?? "");
                          return (
                            <td key={`${classGroup.key}-${shiftType}`} className={`p-1 ${bodyStripeClass(columnIndex)}`}>
                              <select
                                className="w-full rounded bg-white px-2 py-1 outline-none focus:bg-orange-50"
                                value={cells[key] ?? ""}
                                onChange={(event) =>
                                  setCells((prev) => ({
                                    ...prev,
                                    [key]: event.target.value
                                  }))
                                }
                              >
                                <option value="" />
                                {allStaffNames.map((name) => (
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
                        {shiftTypes.map((shiftType, columnIndex) => (
                          <td
                            key={`total-${date}-${shiftType}`}
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
                            className={`whitespace-nowrap px-3 py-2 font-semibold text-orange-900 ${summaryStripeClass(columnIndex)}`}
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
          </div>
        </section>

        {addColumnBaseShiftType ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
              <h3 className="text-base font-semibold text-orange-900">右に列を追加</h3>
              <p className="mt-1 text-sm text-orange-700">追加するシフトパターンを選択してください。</p>
              <select
                className="mt-3 w-full rounded border border-orange-200 bg-white px-2 py-2 text-sm text-orange-900"
                value={addColumnShiftType}
                onChange={(event) => setAddColumnShiftType(event.target.value)}
              >
                {addableShiftTypes.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-200"
                  onClick={() => {
                    setAddColumnBaseShiftType(null);
                    setAddColumnShiftType("");
                  }}
                >
                  キャンセル
                </button>
                <button
                  className="rounded bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600"
                  onClick={() => handleAddShiftTypeRight(addColumnBaseShiftType, addColumnShiftType)}
                >
                  追加する
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
