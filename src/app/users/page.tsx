"use client";

import { useEffect, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { UserProfile, UserRole } from "@/types/user";

type MeResponse = {
  profile: UserProfile;
};

type UsersResponse = {
  users: UserProfile[];
};

export default function UsersPage() {
  const [actorUserId, setActorUserId] = useState("");
  const [myRole, setMyRole] = useState<UserRole | "">("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const user = await getCurrentUser();
        setActorUserId(user.userId);
        await loadMyRole(user.userId);
        await loadUsers(user.userId);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "ユーザー情報の取得に失敗しました。");
      }
    })();
  }, []);

  async function loadMyRole(userId: string): Promise<void> {
    const response = await fetch(`/api/users/me?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      throw new Error("自身の権限取得に失敗しました。");
    }
    const data = (await response.json()) as MeResponse;
    setMyRole(data.profile.role);
  }

  async function loadUsers(userId: string): Promise<void> {
    const response = await fetch("/api/users", {
      headers: {
        "x-actor-user-id": userId
      }
    });
    if (response.status === 403) {
      setUsers([]);
      return;
    }
    if (!response.ok) {
      throw new Error("ユーザー一覧取得に失敗しました。");
    }
    const data = (await response.json()) as UsersResponse;
    setUsers(data.users);
  }

  async function createUser(): Promise<void> {
    setLoading(true);
    setErrorMessage("");
    setMessage("");
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-actor-user-id": actorUserId
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "ユーザー作成に失敗しました。");
      }

      setEmail("");
      setPassword("");
      setMessage("ユーザーを作成しました。初期ロールはメンバーです。");
      await loadUsers(actorUserId);
    } catch (requestError) {
      setErrorMessage(requestError instanceof Error ? requestError.message : "ユーザー作成に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(targetUserId: string, role: UserRole): Promise<void> {
    setLoading(true);
    setErrorMessage("");
    setMessage("");
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(targetUserId)}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-actor-user-id": actorUserId
        },
        body: JSON.stringify({ role })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "ロール変更に失敗しました。");
      }
      setMessage("ロールを更新しました。");
      await loadUsers(actorUserId);
    } catch (requestError) {
      setErrorMessage(requestError instanceof Error ? requestError.message : "ロール変更に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  if (myRole === "") {
    return (
      <main className="p-4 md:p-6">
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold text-orange-900">ユーザー管理</h1>
          <p className="mt-2 text-sm text-orange-700">読み込み中...</p>
        </section>
      </main>
    );
  }

  if (myRole !== "管理者") {
    return (
      <main className="p-4 md:p-6">
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold text-orange-900">ユーザー管理</h1>
          <p className="mt-2 text-sm text-orange-700">この画面は管理者のみアクセスできます。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-orange-900">ユーザー管理</h1>
        <p className="mt-1 text-sm text-orange-700">新規作成時のロールは自動で「メンバー」になります。</p>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">ユーザー作成</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input
            type="email"
            placeholder="メールアドレス"
            className="rounded-md bg-orange-50 px-3 py-2 outline-none focus:bg-white"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            type="password"
            placeholder="初期パスワード"
            className="rounded-md bg-orange-50 px-3 py-2 outline-none focus:bg-white"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button
          className="mt-3 rounded-md bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
          onClick={() => void createUser()}
          disabled={loading || !email || !password}
        >
          {loading ? "処理中..." : "作成"}
        </button>
      </section>

      {message ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      {errorMessage ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p> : null}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-orange-900">登録ユーザー</h2>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-orange-100/70">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-orange-900">メール</th>
                <th className="px-3 py-2 text-left font-semibold text-orange-900">ロール</th>
                <th className="px-3 py-2 text-left font-semibold text-orange-900">変更</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId} className="odd:bg-orange-50/50">
                  <td className="px-3 py-2 text-orange-900">{user.email}</td>
                  <td className="px-3 py-2 text-orange-900">{user.role}</td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded-md bg-orange-50 px-2 py-1 text-sm"
                      value={user.role}
                      onChange={(event) => void changeRole(user.userId, event.target.value as UserRole)}
                    >
                      <option value="メンバー">メンバー</option>
                      <option value="管理者">管理者</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
