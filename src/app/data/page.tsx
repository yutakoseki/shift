"use client";

import { useState } from "react";
import { ShiftMonthResponse } from "@/types/shift";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function DataPage() {
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ShiftMonthResponse["entries"]>([]);
  const [error, setError] = useState("");

  async function fetchData(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/shifts?month=${month}`);
      if (!response.ok) {
        throw new Error("データ取得に失敗しました。");
      }
      const data = (await response.json()) as ShiftMonthResponse;
      setEntries(data.entries);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "データ取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-orange-900">データ管理</h1>
        <p className="mt-1 text-sm text-orange-700">保存済みシフトデータを月単位で確認できます。</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
            className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
            onClick={() => void fetchData()}
            disabled={loading}
          >
            {loading ? "読込中..." : "取得"}
          </button>
        </div>
      </section>

      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">データ一覧</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-orange-700">データがありません。月を選択して取得してください。</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {entries.map((entry) => (
              <li key={`${entry.date}-${entry.shiftType}`} className="rounded-md bg-orange-50 px-3 py-2 text-orange-900">
                {entry.date} / {entry.shiftType} / {entry.staffName}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
