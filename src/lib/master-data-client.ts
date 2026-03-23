"use client";

import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { MasterData, normalizeMasterData } from "@/types/master-data";
import { UserRole } from "@/types/user";

export const WEEKDAYS = [
  { value: 0, label: "日" },
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" }
] as const;

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parsePatternCodes(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function includesWeekday(days: number[], day: number): boolean {
  return days.includes(day);
}

export function ageFromBirthDate(birthDate: string): number | null {
  if (!birthDate) {
    return null;
  }
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  const dayDiff = now.getDate() - date.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return Math.max(age, 0);
}

export async function fetchMasterData(): Promise<MasterData> {
  const response = await fetch("/api/master-data");
  if (!response.ok) {
    throw new Error("マスターデータ取得に失敗しました。");
  }
  return normalizeMasterData((await response.json()) as MasterData);
}

export async function saveMasterData(data: MasterData): Promise<void> {
  const response = await fetch("/api/master-data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, updatedAt: new Date().toISOString() })
  });
  if (!response.ok) {
    try {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "保存に失敗しました。");
    } catch {
      throw new Error("保存に失敗しました。");
    }
  }
}

export function showToast(message: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("app-toast", {
      detail: { message }
    })
  );
}

export async function fetchCurrentUserRole(): Promise<UserRole> {
  try {
    configureAmplify();
    const authUser = await getCurrentUser();
    const email = authUser.signInDetails?.loginId?.toString() ?? authUser.username;
    const syncResponse = await fetch("/api/profile/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: authUser.userId, email })
    });
    if (!syncResponse.ok) {
      return "メンバー";
    }
    const syncData = (await syncResponse.json()) as { profile?: { role: UserRole } };
    return syncData.profile?.role ?? "メンバー";
  } catch {
    return "メンバー";
  }
}
