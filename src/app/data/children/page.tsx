"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChildProfile, MasterData } from "@/types/master-data";
import { UserRole } from "@/types/user";
import {
  WEEKDAYS,
  ageFromBirthDate,
  createId,
  fetchCurrentUserRole,
  fetchMasterData,
  saveMasterData,
  showToast
} from "@/lib/master-data-client";
import { createDefaultChildAttendance } from "@/types/master-data";

const DISPLAY_WEEKDAYS = WEEKDAYS.filter((weekday) => weekday.value >= 1 && weekday.value <= 6);

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function formatMinuteLabel(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function parseAgeGroupRange(ageGroup: string): { minAge: number; maxAge: number } | null {
  const match = ageGroup.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return null;
  }
  const minAge = Number(match[1]);
  const maxAge = Number(match[2]);
  if (!Number.isFinite(minAge) || !Number.isFinite(maxAge) || minAge > maxAge) {
    return null;
  }
  return { minAge, maxAge };
}

function buildTimeOptions(startHour: number): string[] {
  const toText = (totalMinutes: number): string => {
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minute = String(totalMinutes % 60).padStart(2, "0");
    return `${hour}:${minute}`;
  };

  const startMinutes = startHour * 60;
  const values: string[] = [];
  for (let minutes = startMinutes; minutes < 24 * 60; minutes += 15) {
    values.push(toText(minutes));
  }
  for (let minutes = 0; minutes < startMinutes; minutes += 15) {
    values.push(toText(minutes));
  }
  return values;
}

const TIME_OPTIONS = buildTimeOptions(6);

function rainbowHue(index: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const smallSetHues = [0, 30, 55, 90]; // 赤, オレンジ, 黄, 黄緑
  if (total <= 4) {
    return smallSetHues[Math.min(index, total - 1)];
  }
  if (total === 1) {
    return smallSetHues[0];
  }
  return Math.round((index / (total - 1)) * 330);
}

type ChildAttendanceRow = {
  id: string;
  name: string;
  classId: string;
  classLabel: string;
  ageGroup: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
};

function referenceWeekdayOrder(): number[] {
  return [1, 2, 3, 4, 5, 6];
}

function normalizeAgeGroup(ageGroup: string): string {
  if (ageGroup.includes("0-1")) {
    return "0-1歳児";
  }
  if (ageGroup.includes("2-3")) {
    return "2-3歳児";
  }
  if (ageGroup.includes("4-5")) {
    return "4-5歳児";
  }
  return ageGroup || "その他";
}

function findReferenceAttendance(
  attendanceByWeekday: ChildProfile["attendanceByWeekday"],
  options?: { excludeWeekday?: number }
): ChildProfile["attendanceByWeekday"][number] | null {
  const excludeWeekday = options?.excludeWeekday;
  for (const weekday of referenceWeekdayOrder()) {
    if (excludeWeekday !== undefined && weekday === excludeWeekday) {
      continue;
    }
    const found = attendanceByWeekday.find((slot) => slot.weekday === weekday && slot.enabled);
    if (found) {
      return found;
    }
  }
  return null;
}

function syncUncheckedWeekdayTimes(
  attendanceByWeekday: ChildProfile["attendanceByWeekday"]
): ChildProfile["attendanceByWeekday"] {
  const reference = findReferenceAttendance(attendanceByWeekday);
  if (!reference) {
    return attendanceByWeekday;
  }
  return attendanceByWeekday.map((slot) => {
    if (slot.enabled) {
      return slot;
    }
    return {
      ...slot,
      startTime: reference.startTime,
      endTime: reference.endTime
    };
  });
}

function propagateWeekdayTimeToOthers(
  attendanceByWeekday: ChildProfile["attendanceByWeekday"],
  sourceWeekday: number
): ChildProfile["attendanceByWeekday"] {
  const source = attendanceByWeekday.find((slot) => slot.weekday === sourceWeekday);
  if (!source) {
    return attendanceByWeekday;
  }
  return attendanceByWeekday.map((slot) => {
    if (slot.weekday === sourceWeekday || !referenceWeekdayOrder().includes(slot.weekday)) {
      return slot;
    }
    return {
      ...slot,
      startTime: source.startTime,
      endTime: source.endTime
    };
  });
}

