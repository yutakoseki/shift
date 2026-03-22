export type ShiftType = string;

export const SHIFT_CLASS_GROUPS = [
  { key: "0-1", label: "0-1クラス" },
  { key: "2-3", label: "2-3クラス" },
  { key: "4-5", label: "4-5クラス" }
] as const;

export type ShiftClassGroup = (typeof SHIFT_CLASS_GROUPS)[number]["key"];

export type ShiftEntry = {
  date: string;
  shiftType: ShiftType;
  classGroup?: ShiftClassGroup;
  staffName: string;
};

export type ShiftMonthResponse = {
  month: string;
  entries: ShiftEntry[];
};
