"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MasterData, PartTimeStaff } from "@/types/master-data";
import { UserRole } from "@/types/user";
import {
  WEEKDAYS,
  createId,
  fetchCurrentUserRole,
  fetchMasterData,
  includesWeekday,
  parsePatternCodes,
  saveMasterData,
  showToast
} from "@/lib/master-data-client";

export default function PartTimeStaffPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedIds, setPersistedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
        setPersistedIds(masterData.partTimeStaff.map((item) => item.id));
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

    const target = data.partTimeStaff[index];
    if (!target) {
      return;
    }
    if (!target.name.trim()) {
      setError("名前を入力してください。");
      return;
    }

    setActionLoadingId(target.id);
    setActionLabel(persistedIds.includes(target.id) ? "更新中..." : "登録中...");
    setError("");
    try {
      await saveMasterData(data);
      if (!persistedIds.includes(target.id)) {
        setPersistedIds((prev) => [...prev, target.id]);
      }
      setEditingId("");
      showToast(persistedIds.includes(target.id) ? "更新しました" : "登録しました");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登録/更新に失敗しました。");
    } finally {
      setActionLoadingId("");
      setActionLabel("");
    }
  }

  async function handleDelete(index: number): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    const target = data.partTimeStaff[index];
    if (!target) {
      return;
    }

    const previousData = data;
    const nextData: MasterData = {
      ...data,
      partTimeStaff: data.partTimeStaff.filter((_, itemIndex) => itemIndex !== index)
    };

    setActionLoadingId(target.id);
    setActionLabel("削除中...");
    setError("");
    setData(nextData);
    try {
      await saveMasterData(nextData);
      setPersistedIds((prev) => prev.filter((id) => id !== target.id));
      showToast("削除しました");
    } catch (requestError) {
      setData(previousData);
      setError(requestError instanceof Error ? requestError.message : "削除に失敗しました。");
    } finally {
      setActionLoadingId("");
      setActionLabel("");
    }
  }

  function updateStaff(index: number, patch: Partial<PartTimeStaff>): void {
    setData((prev) =>
      prev
        ? {
            ...prev,
            partTimeStaff: prev.partTimeStaff.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
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
            <h1 className="text-2xl font-bold text-orange-900">パートの先生管理</h1>
            <p className="text-sm text-orange-700">勤務条件（曜日・時間・週回数・可能シフト）を管理します。</p>
          </div>
          <Link href="/data" className="rounded-md bg-orange-100 px-3 py-1 text-sm text-orange-700 hover:bg-orange-200">
            戻る
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {role === "管理者" ? (
            <button
              className="rounded-md bg-orange-100 px-3 py-1 text-sm text-orange-700 hover:bg-orange-200"
              onClick={() =>
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        partTimeStaff: [
                          ...prev.partTimeStaff,
                          {
                            id: createId("part"),
                            name: "",
                            mainClass: "",
                            availableWeekdays: [1, 2, 3, 4, 5],
                            availableStartTime: "09:00",
                            availableEndTime: "18:00",
                            possibleShiftPatternCodes: [],
                            defaultShiftPatternCode: "",
                            weeklyDays: 3,
                            notes: ""
                          }
                        ]
                      }
                    : prev
                )
              }
            >
              追加
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="space-y-2">
          {data.partTimeStaff.map((staff, index) => (
            <div key={staff.id} className="space-y-2 rounded-md bg-orange-50 p-3">
              <div className="grid gap-2 md:grid-cols-12">
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  placeholder="名前"
                  value={staff.name}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { name: event.target.value })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  placeholder="主な担当クラス"
                  value={staff.mainClass}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { mainClass: event.target.value })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  type="time"
                  value={staff.availableStartTime}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { availableStartTime: event.target.value })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  type="time"
                  value={staff.availableEndTime}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { availableEndTime: event.target.value })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-4"
                  placeholder="可能シフトパターン（例: A1,B1）"
                  value={staff.possibleShiftPatternCodes.join(",")}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { possibleShiftPatternCodes: parsePatternCodes(event.target.value) })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-2"
                  placeholder="デフォルトパターン"
                  value={staff.defaultShiftPatternCode}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { defaultShiftPatternCode: event.target.value })}
                />
                <label className="flex items-center gap-2 text-sm text-orange-900 md:col-span-2">
                  週
                  <input
                    className="w-16 rounded bg-white px-2 py-1"
                    type="number"
                    min={1}
                    value={staff.weeklyDays}
                    disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                    onChange={(event) => updateStaff(index, { weeklyDays: Number(event.target.value) || 1 })}
                  />
                  回
                </label>
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  placeholder="その他"
                  value={staff.notes}
                  disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                  onChange={(event) => updateStaff(index, { notes: event.target.value })}
                />
                <div className="flex items-center justify-end gap-2 md:col-span-1">
                  {role === "管理者" ? (
                    <button
                      className="rounded bg-orange-500 px-2 py-1 text-white hover:bg-orange-600 disabled:opacity-60"
                    onClick={() => {
                      const isPersisted = persistedIds.includes(staff.id);
                      if (isPersisted && editingId !== staff.id) {
                        setEditingId(staff.id);
                        return;
                      }
                      void handleUpsert(index);
                    }}
                      disabled={Boolean(actionLoadingId)}
                    >
                      {actionLoadingId === staff.id
                        ? actionLabel
                        : persistedIds.includes(staff.id)
                          ? editingId === staff.id
                            ? "更新"
                            : "編集"
                          : "登録"}
                    </button>
                  ) : null}
                  {role === "管理者" ? (
                    <button
                      className="rounded bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200 disabled:opacity-60"
                      onClick={() => void handleDelete(index)}
                      disabled={Boolean(actionLoadingId)}
                    >
                      削除
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-orange-900">出勤可能曜日:</span>
                {WEEKDAYS.map((weekday) => (
                  <label key={weekday.value} className="inline-flex items-center gap-1 text-sm text-orange-800">
                    <input
                      type="checkbox"
                      checked={includesWeekday(staff.availableWeekdays, weekday.value)}
                      disabled={role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id)}
                      onChange={(event) =>
                        updateStaff(index, {
                          availableWeekdays: event.target.checked
                            ? [...staff.availableWeekdays, weekday.value].sort((a, b) => a - b)
                            : staff.availableWeekdays.filter((day) => day !== weekday.value)
                        })
                      }
                    />
                    {weekday.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
