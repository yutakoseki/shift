"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import FullscreenLoading from "@/components/fullscreen-loading";
import { createId, fetchCurrentUserRole, fetchMasterData, saveMasterData, showToast } from "@/lib/master-data-client";
import { createDefaultShiftRules, MasterData, ShiftRuleCreationStep, ShiftRules } from "@/types/master-data";
import { UserRole } from "@/types/user";

function updateCreationOrder(steps: ShiftRuleCreationStep[]): ShiftRuleCreationStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1
  }));
}

function normalizeShiftRulesForForm(input: ShiftRules | undefined): ShiftRules {
  const defaults = createDefaultShiftRules();
  if (!input) {
    return defaults;
  }

  return {
    saturdayRequirement: {
      ...defaults.saturdayRequirement,
      ...input.saturdayRequirement,
      combinations:
        input.saturdayRequirement?.combinations?.length > 0
          ? input.saturdayRequirement.combinations
          : defaults.saturdayRequirement.combinations
    },
    compensatoryHoliday: {
      ...defaults.compensatoryHoliday,
      ...input.compensatoryHoliday
    },
    creationOrder: input.creationOrder?.length ? input.creationOrder : defaults.creationOrder,
    autoGenerationPolicy: {
      ...defaults.autoGenerationPolicy,
      ...input.autoGenerationPolicy
    }
  };
}

