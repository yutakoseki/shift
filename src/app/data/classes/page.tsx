"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MasterData } from "@/types/master-data";
import { UserRole } from "@/types/user";
import { createId, fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";

const CLASS_AGE_ORDER: Record<string, number> = {
  "0-1歳児": 0,
  "2-3歳児": 1,
  "4-5歳児": 2
};

function sortNurseryClasses(classes: MasterData["nurseryClasses"]): MasterData["nurseryClasses"] {
  return [...classes].sort((a, b) => {
    const orderA = CLASS_AGE_ORDER[a.ageGroup] ?? Number.MAX_SAFE_INTEGER;
    const orderB = CLASS_AGE_ORDER[b.ageGroup] ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name, "ja");
  });
}

export default function ClassesPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<UserRole>("メンバー");
  const [newClassName, setNewClassName] = useState("");
  const [newAgeGroup, setNewAgeGroup] = useState("");
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "読込に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCreate(): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    if (!newClassName.trim() || !newAgeGroup.trim()) {
      setError("クラス名と対象年齢帯を入力してください。");
      return;
    }
    const previousData = data;
    const nextData: MasterData = {
      ...data,
      nurseryClasses: [...data.nurseryClasses, { id: createId("class"), name: newClassName.trim(), ageGroup: newAgeGroup }]
    };
    setSubmitting(true);
    setError("");
    setData(nextData);
    try {
      await saveMasterData(nextData);
      setNewClassName("");
      setNewAgeGroup("");
      showToast("登録しました");
    } catch (requestError) {
      setData(previousData);
      setError(requestError instanceof Error ? requestError.message : "登録に失敗しました。");
    } finally {
      setSubmitting(false);
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
            <p className="text-sm text-orange-700">登録はこのセクションから行います。</p>
          ) : null}
        </div>
        {role === "管理者" ? (
          <div className="mt-3 grid gap-2 md:grid-cols-12">
            <input
              className="rounded bg-orange-50 px-2 py-2 md:col-span-5"
              value={newClassName}
              placeholder="クラス名（例: ひよこ）"
              onChange={(event) => setNewClassName(event.target.value)}
            />
            <select
              className="rounded bg-orange-50 px-2 py-2 md:col-span-5"
              value={newAgeGroup}
              onChange={(event) => setNewAgeGroup(event.target.value)}
            >
              <option value="">対象年齢帯を選択</option>
              <option value="0-1歳児">0-1歳児</option>
              <option value="2-3歳児">2-3歳児</option>
              <option value="4-5歳児">4-5歳児</option>
              <option value="その他">その他</option>
            </select>
            <button
              className="rounded bg-orange-500 px-3 py-2 text-white hover:bg-orange-600 disabled:opacity-60 md:col-span-2"
              onClick={() => void handleCreate()}
              disabled={submitting}
            >
              {submitting ? "登録中..." : "登録"}
            </button>
          </div>
        ) : null}
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-orange-900">登録済みクラス（表示専用）</h2>
        <div className="mt-3 space-y-2">
          {sortNurseryClasses(data.nurseryClasses).map((classItem) => (
            <div key={classItem.id} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <p className="rounded bg-white px-2 py-2 text-orange-900 md:col-span-7">{classItem.name || "（未設定）"}</p>
              <p className="rounded bg-white px-2 py-2 text-orange-900 md:col-span-5">{classItem.ageGroup || "（未設定）"}</p>
            </div>
          ))}
          {data.nurseryClasses.length === 0 ? (
            <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-700">まだクラスが登録されていません。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
