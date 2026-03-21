export type ShiftType = "早番" | "中番" | "遅番";

export type ShiftEntry = {
  date: string;
  shiftType: ShiftType;
  staffName: string;
};

export type ShiftMonthResponse = {
  month: string;
  entries: ShiftEntry[];
};
