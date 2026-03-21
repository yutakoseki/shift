"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FullscreenLoading from "@/components/fullscreen-loading";
import { MasterData, ShiftPattern } from "@/types/master-data";
import { UserRole } from "@/types/user";
import { fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";

export default function ShiftPatternsPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedFlags, setPersistedFlags] = useState<boolean[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [newPattern, setNewPattern] = useState<ShiftPattern>({
    code: "",
    label: "",
    startTime: "09:00",
    endTime: "15:00",
    isCustom: true
  });
  const [actionLoadingIndex, setActionLoadingIndex] = useState<number | null>(null);
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState("");
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [data, setData] = useState<MasterData | null>(null);

  function normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  function isDuplicateCode(code: string, ignoreIndex?: number): boolean {
    if (!data) {
      return false;
    }
    const normalized = normalizeCode(code);
    return data.shiftPatterns.some(
      (pattern, index) => index !== ignoreIndex && normalizeCode(pattern.code) === normalized
    );
  }

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

  useEffect(() => {
    setIsMounted(true);
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
    if (isDuplicateCode(target.code, index)) {
      setError("既存のコードと重複しているため登録できません。");
      return;
    }
    const normalizedCode = target.code.trim();
    const normalizedLabel = target.label.trim() || normalizedCode;
    const nextData: MasterData = {
      ...data,
      shiftPatterns: data.shiftPatterns.map((pattern, itemIndex) =>
        itemIndex === index ? { ...pattern, code: normalizedCode, label: normalizedLabel } : pattern
      )
    };

    setActionLoadingIndex(index);
    setActionLabel(persistedFlags[index] ? "更新中..." : "登録中...");
    setError("");
    setData(nextData);
    try {
      await saveMasterData(nextData);
      setPersistedFlags((prev) => prev.map((flag, i) => (i === index ? true : flag)));
      setEditingIndex(null);
      showToast(persistedFlags[index] ? "更新しました" : "登録しました");
    } catch (requestError) {
      setData(data);
      setError(requestError instanceof Error ? requestError.message : "登録/更新に失敗しました。");
    } finally {
      setActionLoadingIndex(null);
      setActionLabel("");
    }
  }

  async function handleCreate(): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    if (!newPattern.code.trim() || !newPattern.startTime || !newPattern.endTime) {
      setError("コードと時間を入力してください。");
      return;
    }
    if (isDuplicateCode(newPattern.code)) {
      setError("既存のコードと重複しているため登録できません。");
      return;
    }

    const createdPattern: ShiftPattern = {
      ...newPattern,
      code: newPattern.code.trim(),
      label: newPattern.label.trim() || newPattern.code.trim()
    };
    const nextData: MasterData = {
      ...data,
      shiftPatterns: [...data.shiftPatterns, createdPattern]
    };

    setActionLoadingIndex(-1);
    setActionLabel("登録中...");
    setError("");
    setData(nextData);
    setPersistedFlags((prev) => [...prev, true]);
    try {
      await saveMasterData(nextData);
      setIsCreateFormOpen(false);
      setNewPattern({ code: "", label: "", startTime: "09:00", endTime: "15:00", isCustom: true });
      showToast("登録しました");
    } catch (requestError) {
      setData(data);
      setPersistedFlags((prev) => prev.slice(0, -1));
      setError(requestError instanceof Error ? requestError.message : "登録に失敗しました。");
    } finally {
      setActionLoadingIndex(null);
      setActionLabel("");
    }
  }

  async function performDelete(index: number): Promise<void> {
    if (!data || role !== "管理者") {
      return;
    }
    const target = data.shiftPatterns[index];
    if (!target) {
      return;
    }
    const targetCode = normalizeCode(target.code);
    const linkedFullTimeNames = data.fullTimeStaff
      .filter((staff) => staff.possibleShiftPatternCodes.some((code) => normalizeCode(code) === targetCode))
      .map((staff) => staff.name.trim() || "（名称未設定）");
    const linkedPartTimeNames = data.partTimeStaff
      .filter(
        (staff) =>
          staff.possibleShiftPatternCodes.some((code) => normalizeCode(code) === targetCode) ||
          normalizeCode(staff.defaultShiftPatternCode) === targetCode
      )
      .map((staff) => staff.name.trim() || "（名称未設定）");
    if (linkedFullTimeNames.length > 0 || linkedPartTimeNames.length > 0) {
      const fullTimeLabel = linkedFullTimeNames.length > 0 ? `常勤: ${linkedFullTimeNames.join("、")}` : "";
      const partTimeLabel = linkedPartTimeNames.length > 0 ? `パート: ${linkedPartTimeNames.join("、")}` : "";
      const linkedStaffLabel = [fullTimeLabel, partTimeLabel].filter(Boolean).join(" / ");
      setDeleteBlockedMessage(
        `このシフトパターンは先生データで使用中のため削除できません。先に常勤・パートの先生設定から該当パターンを外してください。${linkedStaffLabel ? `（使用中: ${linkedStaffLabel}）` : ""}`
      );
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
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex((prev) => (prev !== null ? prev - 1 : prev));
    }
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
            <h1 className="text-2xl font-bold text-orange-900">シフトパターン管理</h1>
            <p className="text-sm text-orange-700">A1〜D4 とカスタムシフトを管理します。</p>
          </div>
          <div className="flex items-center gap-2">
            {role === "管理者" ? (
              <button
                className="rounded-lg bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-60"
                onClick={() => setIsCreateFormOpen((prev) => !prev)}
                disabled={actionLoadingIndex !== null}
              >
                {isCreateFormOpen ? "追加フォームを閉じる" : "追加"}
              </button>
            ) : null}
            <Link
              href="/data"
              className="rounded-lg bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200"
            >
              戻る
            </Link>
          </div>
        </div>
      </section>

      {isCreateFormOpen && role === "管理者" ? (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-orange-900">新規追加</h2>
          </div>
          <div className="mt-3 grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
            <input
              className="rounded bg-white px-2 py-1 md:col-span-2"
              placeholder="コード"
              value={newPattern.code}
              onChange={(event) =>
                setNewPattern((prev) => ({ ...prev, code: event.target.value, label: prev.label || event.target.value }))
              }
            />
            <input
              className="rounded bg-white px-2 py-1 md:col-span-3"
              placeholder="表示名"
              value={newPattern.label}
              onChange={(event) => setNewPattern((prev) => ({ ...prev, label: event.target.value }))}
            />
            <input
              className="rounded bg-white px-2 py-1 md:col-span-2"
              type="time"
              value={newPattern.startTime}
              onChange={(event) => setNewPattern((prev) => ({ ...prev, startTime: event.target.value }))}
            />
            <input
              className="rounded bg-white px-2 py-1 md:col-span-2"
              type="time"
              value={newPattern.endTime}
              onChange={(event) => setNewPattern((prev) => ({ ...prev, endTime: event.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm text-orange-800 md:col-span-2">
              <input
                className="orange-checkbox"
                type="checkbox"
                checked={newPattern.isCustom}
                onChange={(event) => setNewPattern((prev) => ({ ...prev, isCustom: event.target.checked }))}
              />
              カスタム
            </label>
            <div className="flex items-center justify-end gap-2 md:col-span-1">
              <button
                className="rounded bg-orange-500 px-2 py-1 text-white hover:bg-orange-600 disabled:opacity-60"
                onClick={() => void handleCreate()}
                disabled={actionLoadingIndex !== null}
              >
                {actionLoadingIndex === -1 ? actionLabel : "登録"}
              </button>
            </div>
          </div>
          {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-orange-900">既存データの表示・編集</h2>
        </div>
        {!isCreateFormOpen && error ? (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
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
                  className="orange-checkbox"
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

      {isMounted && deleteBlockedMessage
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
                <h3 className="text-lg font-semibold text-orange-900">削除できません</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm text-orange-900">{deleteBlockedMessage}</p>
                <div className="mt-4 flex justify-end">
                  <button
                    className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                    onClick={() => setDeleteBlockedMessage("")}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {isMounted && deleteConfirmIndex !== null
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <h3 className="text-lg font-semibold text-orange-900">削除確認</h3>
                <p className="mt-3 text-sm text-orange-900">このシフトパターンを削除しますか？</p>
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