export default function ChildrenPage() {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("メンバー");
  const [persistedIds, setPersistedIds] = useState<string[]>([]);
  const [expandedChildId, setExpandedChildId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [selectedWeekday, setSelectedWeekday] = useState(1);
  const [error, setError] = useState("");
  const [data, setData] = useState<MasterData | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRole(await fetchCurrentUserRole());
        const masterData = await fetchMasterData();
        setData(masterData);
        setPersistedIds(masterData.children.map((item) => item.id));
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

    const target = data.children[index];
    if (!target) {
      return;
    }
    if (!target.name.trim() || !target.birthDate) {
      setError("名前と生年月日を入力してください。");
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
      setExpandedChildId("");
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
    const target = data.children[index];
    if (!target) {
      return;
    }

    const previousData = data;
    const nextData: MasterData = {
      ...data,
      children: data.children.filter((_, itemIndex) => itemIndex !== index)
    };

    setActionLoadingId(target.id);
    setActionLabel("削除中...");
    setError("");
    setData(nextData);
    try {
      await saveMasterData(nextData);
      setPersistedIds((prev) => prev.filter((id) => id !== target.id));
      if (expandedChildId === target.id) {
        setExpandedChildId("");
      }
      showToast("削除しました");
    } catch (requestError) {
      setData(previousData);
      setError(requestError instanceof Error ? requestError.message : "削除に失敗しました。");
    } finally {
      setActionLoadingId("");
      setActionLabel("");
    }
  }

  function updateChild(index: number, patch: Partial<ChildProfile>): void {
    setData((prev) =>
      prev
        ? {
            ...prev,
            children: prev.children.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
          }
        : prev
    );
  }

  function classOptionsForBirthDate(birthDate: string): MasterData["nurseryClasses"] {
    if (!data) {
      return [];
    }
    const age = ageFromBirthDate(birthDate);
    if (age === null) {
      return [];
    }
    return data.nurseryClasses.filter((classItem) => {
      const range = parseAgeGroupRange(classItem.ageGroup);
      if (!range) {
        return false;
      }
      return age >= range.minAge && age <= range.maxAge;
    });
  }

  const groupedRows = useMemo(() => {
    if (!data) {
      return [] as {
        ageGroup: string;
        classes: { classKey: string; classLabel: string; rows: ChildAttendanceRow[]; colorIndex: number }[];
      }[];
    }

    const classOrder = new Map(data.nurseryClasses.map((classItem, index) => [classItem.id, index]));
    const rows: ChildAttendanceRow[] = data.children
      .filter((child) => persistedIds.includes(child.id))
      .map((child) => {
      const attendance =
        child.attendanceByWeekday.find((slot) => slot.weekday === selectedWeekday) ?? createDefaultChildAttendance()[selectedWeekday];
      const classFromMaster = data.nurseryClasses.find((classItem) => classItem.id === child.classId);
      const classLabel = classFromMaster
        ? `${classFromMaster.name}${classFromMaster.ageGroup ? `（${classFromMaster.ageGroup}）` : ""}`
        : child.className || "クラス未設定";
      const ageGroup = normalizeAgeGroup(classFromMaster?.ageGroup ?? "");
      return {
        id: child.id,
        name: child.name || "(未入力)",
        classId: child.classId,
        classLabel,
        ageGroup,
        startTime: attendance.startTime,
        endTime: attendance.endTime,
        enabled: attendance.enabled,
        startMinutes: toMinutes(attendance.startTime),
        endMinutes: toMinutes(attendance.endTime)
      };
    })
      .filter((row) => row.enabled);

    const grouped = new Map<string, { classKey: string; classLabel: string; rows: ChildAttendanceRow[]; colorIndex: number }>();

    data.nurseryClasses.forEach((classItem, index) => {
      grouped.set(classItem.id, {
        classKey: classItem.id,
        classLabel: `${classItem.name}${classItem.ageGroup ? `（${classItem.ageGroup}）` : ""}`,
        ageGroup: normalizeAgeGroup(classItem.ageGroup),
        rows: [],
        colorIndex: index
      });
    });

    rows.forEach((row) => {
      const classKey = row.classId || `name:${row.classLabel}`;
      if (!grouped.has(classKey)) {
        grouped.set(classKey, {
          classKey,
          classLabel: row.classLabel,
          ageGroup: row.ageGroup,
          rows: [],
          colorIndex: Number.MAX_SAFE_INTEGER
        });
      }
      grouped.get(classKey)?.rows.push(row);
    });

    grouped.forEach((classGroup) => {
      classGroup.rows.sort((a, b) => {
        if (a.startMinutes !== b.startMinutes) {
          return a.startMinutes - b.startMinutes;
        }
        if (a.endMinutes !== b.endMinutes) {
          return a.endMinutes - b.endMinutes;
        }
        return a.name.localeCompare(b.name, "ja");
      });
    });

    const sortedClasses = Array.from(grouped.values()).sort((a, b) => {
      const aOrder = a.classKey.startsWith("name:") ? Number.MAX_SAFE_INTEGER : (classOrder.get(a.classKey) ?? Number.MAX_SAFE_INTEGER);
      const bOrder = b.classKey.startsWith("name:") ? Number.MAX_SAFE_INTEGER : (classOrder.get(b.classKey) ?? Number.MAX_SAFE_INTEGER);
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.classLabel.localeCompare(b.classLabel, "ja");
    });

    const ageGroupOrder = ["0-1歳児", "2-3歳児", "4-5歳児", "その他"];
    const groupedByAge = new Map<string, { ageGroup: string; classes: typeof sortedClasses }>();
    sortedClasses.forEach((classGroup) => {
      const key = ageGroupOrder.includes(classGroup.ageGroup) ? classGroup.ageGroup : "その他";
      if (!groupedByAge.has(key)) {
        groupedByAge.set(key, { ageGroup: key, classes: [] as typeof sortedClasses });
      }
      groupedByAge.get(key)?.classes.push(classGroup);
    });

    return ageGroupOrder
      .filter((key) => groupedByAge.has(key))
      .map((key) => groupedByAge.get(key)!)
      .filter((item) => item.classes.length > 0);
  }, [data, selectedWeekday, persistedIds]);

  const timelineSlots = useMemo(() => {
    const enabledRows = groupedRows
      .flatMap((ageGroupBlock) => ageGroupBlock.classes.flatMap((classGroup) => classGroup.rows))
      .filter((row) => row.enabled);
    const fallbackStart = 6 * 60;
    const fallbackEnd = 20 * 60;
    const rawStart = enabledRows.length > 0 ? Math.min(...enabledRows.map((row) => row.startMinutes)) : fallbackStart;
    const rawEnd = enabledRows.length > 0 ? Math.max(...enabledRows.map((row) => row.endMinutes)) : fallbackEnd;

    // 15分グリッドに合わせて表示範囲を切り上げ/切り下げする
    const start = Math.max(0, Math.floor(rawStart / 15) * 15);
    const end = Math.min(24 * 60, Math.ceil(rawEnd / 15) * 15);

    const slots: number[] = [];
    for (let minutes = start; minutes < end; minutes += 15) {
      slots.push(minutes);
    }
    if (slots.length === 0) {
      slots.push(start);
    }
    return slots;
  }, [groupedRows]);

  const hourGroups = useMemo(() => {
    const groups: { hour: number; count: number }[] = [];
    timelineSlots.forEach((minutes) => {
      const hour = Math.floor(minutes / 60);
      const last = groups[groups.length - 1];
      if (last && last.hour === hour) {
        last.count += 1;
      } else {
        groups.push({ hour, count: 1 });
      }
    });
    return groups;
  }, [timelineSlots]);

  const classSequence = useMemo(() => {
    const indexByClassKey = new Map<string, number>();
    let sequenceIndex = 0;
    groupedRows.forEach((ageGroupBlock) => {
      ageGroupBlock.classes.forEach((classGroup) => {
        indexByClassKey.set(classGroup.classKey, sequenceIndex);
        sequenceIndex += 1;
      });
    });
    return {
      indexByClassKey,
      total: Math.max(sequenceIndex, 1)
    };
  }, [groupedRows]);

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
            <h1 className="text-2xl font-bold text-orange-900">園児管理</h1>
            <p className="text-sm text-orange-700">生年月日から年齢（◯歳児）を自動計算して表示します。</p>
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
                setExpandedChildId("");
                const newId = createId("child");
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        children: [
                          ...prev.children,
                          {
                            id: newId,
                            name: "",
                            birthDate: "",
                            classId: "",
                            className: "",
                            attendanceByWeekday: createDefaultChildAttendance()
                          }
                        ]
                      }
                    : prev
                );
              }}
            >
              追加
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <div className="space-y-2">
          {data.children
            .map((child, index) => ({ child, index }))
            .filter(({ child }) => !persistedIds.includes(child.id) || expandedChildId === child.id)
            .map(({ child, index }) => (
            <div key={child.id} className="space-y-2 rounded-md bg-orange-50 p-3">
              <div className="grid gap-2 md:grid-cols-12">
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  placeholder="名前"
                  value={child.name}
                  disabled={role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                  onChange={(event) => updateChild(index, { name: event.target.value })}
                />
                <input
                  className="rounded bg-white px-2 py-1 md:col-span-3"
                  type="date"
                  value={child.birthDate}
                  disabled={role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                  onChange={(event) => {
                    const nextBirthDate = event.target.value;
                    const matchedClassIds = classOptionsForBirthDate(nextBirthDate).map((item) => item.id);
                    const shouldResetClass = child.classId && !matchedClassIds.includes(child.classId);
                    updateChild(index, {
                      birthDate: nextBirthDate,
                      classId: shouldResetClass ? "" : child.classId,
                      className: shouldResetClass ? "" : child.className
                    });
                  }}
                />
                <select
                  className="rounded bg-white px-2 py-1 md:col-span-2"
                  value={child.classId}
                  disabled={role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                  onChange={(event) => {
                    const nextClassId = event.target.value;
                    const selectedClass = data.nurseryClasses.find((item) => item.id === nextClassId);
                    updateChild(index, {
                      classId: nextClassId,
                      className: selectedClass ? `${selectedClass.name}${selectedClass.ageGroup ? `（${selectedClass.ageGroup}）` : ""}` : child.className
                    });
                  }}
                >
                  <option value="">{child.birthDate ? "クラス選択" : "生年月日を先に入力"}</option>
                  {classOptionsForBirthDate(child.birthDate).map((classItem) => (
                    <option key={classItem.id} value={classItem.id}>
                      {classItem.name}
                      {classItem.ageGroup ? `（${classItem.ageGroup}）` : ""}
                    </option>
                  ))}
                </select>
                <p className="flex items-center text-sm text-orange-800 md:col-span-2">
                  {ageFromBirthDate(child.birthDate) === null ? "年齢: -" : `年齢: ${ageFromBirthDate(child.birthDate)}歳児`}
                </p>
                <div className="flex items-center justify-end gap-2 md:col-span-2">
                  {persistedIds.includes(child.id) ? (
                    <button
                      className="rounded bg-orange-100 px-2 py-1 text-orange-700 hover:bg-orange-200"
                      onClick={() => setExpandedChildId("")}
                    >
                      閉じる
                    </button>
                  ) : null}
                  {role === "管理者" ? (
                    <button
                      className="rounded bg-orange-500 px-2 py-1 text-white hover:bg-orange-600 disabled:opacity-60"
                      onClick={() => {
                        const isPersisted = persistedIds.includes(child.id);
                        if (isPersisted && editingId !== child.id) {
                          setEditingId(child.id);
                          return;
                        }
                        void handleUpsert(index);
                      }}
                      disabled={Boolean(actionLoadingId)}
                    >
                      {actionLoadingId === child.id
                        ? actionLabel
                        : persistedIds.includes(child.id)
                          ? editingId === child.id
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
              <div className="rounded-md bg-white p-2">
                <p className="mb-2 text-sm font-semibold text-orange-900">曜日別の登園・退園時間</p>
                <div className="grid gap-2 md:grid-cols-6">
                  {DISPLAY_WEEKDAYS.map((weekday) => {
                    const slot = child.attendanceByWeekday.find((item) => item.weekday === weekday.value) ?? {
                      weekday: weekday.value,
                      enabled: false,
                      startTime: "08:00",
                      endTime: "18:00"
                    };
                    return (
                      <div key={weekday.value} className="flex flex-col items-start gap-1 rounded bg-orange-50 px-2 py-1">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1 text-sm text-orange-900">
                          <input
                            className="orange-checkbox"
                            type="checkbox"
                            checked={slot.enabled}
                            disabled={role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              const reference = findReferenceAttendance(child.attendanceByWeekday, {
                                excludeWeekday: weekday.value
                              });
                              const nextAttendance = child.attendanceByWeekday.map((item) => {
                                if (item.weekday !== weekday.value) {
                                  return item;
                                }
                                if (!checked) {
                                  return { ...item, enabled: false };
                                }
                                return {
                                  ...item,
                                  enabled: true,
                                  startTime: reference?.startTime ?? item.startTime,
                                  endTime: reference?.endTime ?? item.endTime
                                };
                              });
                              updateChild(index, {
                                attendanceByWeekday: syncUncheckedWeekdayTimes(nextAttendance)
                              });
                            }}
                          />
                            {weekday.label}
                          </label>
                          <select
                            className="rounded bg-white px-2 py-1 text-sm"
                            value={slot.startTime}
                            disabled={!slot.enabled || role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                            onChange={(event) => {
                              const nextAttendance = child.attendanceByWeekday.map((item) =>
                                item.weekday === weekday.value ? { ...item, startTime: event.target.value } : item
                              );
                              updateChild(index, {
                                attendanceByWeekday: nextAttendance
                              });
                            }}
                          >
                            {TIME_OPTIONS.map((time) => (
                              <option key={`start-${weekday.value}-${time}`} value={time}>
                                {time}
                              </option>
                            ))}
                          </select>
                          <span className="text-sm text-orange-700">-</span>
                          <select
                            className="rounded bg-white px-2 py-1 text-sm"
                            value={slot.endTime}
                            disabled={!slot.enabled || role !== "管理者" || (persistedIds.includes(child.id) && editingId !== child.id)}
                            onChange={(event) => {
                              const nextAttendance = child.attendanceByWeekday.map((item) =>
                                item.weekday === weekday.value ? { ...item, endTime: event.target.value } : item
                              );
                              updateChild(index, {
                                attendanceByWeekday: nextAttendance
                              });
                            }}
                          >
                            {TIME_OPTIONS.map((time) => (
                              <option key={`end-${weekday.value}-${time}`} value={time}>
                                {time}
                              </option>
                            ))}
                          </select>
                        </div>
                        {role === "管理者" ? (
                          <button
                            className="rounded bg-orange-100 px-2 py-1 text-xs text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                            disabled={!slot.enabled || (persistedIds.includes(child.id) && editingId !== child.id)}
                            onClick={() =>
                              updateChild(index, {
                                attendanceByWeekday: propagateWeekdayTimeToOthers(child.attendanceByWeekday, weekday.value)
                              })
                            }
                          >
                            他曜日へ反映
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">曜日別 在園表（入力データから自動表示）</h2>
        <p className="mt-1 text-sm text-orange-700">月〜土で切り替えできます。15分刻みで在園時間帯を表示します。</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {DISPLAY_WEEKDAYS.map((weekday) => (
            <button
              key={weekday.value}
              className={`rounded-md px-3 py-1 text-sm ${
                selectedWeekday === weekday.value ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"
              }`}
              onClick={() => setSelectedWeekday(weekday.value)}
            >
              {weekday.label}
            </button>
          ))}
        </div>

        <div className="mt-2 overflow-hidden rounded-md border border-orange-100">
          <table className="min-w-full table-fixed border-collapse text-[9px] leading-none">
            <thead>
              <tr className="bg-orange-100/60">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 w-24 min-w-24 border border-white bg-orange-100 px-1 py-1 text-left align-middle"
                >
                  園児名
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-[96px] z-20 w-12 min-w-12 border border-white bg-orange-100 px-1 py-1 text-left align-middle"
                >
                  登園
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-[144px] z-20 w-12 min-w-12 border border-white bg-orange-100 px-1 py-1 text-left align-middle"
                >
                  降園
                </th>
                {hourGroups.map((group) => (
                  <th
                    key={`hour-${group.hour}`}
                    colSpan={group.count}
                    className="border border-white px-0.5 py-0.5 text-center text-[8px] text-orange-800"
                  >
                    {group.hour}時
                  </th>
                ))}
              </tr>
              <tr className="bg-orange-100/60">
                {timelineSlots.map((slot) => (
                  <th key={`minute-${slot}`} className="w-3 min-w-3 border border-white px-0 py-0.5 text-center text-[7px] text-orange-800">
                    {String(slot % 60).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((ageGroupBlock) => (
                <Fragment key={`age-group-${ageGroupBlock.ageGroup}`}>
                  <tr className="bg-orange-100">
                    <td colSpan={timelineSlots.length + 3} className="border border-white px-1 py-1 text-center text-[10px] font-bold text-orange-950">
                      {ageGroupBlock.ageGroup}クラス
                    </td>
                  </tr>
                  {ageGroupBlock.classes.map((group) => {
                    const sequenceIndex = classSequence.indexByClassKey.get(group.classKey) ?? 0;
                    const startHue = rainbowHue(sequenceIndex, classSequence.total);
                    const hueStep = classSequence.total <= 4 ? 14 : Math.max(14, Math.round(200 / classSequence.total));
                    const nextHue = (startHue + hueStep) % 360;
                    const bandStyle = {
                      backgroundImage: `linear-gradient(90deg, hsl(${startHue} 88% 86%) 0%, hsl(${nextHue} 88% 74%) 100%)`
                    };
                    const cellColor = `hsl(${startHue} 84% 66%)`;
                    return (
                      <Fragment key={`group-fragment-${group.classKey}`}>
                        <tr style={bandStyle}>
                          <td colSpan={timelineSlots.length + 3} className="border border-white px-1 py-1 text-center font-bold text-orange-950">
                            {group.classLabel}
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={`table-${row.id}`} className="odd:bg-orange-50/30">
                            <td className="sticky left-0 w-24 min-w-24 border border-white bg-white px-1 py-1 font-medium text-orange-900">
                              <button
                                className="w-full truncate text-left text-orange-900 hover:underline"
                                onClick={() => setExpandedChildId((prev) => (prev === row.id ? "" : row.id))}
                                title="クリックで編集フォームを表示"
                              >
                                {row.name}
                              </button>
                            </td>
                            <td className="sticky left-[96px] w-12 min-w-12 border border-white bg-white px-1 py-1 text-orange-800">
                              {row.enabled ? row.startTime : "-"}
                            </td>
                            <td className="sticky left-[144px] w-12 min-w-12 border border-white bg-white px-1 py-1 text-orange-800">
                              {row.enabled ? row.endTime : "-"}
                            </td>
                            {timelineSlots.map((slot) => {
                              const active = row.enabled && slot >= row.startMinutes && slot < row.endMinutes;
                              return (
                                <td
                                  key={`${row.id}-${slot}`}
                                  className={`h-4 w-3 min-w-3 border border-white ${active ? "" : "bg-white"}`}
                                  style={active ? { backgroundColor: cellColor } : undefined}
                                  title={active ? "在園" : "在園外"}
                                />
                              );
                            })}
                          </tr>
                        ))}
                        {group.rows.length === 0 ? (
                          <tr className="bg-white">
                            <td className="sticky left-0 w-24 min-w-24 border border-white bg-white px-1 py-1 text-orange-500">-</td>
                            <td className="sticky left-[96px] w-12 min-w-12 border border-white bg-white px-1 py-1 text-orange-500">-</td>
                            <td className="sticky left-[144px] w-12 min-w-12 border border-white bg-white px-1 py-1 text-orange-500">-</td>
                            {timelineSlots.map((slot) => (
                              <td key={`empty-${group.classKey}-${slot}`} className="h-4 w-3 min-w-3 border border-white bg-white" />
                            ))}
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
