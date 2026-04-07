import {
  SHIFT_AUTO_GENERATION_CHECKLIST_ITEMS,
  type ShiftAutoGenerationChecklistItemId,
  type ShiftAutoGenerationChecklistPriority,
  type ShiftRules,
} from "@/types/master-data";

export type ShiftAutoGenerationChecklistResultStatus = "pass" | "fail" | "skipped";

export type ShiftAutoGenerationChecklistResult = {
  id: ShiftAutoGenerationChecklistItemId;
  title: string;
  priority: ShiftAutoGenerationChecklistPriority;
  priorityLabel: string;
  status: ShiftAutoGenerationChecklistResultStatus;
  detail?: string;
};

export type EvaluateShiftAutoGenerationChecklistInput = {
  rules: ShiftRules;
  monthDates: string[];
  cells: Record<string, string>;
  offByDateAndStaff: Record<string, boolean>;
  timeBasedShortages: { date: string; time: string; required: number; assigned: number }[];
  fullTimeStaffNames: string[];
  partTimeStaff: { name: string; weeklyDays: number }[];
  /**
   * 自動作成直後の集計値がある場合は優先。
   * 未指定かつ `targetByDate` がある場合はセルと目標から再計算する。
   */
  unassignedSlotDays?: number;
  /** 日次目標チェックの再計算用（自動作成時に保存しておく） */
  targetByDate?: Record<string, number>;
  skipSundayProcessing: boolean;
};

const PRIORITY_LABEL: Record<ShiftAutoGenerationChecklistPriority, string> = {
  1: "最優先",
  2: "推奨",
  3: "参考",
};

function metaById(id: ShiftAutoGenerationChecklistItemId) {
  const found = SHIFT_AUTO_GENERATION_CHECKLIST_ITEMS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`unknown checklist id: ${id}`);
  }
  return found;
}

function isSundayDate(date: string): boolean {
  return new Date(`${date}T00:00:00`).getDay() === 0;
}

function isSaturdayDate(date: string): boolean {
  return new Date(`${date}T00:00:00`).getDay() === 6;
}

function mondayWeekKeyForDate(dateStr: string): string {
  const target = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(target.getTime())) {
    return dateStr;
  }
  const day = target.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(target);
  monday.setDate(target.getDate() + mondayDiff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

export function collectAssignedStaffByDate(cells: Record<string, string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [key, rawName] of Object.entries(cells)) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) {
      continue;
    }
    const date = key.split("|")[0];
    if (!date) {
      continue;
    }
    if (!map.has(date)) {
      map.set(date, new Set());
    }
    map.get(date)!.add(name);
  }
  return map;
}

