export type UserRole = "管理者" | "メンバー";

export type UserProfile = {
  userId: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};
