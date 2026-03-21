"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FullscreenLoading from "@/components/fullscreen-loading";
import { MasterData } from "@/types/master-data";
import { UserRole } from "@/types/user";
import { fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";

export default function ChildRatiosPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedFlags, setPersistedFlags] = useState<boolean[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [actionLoadingIndex, setActionLoadingIndex] = useState<number | null>(null);
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
        setPersistedFlags(masterData.childRatios.map(() => true));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "読込に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  async function handleUpsert(index: number): Promise<void> {
    if (!data) {
      return;
    }
    const target = data.childRatios[index];
    if (!target) {
      return;
    }
    if (!Number.isFinite(target.ratio) || target.ratio <= 0) {
      setError("比率は1以上を入力してください。");
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

  async function performDelete(index: number): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    const previousData = data;
    const previousFlags = persistedFlags;
    const nextData: MasterData = {
      ...data,
      childRatios: data.childRatios.filter((_, itemIndex) => itemIndex !== index)
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

  async function handleDeleteConfirm(): Promise<void> {
    if (deleteConfirmIndex === null) {
      return;
    }
    const targetIndex = deleteConfirmIndex;
    setDeleteConfirmIndex(null);
    await performDelete(targetIndex);
  }

  if (loading) {
    return <FullscreenLoading />;
  }

  if (!data) {
    return <main className="p-6 text-red-600">データ取得に失敗しました。</main>;
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-orange-900">対人数（比率）管理</h1>
            <p className="text-sm text-orange-700">各年齢の比率（1/◯）を管理します。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/data" className="rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200">
              戻る
            </Link>
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="space-y-2">
          {data.childRatios.map((ratio, index) => (
            <div key={`${ratio.age}-${index}`} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <label className="flex items-center gap-2 md:col-span-4">
                <span className="text-sm text-orange-900">年齢</span>
                <input
                  className="w-20 rounded bg-white px-2 py-1"
                  type="number"
                  min={0}
                  value={ratio.age}
                  disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                  onChange={(event) =>
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            childRatios: prev.childRatios.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, age: Number(event.target.value) || 0 } : item
                            )
                          }
                        : prev
                    )
                  }
                />
              </label>
              <label className="flex items-center gap-2 md:col-span-5">
                <span className="text-sm text-orange-900">比率（1/◯）</span>
                <input
                  className="w-24 rounded bg-white px-2 py-1"
                  type="number"
                  min={1}
                  value={ratio.ratio}
                  disabled={role !== "管理者" || (persistedFlags[index] && editingIndex !== index)}
                  onChange={(event) =>
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            childRatios: prev.childRatios.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, ratio: Number(event.target.value) || 1 } : item
                            )
                          }
                        : prev
                    )
                  }
                />
              </label>
              <div className="flex items-center justify-end gap-2 md:col-span-3">
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
                    onClick={() => setDeleteConfirmIndex(index)}
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
      {isMounted && deleteConfirmIndex !== null
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <h3 className="text-lg font-semibold text-orange-900">削除確認</h3>
                <p className="mt-3 text-sm text-orange-900">この比率データを削除しますか？</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="rounded-md bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-200"
                    onClick={() => setDeleteConfirmIndex(null)}
                  >
                    キャンセル
                  </button>
                  <button
                    className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
                    onClick={() => void handleDeleteConfirm()}
                  >
                    削除する
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </main>
  );
}
