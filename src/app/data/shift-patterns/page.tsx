"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MasterData, ShiftPattern } from "@/types/master-data";
import { UserRole } from "@/types/user";
import { fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";

export default function ShiftPatternsPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedFlags, setPersistedFlags] = useState<boolean[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [actionLoadingIndex, setActionLoadingIndex] = useState<number | null>(null);
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
        setPersistedFlags(masterData.shiftPatterns.map(() => true));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "読込に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleUpsert(index: number): Promise<void> {
    if (!data) {
      return;
    }
    const target = data.shiftPatterns[index];
    if (!target) {
      return;
    }
    if (!target.code.trim() || !target.startTime || !target.endTime) {
      setError("コードと時間を入力してください。");
      return;
    }

    setActionLoadingIndex(index);
    setActionLabel(persistedFlags[index] ? "更新中..." : "登録中...");
    setError("");
    try {
      await saveMasterData(data);
      setPersistedFlags((prev) => prev.map((flag, i) => (i === index ? true : flag)));
      setEditingIndex(null);
      showToast(persistedFlags[index] ? "更新しました" : "登録しました");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登録/更新に失敗しました。");
    } finally {
      setActionLoadingIndex(null);
      setActionLabel("");
    }
  }

  async function handleDelete(index: number): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    const previousData = data;
    const previousFlags = persistedFlags;
    const nextData: MasterData = {
      ...data,
      shiftPatterns: data.shiftPatterns.filter((_, itemIndex) => itemIndex !== index)
    };
    const nextFlags = persistedFlags.filter((_, itemIndex) => itemIndex !== index);

    setActionLoadingIndex(index);
    setActionLabel("削除中...");
    setError("");
    setData(nextData);
    setPersistedFlags(nextFlags);
    try {
      await saveMasterData(nextData);
      showToast("削除しました");
    } catch (requestError) {
      setData(previousData);
      setPersistedFlags(previousFlags);
      setError(requestError instanceof Error ? requestError.message : "削除に失敗しました。");
    } finally {
      setActionLoadingIndex(null);
      setActionLabel("");
    }
  }

  function updatePattern(index: number, patch: Partial<ShiftPattern>): void {
    setData((prev) =>
      prev
        ? {
            ...prev,
            shiftPatterns: prev.shiftPatterns.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
          }
        : prev
    );
  }

  if (loading) {
    return <main className="p-6 text-orange-900">読込中...</main>;
  }

  if (!data) {
    return <main className="p-6 text-red-600">データ取得に失敗しました。</main>;
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-orange-900">シフトパターン管理</h1>
            <p className="text-sm text-orange-700">A1〜D4 とカスタムシフトを管理します。</p>
          </div>
          <Link href="/data" className="rounded-md bg-orange-100 px-3 py-1 text-sm text-orange-700 hover:bg-orange-200">
            戻る
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {role === "管理者" ? (
            <button
              className="rounded-md bg-orange-100 px-3 py-1 text-sm text-orange-700 hover:bg-orange-200"
              onClick={() => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        shiftPatterns: [...prev.shiftPatterns, { code: "", label: "", startTime: "09:00", endTime: "15:00", isCustom: true }]
                      }
                    : prev
                );
                setPersistedFlags((prev) => [...prev, false]);
              }}
            >
              カスタム追加
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="space-y-2">
          {data.shiftPatterns.map((pattern, index) => (
            <div key={`${pattern.code}-${index}`} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <input
                className="rounded bg-white px-2 py-1 md:col-span-2"
                placeholder="コード"
                value={pattern.code}
                disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                onChange={(event) => updatePattern(index, { code: event.target.value, label: event.target.value })}
              />
              <input
                className="rounded bg-white px-2 py-1 md:col-span-3"
                placeholder="表示名"
                value={pattern.label}
                disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                onChange={(event) => updatePattern(index, { label: event.target.value })}
              />
              <input
                className="rounded bg-white px-2 py-1 md:col-span-2"
                type="time"
                value={pattern.startTime}
                disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                onChange={(event) => updatePattern(index, { startTime: event.target.value })}
              />
              <input
                className="rounded bg-white px-2 py-1 md:col-span-2"
                type="time"
                value={pattern.endTime}
                disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                onChange={(event) => updatePattern(index, { endTime: event.target.value })}
              />
              <label className="flex items-center gap-2 text-sm text-orange-800 md:col-span-2">
                <input
                  type="checkbox"
                  checked={pattern.isCustom}
                  disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                  onChange={(event) => updatePattern(index, { isCustom: event.target.checked })}
                />
                カスタム
              </label>
              <div className="flex items-center justify-end gap-2 md:col-span-1">
                {role === "管理者" ? (
                  <button
                    className="rounded bg-orange-500 px-2 py-1 text-white hover:bg-orange-600 disabled:opacity-60"
                    onClick={() => {
                      if (persistedFlags[index] && editingIndex !== index) {
                        setEditingIndex(index);
                        return;
                      }
                      void handleUpsert(index);
                    }}
                    disabled={actionLoadingIndex !== null}
                  >
                    {actionLoadingIndex === index ? actionLabel : persistedFlags[index] ? (editingIndex === index ? "更新" : "編集") : "登録"}
                  </button>
                ) : null}
                {role === "管理者" ? (
                  <button
                    className="rounded bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200 disabled:opacity-60"
                    onClick={() => void handleDelete(index)}
                    disabled={actionLoadingIndex !== null}
                  >
                    削除
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
