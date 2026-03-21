"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import FullscreenLoading from "@/components/fullscreen-loading";
import { MasterData, PartTimeStaff } from "@/types/master-data";
import { UserRole } from "@/types/user";
import {
  WEEKDAYS,
  createId,
  fetchCurrentUserRole,
  fetchMasterData,
  includesWeekday,
  saveMasterData,
  showToast
} from "@/lib/master-data-client";

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export default function PartTimeStaffPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedIds, setPersistedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [error, setError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [data, setData] = useState<MasterData | null>(null);
  const [pendingClassById, setPendingClassById] = useState<Record<string, string>>({});
  const [pendingPatternById, setPendingPatternById] = useState<Record<string, string>>({});
  const [classPickerOpenById, setClassPickerOpenById] = useState<Record<string, boolean>>({});
  const [patternPickerOpenById, setPatternPickerOpenById] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    setIsMounted(true);
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

  async function performDelete(index: number): Promise<void> {
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

  async function handleDeleteConfirm(): Promise<void> {
    if (!data || !deleteConfirmId) {
      return;
    }
    const targetIndex = data.partTimeStaff.findIndex((staff) => staff.id === deleteConfirmId);
    if (targetIndex < 0) {
      setDeleteConfirmId("");
      return;
    }
    setDeleteConfirmId("");
    await performDelete(targetIndex);
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
    return <FullscreenLoading />;
  }

  if (!data) {
    return <main className="p-6 text-red-600">データ取得に失敗しました。</main>;
  }

  const classOptions = data.nurseryClasses.map((classItem) => classItem.name.trim()).filter((name) => name.length > 0);
  const shiftPatternsForSelect = [...data.shiftPatterns].sort((a, b) => {
    if (a.isCustom === b.isCustom) {
      return 0;
    }
    return a.isCustom ? -1 : 1;
  });
  const draftRows = data.partTimeStaff
    .map((staff, index) => ({ staff, index }))
    .filter(({ staff }) => !persistedIds.includes(staff.id));
  const persistedRows = data.partTimeStaff
    .map((staff, index) => ({ staff, index }))
    .filter(({ staff }) => persistedIds.includes(staff.id));

  const createDraftStaff = (): PartTimeStaff => ({
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
  });

  function renderStaffRow(staff: PartTimeStaff, index: number) {
    const isReadOnly = role !== "管理者" || (persistedIds.includes(staff.id) && editingId !== staff.id);
    const selectedMainClasses = unique(parseCommaSeparated(staff.mainClass));
    const selectedShiftCodes = unique(staff.possibleShiftPatternCodes);
    const availableClassOptions = classOptions.filter((className) => !selectedMainClasses.includes(className));
    const availableShiftOptions = shiftPatternsForSelect.filter((pattern) => !selectedShiftCodes.includes(pattern.code));
    const pendingClass = pendingClassById[staff.id] ?? availableClassOptions[0] ?? "";
    const pendingPattern = pendingPatternById[staff.id] ?? availableShiftOptions[0]?.code ?? "";
    const defaultPatternOptions = unique([
      "",
      ...selectedShiftCodes,
      ...(staff.defaultShiftPatternCode ? [staff.defaultShiftPatternCode] : [])
    ]).filter((code) => code === "" || code.length > 0);

    return (
      <div key={staff.id} className="space-y-1.5 rounded-md bg-orange-50 p-2">
        <div className="grid gap-2 md:grid-cols-12">
          <input
            className="rounded bg-white px-2 py-1 md:col-span-3"
            placeholder="名前"
            value={staff.name}
            disabled={isReadOnly}
            onChange={(event) => updateStaff(index, { name: event.target.value })}
          />
          <div className="flex flex-col gap-0.5 text-xs text-orange-900 md:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <span>主な担当クラス</span>
              {!isReadOnly && !classPickerOpenById[staff.id] ? (
                <button
                  type="button"
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm font-medium text-orange-800 hover:bg-orange-200 disabled:opacity-60"
                  disabled={classOptions.length === 0 || availableClassOptions.length === 0}
                  onClick={() => {
                    setClassPickerOpenById((prev) => ({ ...prev, [staff.id]: true }));
                    setPendingClassById((prev) => ({ ...prev, [staff.id]: availableClassOptions[0] ?? "" }));
                  }}
                >
                  クラス選択
                </button>
              ) : null}
            </div>
            {!isReadOnly && classPickerOpenById[staff.id] ? (
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded bg-white px-2 py-1"
                  value={pendingClass}
                  disabled={classOptions.length === 0 || availableClassOptions.length === 0}
                  onChange={(event) =>
                    setPendingClassById((prev) => ({
                      ...prev,
                      [staff.id]: event.target.value
                    }))
                  }
                >
                  {classOptions.length === 0 ? (
                    <option value="">クラスを先に登録してください</option>
                  ) : availableClassOptions.length === 0 ? (
                    <option value="">追加可能なクラスはありません</option>
                  ) : (
                    availableClassOptions.map((className) => (
                      <option key={className} value={className}>
                        {className}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] text-orange-800 hover:bg-orange-200 disabled:opacity-60"
                  disabled={classOptions.length === 0 || availableClassOptions.length === 0 || !pendingClass}
                  onClick={() => {
                    const next = unique([...selectedMainClasses, pendingClass]);
                    updateStaff(index, { mainClass: next.join(",") });
                    setPendingClassById((prev) => ({ ...prev, [staff.id]: "" }));
                    setClassPickerOpenById((prev) => ({ ...prev, [staff.id]: false }));
                  }}
                >
                  追加
                </button>
                <button
                  type="button"
                  className="rounded bg-white px-1.5 py-0.5 text-[11px] text-orange-700 hover:bg-orange-100"
                  onClick={() => setClassPickerOpenById((prev) => ({ ...prev, [staff.id]: false }))}
                >
                  閉じる
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1">
              {selectedMainClasses.map((className) => (
                <span key={className} className="inline-flex items-center gap-1 rounded-full bg-orange-200 px-2 py-0.5 text-xs text-orange-900">
                  {className}
                  {!isReadOnly ? (
                    <button
                      type="button"
                      className="text-orange-700 hover:text-orange-900"
                      onClick={() => {
                        const next = selectedMainClasses.filter((item) => item !== className);
                        updateStaff(index, { mainClass: next.join(",") });
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-orange-900 md:col-span-4">
            <div className="flex items-center justify-between gap-2">
              <span>可能シフトパターン</span>
              {!isReadOnly && !patternPickerOpenById[staff.id] ? (
                <button
                  type="button"
                  className="rounded bg-orange-100 px-3 py-1.5 text-sm font-medium text-orange-800 hover:bg-orange-200 disabled:opacity-60"
                  disabled={shiftPatternsForSelect.length === 0 || availableShiftOptions.length === 0}
                  onClick={() => {
                    setPatternPickerOpenById((prev) => ({ ...prev, [staff.id]: true }));
                    setPendingPatternById((prev) => ({ ...prev, [staff.id]: availableShiftOptions[0]?.code ?? "" }));
                  }}
                >
                  パターン選択
                </button>
              ) : null}
            </div>
            {!isReadOnly && patternPickerOpenById[staff.id] ? (
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded bg-white px-2 py-1"
                  value={pendingPattern}
                  disabled={shiftPatternsForSelect.length === 0 || availableShiftOptions.length === 0}
                  onChange={(event) =>
                    setPendingPatternById((prev) => ({
                      ...prev,
                      [staff.id]: event.target.value
                    }))
                  }
                >
                  {shiftPatternsForSelect.length === 0 ? (
                    <option value="">シフトパターンを先に登録してください</option>
                  ) : availableShiftOptions.length === 0 ? (
                    <option value="">追加可能なパターンはありません</option>
                  ) : (
                    availableShiftOptions.map((pattern, optionIndex) => (
                      <option key={`${pattern.code}-${optionIndex}`} value={pattern.code}>
                        {pattern.code}
                        {pattern.isCustom ? "（カスタム）" : ""}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] text-orange-800 hover:bg-orange-200 disabled:opacity-60"
                  disabled={shiftPatternsForSelect.length === 0 || availableShiftOptions.length === 0 || !pendingPattern}
                  onClick={() => {
                    const next = unique([...selectedShiftCodes, pendingPattern]);
                    updateStaff(index, {
                      possibleShiftPatternCodes: next,
                      defaultShiftPatternCode: next.includes(staff.defaultShiftPatternCode) ? staff.defaultShiftPatternCode : next[0] ?? ""
                    });
                    setPendingPatternById((prev) => ({ ...prev, [staff.id]: "" }));
                    setPatternPickerOpenById((prev) => ({ ...prev, [staff.id]: false }));
                  }}
                >
                  追加
                </button>
                <button
                  type="button"
                  className="rounded bg-white px-1.5 py-0.5 text-[11px] text-orange-700 hover:bg-orange-100"
                  onClick={() => setPatternPickerOpenById((prev) => ({ ...prev, [staff.id]: false }))}
                >
                  閉じる
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1">
              {selectedShiftCodes.map((code) => {
                const pattern = shiftPatternsForSelect.find((item) => item.code === code);
                return (
                  <span key={code} className="inline-flex items-center gap-1 rounded-full bg-orange-200 px-2 py-0.5 text-xs text-orange-900">
                    {code}
                    {pattern?.isCustom ? "（カスタム）" : ""}
                    {!isReadOnly ? (
                      <button
                        type="button"
                        className="text-orange-700 hover:text-orange-900"
                        onClick={() => {
                          const next = selectedShiftCodes.filter((item) => item !== code);
                          updateStaff(index, {
                            possibleShiftPatternCodes: next,
                            defaultShiftPatternCode: next.includes(staff.defaultShiftPatternCode) ? staff.defaultShiftPatternCode : next[0] ?? ""
                          });
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 md:col-span-2">
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
                {actionLoadingId === staff.id ? actionLabel : persistedIds.includes(staff.id) ? (editingId === staff.id ? "更新" : "編集") : "登録"}
              </button>
            ) : null}
            {role === "管理者" && persistedIds.includes(staff.id) ? (
              <button
                className="rounded bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200 disabled:opacity-60"
                onClick={() => setDeleteConfirmId(staff.id)}
                disabled={Boolean(actionLoadingId)}
              >
                削除
              </button>
            ) : null}
          </div>
          <select
            className="rounded bg-white px-2 py-1 md:col-span-2"
            value={staff.defaultShiftPatternCode}
            disabled={isReadOnly}
            onChange={(event) => updateStaff(index, { defaultShiftPatternCode: event.target.value })}
          >
            <option value="">デフォルトパターン</option>
            {defaultPatternOptions
              .filter((code) => code)
              .map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-orange-900 md:col-span-2">
            週
            <input
              className="w-16 rounded bg-white px-2 py-1"
              type="number"
              min={1}
              value={staff.weeklyDays}
              disabled={isReadOnly}
              onChange={(event) => updateStaff(index, { weeklyDays: Number(event.target.value) || 1 })}
            />
            回
          </label>
          <input
            className="rounded bg-white px-2 py-1 md:col-span-4"
            placeholder="その他"
            value={staff.notes}
            disabled={isReadOnly}
            onChange={(event) => updateStaff(index, { notes: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-orange-900">出勤可能曜日:</span>
          {WEEKDAYS.map((weekday) => (
            <label key={weekday.value} className="inline-flex items-center gap-1 text-sm text-orange-800">
              <input
                className="orange-checkbox"
                type="checkbox"
                checked={includesWeekday(staff.availableWeekdays, weekday.value)}
                disabled={isReadOnly}
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
    );
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-orange-900">パートの先生管理</h1>
            <p className="text-sm text-orange-700">勤務条件（曜日・時間・週回数・可能シフト）を管理します。</p>
          </div>
          <div className="flex items-center gap-2">
            {role === "管理者" ? (
              <button
                className="rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200"
                onClick={() => setData((prev) => (prev ? { ...prev, partTimeStaff: [...prev.partTimeStaff, createDraftStaff()] } : prev))}
              >
                追加
              </button>
            ) : null}
            <Link href="/data" className="rounded-md bg-orange-100 px-4 py-2 text-base font-semibold text-orange-700 hover:bg-orange-200">
              戻る
            </Link>
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      {draftRows.length > 0 ? (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2">
            <h2 className="text-lg font-semibold text-orange-900">新規登録</h2>
          </div>
          <div className="space-y-1.5">{draftRows.map(({ staff, index }) => renderStaffRow(staff, index))}</div>
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-2">
          <h2 className="text-lg font-semibold text-orange-900">登録済みデータ（編集/削除）</h2>
        </div>
        <div className="space-y-1.5">
          {persistedRows.length === 0 ? <p className="text-sm text-orange-700">登録済みデータはありません。</p> : null}
          {persistedRows.map(({ staff, index }) => renderStaffRow(staff, index))}
        </div>
      </section>

      {isMounted && deleteConfirmId
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <h3 className="text-lg font-semibold text-orange-900">削除確認</h3>
                <p className="mt-3 text-sm text-orange-900">このパートの先生データを削除しますか？</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="rounded-md bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-200"
                    onClick={() => setDeleteConfirmId("")}
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
