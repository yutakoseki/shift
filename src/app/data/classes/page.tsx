"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MasterData } from "@/types/master-data";
import { UserRole } from "@/types/user";
import { createId, fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";

export default function ClassesPage() {
  const [loading, setLoading] = useState(true);
  const [actionLoadingClassId, setActionLoadingClassId] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedClassIds, setPersistedClassIds] = useState<string[]>([]);
  const [editingClassId, setEditingClassId] = useState("");
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
        setPersistedClassIds(masterData.nurseryClasses.map((item) => item.id));
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

    const target = data.nurseryClasses[index];
    if (!target) {
      return;
    }
    if (!target.name.trim() || !target.ageGroup.trim()) {
      setError("クラス名と対象年齢帯を入力してください。");
      return;
    }

    setActionLoadingClassId(target.id);
    setActionLabel(persistedClassIds.includes(target.id) ? "更新中..." : "登録中...");
    setError("");
    try {
      await saveMasterData(data);
      if (!persistedClassIds.includes(target.id)) {
        setPersistedClassIds((prev) => [...prev, target.id]);
      }
      setEditingClassId("");
      showToast(persistedClassIds.includes(target.id) ? "更新しました" : "登録しました");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登録/更新に失敗しました。");
    } finally {
      setActionLoadingClassId("");
      setActionLabel("");
    }
  }

  async function handleDelete(index: number): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }

    const target = data.nurseryClasses[index];
    if (!target) {
      return;
    }

    const previousData = data;
    const nextData: MasterData = {
      ...data,
      nurseryClasses: data.nurseryClasses.filter((_, itemIndex) => itemIndex !== index)
    };

    setActionLoadingClassId(target.id);
    setActionLabel("削除中...");
    setError("");
    setData(nextData);
    try {
      await saveMasterData(nextData);
      setPersistedClassIds((prev) => prev.filter((id) => id !== target.id));
      showToast("削除しました");
    } catch (requestError) {
      setData(previousData);
      setError(requestError instanceof Error ? requestError.message : "削除に失敗しました。");
    } finally {
      setActionLoadingClassId("");
      setActionLabel("");
    }
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
            <h1 className="text-2xl font-bold text-orange-900">クラス管理</h1>
            <p className="text-sm text-orange-700">クラス名（例: ひよこ）と対象年齢帯（例: 0-1歳児）を管理します。</p>
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
                        nurseryClasses: [...prev.nurseryClasses, { id: createId("class"), name: "", ageGroup: "" }]
                      }
                    : prev
                )
              }
            >
              クラス追加
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="space-y-2">
          {data.nurseryClasses.map((classItem, index) => (
            <div key={classItem.id} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <input
                className="rounded bg-white px-2 py-1 md:col-span-5"
                value={classItem.name}
                placeholder="クラス名（例: ひよこ）"
                disabled={role !== "管理者" || (persistedClassIds.includes(classItem.id) && editingClassId !== classItem.id)}
                onChange={(event) =>
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          nurseryClasses: prev.nurseryClasses.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.target.value } : item
                          )
                        }
                      : prev
                  )
                }
              />
              <select
                className="rounded bg-white px-2 py-1 md:col-span-5"
                value={classItem.ageGroup}
                disabled={role !== "管理者" || (persistedClassIds.includes(classItem.id) && editingClassId !== classItem.id)}
                onChange={(event) =>
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          nurseryClasses: prev.nurseryClasses.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, ageGroup: event.target.value } : item
                          )
                        }
                      : prev
                  )
                }
              >
                <option value="">対象年齢帯を選択</option>
                <option value="0-1歳児">0-1歳児</option>
                <option value="2-3歳児">2-3歳児</option>
                <option value="4-5歳児">4-5歳児</option>
                <option value="その他">その他</option>
              </select>
              <div className="flex items-center justify-end gap-2 md:col-span-2">
                {role === "管理者" ? (
                  <button
                    className="rounded bg-orange-500 px-2 py-1 text-white hover:bg-orange-600 disabled:opacity-60"
                    onClick={() => {
                      const isPersisted = persistedClassIds.includes(classItem.id);
                      if (isPersisted && editingClassId !== classItem.id) {
                        setEditingClassId(classItem.id);
                        return;
                      }
                      void handleUpsert(index);
                    }}
                    disabled={Boolean(actionLoadingClassId)}
                  >
                    {actionLoadingClassId === classItem.id
                      ? actionLabel
                      : persistedClassIds.includes(classItem.id)
                        ? editingClassId === classItem.id
                          ? "更新"
                          : "編集"
                        : "登録"}
                  </button>
                ) : null}
                {role === "管理者" ? (
                  <button
                    className="rounded bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200 disabled:opacity-60"
                    onClick={() => void handleDelete(index)}
                    disabled={Boolean(actionLoadingClassId)}
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
