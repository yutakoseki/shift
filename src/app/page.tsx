"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MasterData, PartTimeStaff } from "@/types/master-data";
import { ShiftEntry, ShiftMonthResponse } from "@/types/shift";

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

function keyOf(date: string, shiftType: string): string {
  return `${date}|${shiftType}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export default function HomePage() {
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMasterData, setLoadingMasterData] = useState(false);
  const [masterData, setMasterData] = useState<MasterData | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [cells, setCells] = useState<Record<string, string>>({});

  const dates = useMemo(() => monthToDates(month), [month]);
  const shiftPatterns = useMemo(() => masterData?.shiftPatterns ?? [], [masterData]);
  const shiftTypes = useMemo(() => {
    const values = shiftPatterns.map((pattern) => pattern.code.trim()).filter((code) => code.length > 0);
    return values.length > 0 ? values : ["早番", "中番", "遅番"];
  }, [shiftPatterns]);

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
        nextCells[keyOf(entry.date, entry.shiftType)] = entry.staffName;
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
        for (const shiftType of shiftTypes) {
          const staffName = (cells[keyOf(date, shiftType)] ?? "").trim();
          if (staffName.length > 0) {
            entries.push({ date, shiftType, staffName });
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

  return (
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

      <section className="overflow-auto rounded-xl bg-white shadow-sm">
        {loadingMasterData ? <p className="px-4 py-3 text-sm text-orange-700">マスターデータを読込中...</p> : null}
        <table className="min-w-full text-sm">
          <thead className="bg-orange-100/70">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-orange-900">日付</th>
              {shiftTypes.map((type) => (
                <th key={type} className="px-3 py-2 text-left font-semibold text-orange-900">
                  <div>{type}</div>
                  {shiftPatternByCode.get(type) ? (
                    <div className="text-xs font-normal text-orange-700">
                      {shiftPatternByCode.get(type)?.startTime} - {shiftPatternByCode.get(type)?.endTime}
                    </div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date} className="odd:bg-orange-50/50">
                <td className="px-3 py-2 text-orange-900">{date}</td>
                {shiftTypes.map((shiftType) => {
                  const key = keyOf(date, shiftType);
                  const warnings = ruleWarnings(date, shiftType, cells[key] ?? "");
                  return (
                    <td key={shiftType} className="p-1">
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
                        <option value="">未割当</option>
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
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