/** メイン画面の `weekDatesForSaturday` と同じく、その土曜が属する週の月〜土（同一月内のみ） */
function weekDatesForSaturdayInSameMonth(saturdayDate: string): string[] {
  const target = new Date(`${saturdayDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) {
    return [];
  }
  const day = target.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(target);
  monday.setDate(target.getDate() + mondayDiff);
  return Array.from({ length: 6 }, (_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    if (current.getMonth() !== target.getMonth()) {
      return "";
    }
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
  }).filter((item) => item.length > 0);
}

export function computeCompensatoryUnresolvedFromSchedule(
  monthDates: string[],
  cells: Record<string, string>,
  offByDateAndStaff: Record<string, boolean>,
  fullTimeSet: Set<string>
): { saturdayDate: string; staffNames: string[] }[] {
  const byDate = collectAssignedStaffByDate(cells);
  const result: { saturdayDate: string; staffNames: string[] }[] = [];
  for (const date of monthDates) {
    if (!isSaturdayDate(date)) {
      continue;
    }
    const staffOnSat = byDate.get(date) ?? new Set<string>();
    const weekDates = weekDatesForSaturdayInSameMonth(date);
    const weekdayDates = weekDates.filter((d) => {
      const wd = new Date(`${d}T00:00:00`).getDay();
      return wd >= 1 && wd <= 5;
    });
    const unresolved: string[] = [];
    for (const staffName of staffOnSat) {
      if (!fullTimeSet.has(staffName)) {
        continue;
      }
      const hasWeekdayOff = weekdayDates.some((d) => offByDateAndStaff[`${d}|${staffName}`]);
      if (!hasWeekdayOff) {
        unresolved.push(staffName);
      }
    }
    if (unresolved.length > 0) {
      result.push({ saturdayDate: date, staffNames: unresolved });
    }
  }
  return result;
}

function wrap(
  id: ShiftAutoGenerationChecklistItemId,
  status: ShiftAutoGenerationChecklistResultStatus,
  detail?: string
): ShiftAutoGenerationChecklistResult {
  const meta = metaById(id);
  return {
    id,
    title: meta.title,
    priority: meta.priority,
    priorityLabel: PRIORITY_LABEL[meta.priority],
    status,
    detail,
  };
}

/**
 * シフトルールで有効になっているチェック項目だけを評価し、優先度順で返す。
 */
export function evaluateShiftAutoGenerationChecklist(
  input: EvaluateShiftAutoGenerationChecklistInput
): ShiftAutoGenerationChecklistResult[] {
  const enabled = new Set(input.rules.autoGenerationChecklist.enabledItemIds);
  const byDate = collectAssignedStaffByDate(input.cells);
  const fullTimeSet = new Set(input.fullTimeStaffNames.map((n) => n.trim()).filter(Boolean));

  const runCheck = (id: ShiftAutoGenerationChecklistItemId): ShiftAutoGenerationChecklistResult | null => {
    if (!enabled.has(id)) {
      return null;
    }

    switch (id) {
      case "timeSlotCoverage": {
        const n = input.timeBasedShortages.length;
        if (n === 0) {
          return wrap(id, "pass", "時間帯ベースの必要人数を満たしています。");
        }
        return wrap(id, "fail", `不足がある時間帯が ${n} 件あります（先に反映・調整が必要です）。`);
      }
      case "noOffDayAssignmentConflict": {
        const conflicts: string[] = [];
        for (const [key, rawName] of Object.entries(input.cells)) {
          const name = typeof rawName === "string" ? rawName.trim() : "";
          if (!name) {
            continue;
          }
          const date = key.split("|")[0];
          if (!date) {
            continue;
          }
          if (input.offByDateAndStaff[`${date}|${name}`]) {
            conflicts.push(`${date} ${name}`);
          }
        }
        if (conflicts.length === 0) {
          return wrap(id, "pass", "事前の休み登録と割当の矛盾は見つかりませんでした。");
        }
        const preview = conflicts.slice(0, 5).join("、");
        return wrap(
          id,
          "fail",
          `${conflicts.length} 件の矛盾（例: ${preview}${conflicts.length > 5 ? " …" : ""}）`
        );
      }
      case "saturdayMinimumHeadcount": {
        if (!input.rules.saturdayRequirement.enabled) {
          return wrap(id, "skipped", "土曜必要人数ルールがオフのため対象外です。");
        }
        const min = input.rules.saturdayRequirement.minTotalStaff;
        const badDates: string[] = [];
        for (const date of input.monthDates) {
          if (!isSaturdayDate(date)) {
            continue;
          }
          const count = (byDate.get(date) ?? new Set()).size;
          if (count < min) {
            badDates.push(`${date}（${count}/${min}人）`);
          }
        }
        if (badDates.length === 0) {
          return wrap(id, "pass", `土曜はすべて最低 ${min} 人以上です。`);
        }
        return wrap(id, "fail", `不足している土曜: ${badDates.slice(0, 6).join("、")}${badDates.length > 6 ? " …" : ""}`);
      }
      case "saturdayPartFullMix": {
        if (!input.rules.saturdayRequirement.enabled) {
          return wrap(id, "skipped", "土曜必要人数ルールがオフのため対象外です。");
        }
        const combos = input.rules.saturdayRequirement.combinations;
        const bad: string[] = [];
        for (const date of input.monthDates) {
          if (!isSaturdayDate(date)) {
            continue;
          }
          const names = byDate.get(date) ?? new Set<string>();
          let part = 0;
          let full = 0;
          for (const name of names) {
            if (fullTimeSet.has(name)) {
              full += 1;
            } else {
              part += 1;
            }
          }
          const okCombo = combos.some((c) => c.partTimeCount === part && c.fullTimeCount === full);
          if (!okCombo) {
            bad.push(`${date}（パート${part}/常勤${full}）`);
          }
        }
        if (bad.length === 0) {
          return wrap(id, "pass", "土曜の正／パート内訳は登録パターンのいずれかに一致しています。");
        }
        return wrap(id, "fail", `パターン不一致の土曜: ${bad.slice(0, 6).join("、")}${bad.length > 6 ? " …" : ""}`);
      }
      case "compensatoryHolidaySameWeek": {
        const rule = input.rules.compensatoryHoliday;
        if (!rule.enabled || !rule.sameWeekRequired) {
          return wrap(id, "skipped", "同週振替ルールがオフのため対象外です。");
        }
        const unresolved = computeCompensatoryUnresolvedFromSchedule(
          input.monthDates,
          input.cells,
          input.offByDateAndStaff,
          fullTimeSet
        );
        const n = unresolved.length;
        if (n === 0) {
          return wrap(id, "pass", "同週振替が必要な未解決はありません。");
        }
        const preview = unresolved
          .slice(0, 3)
          .map((item) => `${item.saturdayDate}（${item.staffNames.slice(0, 2).join("、")}…）`)
          .join(" / ");
        return wrap(id, "fail", `未解決 ${n} 週（例: ${preview}${n > 3 ? " …" : ""}）`);
      }
      case "partTimeWeeklyDaysPerWeek": {
        const violations: string[] = [];
        for (const staff of input.partTimeStaff) {
          const name = staff.name.trim();
          const cap = staff.weeklyDays;
          if (!name || !Number.isFinite(cap) || cap <= 0) {
            continue;
          }
          const perWeek = new Map<string, number>();
          for (const date of input.monthDates) {
            if (input.skipSundayProcessing && isSundayDate(date)) {
              continue;
            }
            const set = byDate.get(date);
            if (!set?.has(name)) {
              continue;
            }
            const wk = mondayWeekKeyForDate(date);
            perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
          }
          for (const [wk, cnt] of perWeek) {
            if (cnt > cap) {
              violations.push(`${name}（週${wk}に${cnt}回、目安${cap}回）`);
            }
          }
        }
        if (violations.length === 0) {
          return wrap(id, "pass", "パートの週ごとの勤務回数は契約目安を超えていません。");
        }
        return wrap(
          id,
          "fail",
          `週目安超過: ${violations.slice(0, 5).join("、")}${violations.length > 5 ? " …" : ""}`
        );
      }
      case "dailyHeadcountTarget": {
        let shortageSum = input.unassignedSlotDays;
        if (shortageSum === undefined && input.targetByDate) {
          shortageSum = 0;
          const byDate = collectAssignedStaffByDate(input.cells);
          for (const date of input.monthDates) {
            if (input.skipSundayProcessing && isSundayDate(date)) {
              continue;
            }
            const target = input.targetByDate[date] ?? 0;
            const assigned = (byDate.get(date) ?? new Set()).size;
            shortageSum += Math.max(0, target - assigned);
          }
        }
        if (shortageSum === undefined) {
          return wrap(
            id,
            "skipped",
            "直近の自動作成の目標人数がないため、手動編集後の再チェックはしません。自動作成直後の結果を参照してください。"
          );
        }
        if (shortageSum <= 0) {
          return wrap(id, "pass", "日次の必要目標人数に対する不足日はありません。");
        }
        return wrap(
          id,
          "fail",
          `日次目標ベースで合計 ${shortageSum} 人分の不足があります（時間帯必須は別項目）。`
        );
      }
      default: {
        const _exhaustive: never = id;
        return wrap(_exhaustive, "skipped", "未対応のチェック種別です。");
      }
    }
  };

  const orderedIds = [...SHIFT_AUTO_GENERATION_CHECKLIST_ITEMS].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.sortOrder - b.sortOrder;
  });

  const results: ShiftAutoGenerationChecklistResult[] = [];
  for (const item of orderedIds) {
    const row = runCheck(item.id);
    if (row) {
      results.push(row);
    }
  }
  return results;
}