export default function ShiftRulesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [data, setData] = useState<MasterData | null>(null);
  const [error, setError] = useState("");

  const editable = role === "管理者";

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData({
          ...masterData,
          shiftRules: normalizeShiftRulesForForm(masterData.shiftRules)
        });
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "データ取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rules = useMemo<ShiftRules | null>(() => data?.shiftRules ?? null, [data]);

  function patchRules(patch: Partial<ShiftRules>): void {
    setData((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        shiftRules: {
          ...prev.shiftRules,
          ...patch
        }
      };
    });
  }

  function patchCreationStep(stepId: string, patch: Partial<ShiftRuleCreationStep>): void {
    if (!rules) {
      return;
    }
    patchRules({
      creationOrder: rules.creationOrder.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
    });
  }

  function moveStep(stepId: string, direction: -1 | 1): void {
    if (!rules) {
      return;
    }
    const currentIndex = rules.creationOrder.findIndex((step) => step.id === stepId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rules.creationOrder.length) {
      return;
    }
    const nextSteps = [...rules.creationOrder];
    const [target] = nextSteps.splice(currentIndex, 1);
    nextSteps.splice(targetIndex, 0, target);
    patchRules({ creationOrder: updateCreationOrder(nextSteps) });
  }

  function addStep(): void {
    if (!rules) {
      return;
    }
    const nextSteps = updateCreationOrder([
      ...rules.creationOrder,
      {
        id: createId("step"),
        order: rules.creationOrder.length + 1,
        title: ""
      }
    ]);
    patchRules({ creationOrder: nextSteps });
  }

  function removeStep(stepId: string): void {
    if (!rules || rules.creationOrder.length <= 1) {
      return;
    }
    const nextSteps = rules.creationOrder.filter((step) => step.id !== stepId);
    patchRules({ creationOrder: updateCreationOrder(nextSteps) });
  }

  async function handleSave(): Promise<void> {
    if (!data || !rules || !editable) {
      return;
    }
    const hasInvalidStep = rules.creationOrder.some((step) => step.title.trim().length === 0);
    if (hasInvalidStep) {
      setError("入力順番の各項目名を入力してください。");
      return;
    }
    if (rules.saturdayRequirement.combinations.length === 0) {
      setError("土曜日の必要人数パターンを1つ以上登録してください。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await saveMasterData({
        ...data,
        shiftRules: {
          ...rules,
          creationOrder: updateCreationOrder(
            rules.creationOrder.map((step) => ({
              ...step,
              title: step.title.trim()
            }))
          )
        }
      });
      showToast("シフトルールを保存しました");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FullscreenLoading />;
  }

  if (!rules) {
    return <main className="p-6 text-red-600">シフトルールの読込に失敗しました。</main>;
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-orange-900">シフトルール管理</h1>
            <p className="mt-1 text-sm text-orange-700">シフト自動作成に使うルールと作成順序を管理します。</p>
          </div>
          <div className="flex items-center gap-2">
            {editable ? (
              <button
                className="rounded-lg bg-orange-500 px-4 py-2 text-base font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
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
        {!editable ? (
          <p className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-700">
            閲覧のみ可能です。編集・保存は管理者のみ実行できます。
          </p>
        ) : null}
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">土曜日の必要人数ルール</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.saturdayRequirement.enabled}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  saturdayRequirement: {
                    ...rules.saturdayRequirement,
                    enabled: event.target.checked
                  }
                })
              }
            />
            土曜日の必要人数ルールを有効にする
          </label>
          <label className="text-sm text-orange-800">
            最低必要人数:
            <input
              type="number"
              min={1}
              className="ml-2 w-24 rounded bg-orange-50 px-2 py-1 text-right text-orange-900"
              value={rules.saturdayRequirement.minTotalStaff}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  saturdayRequirement: {
                    ...rules.saturdayRequirement,
                    minTotalStaff: Math.max(1, Number(event.target.value) || 1)
                  }
                })
              }
            />
            <span className="ml-1">人</span>
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {rules.saturdayRequirement.combinations.map((pattern, index) => (
            <div key={`sat-combo-${index}`} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <div className="text-sm font-semibold text-orange-900 md:col-span-2">パターン{index + 1}</div>
              <label className="text-sm text-orange-800 md:col-span-3">
                パート
                <input
                  type="number"
                  min={0}
                  className="ml-2 w-20 rounded bg-white px-2 py-1 text-right text-orange-900"
                  value={pattern.partTimeCount}
                  disabled={!editable}
                  onChange={(event) =>
                    patchRules({
                      saturdayRequirement: {
                        ...rules.saturdayRequirement,
                        combinations: rules.saturdayRequirement.combinations.map((item, comboIndex) =>
                          comboIndex === index ? { ...item, partTimeCount: Math.max(0, Number(event.target.value) || 0) } : item
                        )
                      }
                    })
                  }
                />
                <span className="ml-1">人</span>
              </label>
              <label className="text-sm text-orange-800 md:col-span-3">
                常勤
                <input
                  type="number"
                  min={0}
                  className="ml-2 w-20 rounded bg-white px-2 py-1 text-right text-orange-900"
                  value={pattern.fullTimeCount}
                  disabled={!editable}
                  onChange={(event) =>
                    patchRules({
                      saturdayRequirement: {
                        ...rules.saturdayRequirement,
                        combinations: rules.saturdayRequirement.combinations.map((item, comboIndex) =>
                          comboIndex === index ? { ...item, fullTimeCount: Math.max(0, Number(event.target.value) || 0) } : item
                        )
                      }
                    })
                  }
                />
                <span className="ml-1">人</span>
              </label>
              <div className="text-sm text-orange-800 md:col-span-3">
                合計: <span className="font-semibold">{pattern.partTimeCount + pattern.fullTimeCount}人</span>
              </div>
              <div className="md:col-span-1">
                {editable ? (
                  <button
                    className="rounded bg-red-100 px-2 py-1 text-sm text-red-700 hover:bg-red-200 disabled:opacity-60"
                    disabled={rules.saturdayRequirement.combinations.length <= 1}
                    onClick={() =>
                      patchRules({
                        saturdayRequirement: {
                          ...rules.saturdayRequirement,
                          combinations: rules.saturdayRequirement.combinations.filter((_, comboIndex) => comboIndex !== index)
                        }
                      })
                    }
                  >
                    削除
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {editable ? (
            <button
              className="rounded-md bg-orange-100 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-200"
              onClick={() =>
                patchRules({
                  saturdayRequirement: {
                    ...rules.saturdayRequirement,
                    combinations: [...rules.saturdayRequirement.combinations, { partTimeCount: 0, fullTimeCount: 0 }]
                  }
                })
              }
            >
              パターンを追加
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">振替休日ルール</h2>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.compensatoryHoliday.enabled}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  compensatoryHoliday: {
                    ...rules.compensatoryHoliday,
                    enabled: event.target.checked
                  }
                })
              }
            />
            土曜勤務者の振替休日ルールを有効にする
          </label>
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.compensatoryHoliday.sameWeekRequired}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  compensatoryHoliday: {
                    ...rules.compensatoryHoliday,
                    sameWeekRequired: event.target.checked
                  }
                })
              }
            />
            同一週での振替取得を必須にする
          </label>
          <label className="block text-sm text-orange-800">
            補足説明
            <textarea
              className="mt-1 h-20 w-full rounded bg-orange-50 px-3 py-2 text-sm text-orange-900"
              value={rules.compensatoryHoliday.description}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  compensatoryHoliday: {
                    ...rules.compensatoryHoliday,
                    description: event.target.value
                  }
                })
              }
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-orange-900">自動作成の入力順番</h2>
          {editable ? (
            <button
              className="rounded-md bg-orange-100 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-200"
              onClick={() => addStep()}
            >
              手順を追加
            </button>
          ) : null}
        </div>
        <div className="mt-3 space-y-2">
          {rules.creationOrder.map((step, index) => (
            <div key={step.id} className="grid gap-2 rounded-md bg-orange-50 p-3 md:grid-cols-12">
              <div className="text-sm font-semibold text-orange-900 md:col-span-1">{index + 1}</div>
              <input
                className="rounded bg-white px-2 py-1 text-sm text-orange-900 md:col-span-7"
                value={step.title}
                placeholder="手順名を入力"
                disabled={!editable}
                onChange={(event) => patchCreationStep(step.id, { title: event.target.value })}
              />
              <div className="flex gap-1 md:col-span-4 md:justify-end">
                {editable ? (
                  <>
                    <button
                      className="rounded bg-orange-100 px-2 py-1 text-sm text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                      disabled={index === 0}
                      onClick={() => moveStep(step.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="rounded bg-orange-100 px-2 py-1 text-sm text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                      disabled={index === rules.creationOrder.length - 1}
                      onClick={() => moveStep(step.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="rounded bg-red-100 px-2 py-1 text-sm text-red-700 hover:bg-red-200 disabled:opacity-40"
                      disabled={rules.creationOrder.length <= 1}
                      onClick={() => removeStep(step.id)}
                    >
                      削除
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">自動作成方式（プログラム + AI）</h2>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.autoGenerationPolicy.useProgrammaticLogic}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  autoGenerationPolicy: {
                    ...rules.autoGenerationPolicy,
                    useProgrammaticLogic: event.target.checked
                  }
                })
              }
            />
            ルールベースのプログラムで自動割当を行う
          </label>
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.autoGenerationPolicy.useAi}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  autoGenerationPolicy: {
                    ...rules.autoGenerationPolicy,
                    useAi: event.target.checked
                  }
                })
              }
            />
            AIによる調整・候補提案を有効にする
          </label>
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.autoGenerationPolicy.skipSundayProcessing}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  autoGenerationPolicy: {
                    ...rules.autoGenerationPolicy,
                    skipSundayProcessing: event.target.checked
                  }
                })
              }
            />
            日曜日は処理対象から除外する（必要人数計算・自動作成・判定）
          </label>
          <label className="flex items-center gap-2 text-sm text-orange-800">
            <input
              className="orange-checkbox"
              type="checkbox"
              checked={rules.autoGenerationPolicy.preventFixedFullTimeShift}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  autoGenerationPolicy: {
                    ...rules.autoGenerationPolicy,
                    preventFixedFullTimeShift: event.target.checked
                  }
                })
              }
            />
            常勤が同じシフトに固定され続ける割当を避ける（ローテーション重視）
          </label>
          <label className="block text-sm text-orange-800">
            方針メモ
            <textarea
              className="mt-1 h-20 w-full rounded bg-orange-50 px-3 py-2 text-sm text-orange-900"
              value={rules.autoGenerationPolicy.description}
              disabled={!editable}
              onChange={(event) =>
                patchRules({
                  autoGenerationPolicy: {
                    ...rules.autoGenerationPolicy,
                    description: event.target.value
                  }
                })
              }
            />
          </label>
        </div>
      </section>
    </main>
  );
}
