export type ShiftType = string;

export type ShiftEntry = {
  date: string;
  shiftType: ShiftType;
  staffName: string;
};

export type ShiftMonthResponse = {
  month: string;
  entries: ShiftEntry[];
};
