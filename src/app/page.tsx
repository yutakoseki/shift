"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { ShiftEntry, ShiftMonthResponse, ShiftType } from "@/types/shift";

const SHIFT_TYPES: ShiftType[] = ["早番", "中番", "遅番"];

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

function keyOf(date: string, shiftType: ShiftType): string {
  return `${date}|${shiftType}`;
}

export default function HomePage() {
  const router = useRouter();
  configureAmplify();

  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [cells, setCells] = useState<Record<string, string>>({});

  const dates = useMemo(() => monthToDates(month), [month]);

  useEffect(() => {
    void getCurrentUser()
      .then(() => setLoadingAuth(false))
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

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
    if (!loadingAuth) {
      void loadMonth();
    }
  }, [loadingAuth, loadMonth]);

  async function saveMonth(): Promise<void> {
    setSaving(true);
    try {
      const entries: ShiftEntry[] = [];
      for (const date of dates) {
        for (const shiftType of SHIFT_TYPES) {
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

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.replace("/login");
  }

  if (loadingAuth) {
    return <main className="p-6">認証確認中...</main>;
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">保育園シフト管理</h1>
            <p className="text-sm text-slate-600">縦: 日付 / 横: シフト区分（早番・中番・遅番）</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">
              月:
              <input
                type="month"
                className="ml-2 rounded-md border border-slate-300 px-2 py-1"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => void loadMonth()}
              disabled={loadingData}
            >
              再読込
            </button>
            <button
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              onClick={() => void saveMonth()}
              disabled={saving || loadingData}
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => void handleSignOut()}
            >
              ログアウト
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="border border-slate-200 px-3 py-2 text-left font-semibold">日付</th>
              {SHIFT_TYPES.map((type) => (
                <th key={type} className="border border-slate-200 px-3 py-2 text-left font-semibold">
                  {type}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date}>
                <td className="border border-slate-200 px-3 py-2">{date}</td>
                {SHIFT_TYPES.map((shiftType) => {
                  const key = keyOf(date, shiftType);
                  return (
                    <td key={shiftType} className="border border-slate-200 p-1">
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1"
                        value={cells[key] ?? ""}
                        onChange={(event) =>
                          setCells((prev) => ({
                            ...prev,
                            [key]: event.target.value
                          }))
                        }
                        placeholder="担当者名"
                      />
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
