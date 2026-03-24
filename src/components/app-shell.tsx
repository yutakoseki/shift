"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import FullscreenLoading from "@/components/fullscreen-loading";
import { UserRole } from "@/types/user";

type CurrentUser = {
  userId: string;
  email: string;
  role: UserRole;
};

const NAV_ITEMS = [
  { href: "/", label: "シフト作成（ホーム画面）", icon: "home" },
  { href: "/data", label: "データ管理", icon: "database" },
  { href: "/users", label: "ユーザー管理", icon: "users" }
] as const;

type IconName = (typeof NAV_ITEMS)[number]["icon"] | "logout";

function SidebarIcon({ name, className }: { name: IconName; className?: string }) {
  const shared = "h-5 w-5";
  const mergedClass = className ? `${shared} ${className}` : shared;

  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={mergedClass} aria-hidden="true">
        <path d="M3 11.5L12 4l9 7.5" />
        <path d="M5.5 10.5V20h13V10.5" />
      </svg>
    );
  }
  if (name === "database") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={mergedClass} aria-hidden="true">
        <ellipse cx="12" cy="6.5" rx="7" ry="3.5" />
        <path d="M5 6.5V17.5c0 1.9 3.1 3.5 7 3.5s7-1.6 7-3.5V6.5" />
        <path d="M5 12c0 1.9 3.1 3.5 7 3.5s7-1.6 7-3.5" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={mergedClass} aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 18c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
        <circle cx="17.5" cy="9" r="2.5" />
        <path d="M14.5 18c.2-2 1.8-3.7 4-4.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={mergedClass} aria-hidden="true">
      <path d="M9 7H4v10h5" />
      <path d="M20 12H8" />
      <path d="M16 8l4 4-4 4" />
    </svg>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  configureAmplify();

  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const isPublicPage = useMemo(() => pathname.startsWith("/login"), [pathname]);

  useEffect(() => {
    const saved = window.localStorage.getItem("sidebar-collapsed");
    if (saved === "true") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const message = customEvent.detail?.message ?? "";
      if (!message) {
        return;
      }
      setToastMessage(message);
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => setToastMessage(""), 2500);
    };

    window.addEventListener("app-toast", onToast as EventListener);
    return () => {
      window.removeEventListener("app-toast", onToast as EventListener);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (isPublicPage) {
      setLoadingAuth(false);
      return;
    }

    let mounted = true;
    void getCurrentUser()
      .then(async (user) => {
        const email = user.signInDetails?.loginId?.toString() ?? user.username;
        const syncResponse = await fetch("/api/profile/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.userId,
            email
          })
        });
        if (syncResponse.status === 503) {
          if (!mounted) {
            return;
          }
          setAuthErrorMessage("AWS認証情報が無効または期限切れです。管理者に連絡してサーバー設定を更新してください。");
          setLoadingAuth(false);
          return;
        }

        const syncData = (await syncResponse.json()) as { profile?: { role: UserRole } };
        if (!syncResponse.ok || !syncData.profile) {
          throw new Error("プロフィール同期に失敗しました");
        }

        if (!mounted) {
          return;
        }
        setAuthErrorMessage("");
        setCurrentUser({
          userId: user.userId,
          email,
          role: syncData.profile.role
        });
        setLoadingAuth(false);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        router.replace("/login");
      });

    return () => {
      mounted = false;
    };
  }, [isPublicPage, router]);

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.replace("/login");
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (loadingAuth) {
    return <FullscreenLoading message="認証確認中..." />;
  }

  if (authErrorMessage) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg shadow-orange-100">
          <p className="text-sm font-semibold text-orange-700">認証は完了しましたが、初期化処理に失敗しました。</p>
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{authErrorMessage}</p>
          <div className="mt-4 flex items-center gap-2">
            <button
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
              onClick={() => router.refresh()}
            >
              再読み込み
            </button>
            <button
              className="rounded-lg bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-200"
              onClick={() => void handleSignOut()}
            >
              ログアウト
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-white">
      <aside className={`${collapsed ? "w-20" : "w-72"} bg-orange-50/50 p-3 transition-all`}>
        <div className={`flex ${collapsed ? "justify-center" : "items-center justify-between"} gap-2`}>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-orange-600">Hoikuen Shift</p>
              <h2 className="mt-1 text-lg font-bold text-orange-900">メニュー</h2>
            </div>
          ) : null}
          <button
            className="rounded-md bg-orange-100 px-2 py-1 text-xs text-orange-700 hover:bg-orange-200"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
            title={collapsed ? "展開" : "折りたたむ"}
          >
            {collapsed ? ">" : "<"}
          </button>
        </div>

        {collapsed ? (
          <div className="mt-4 flex justify-center">
            <div className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">HS</div>
          </div>
        ) : null}

        <nav className="mt-5 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-2 px-3"} rounded-lg py-2 text-sm ${
                  active ? "bg-orange-500 font-semibold text-white" : "text-orange-800 hover:bg-orange-100"
                }`}
              >
                <SidebarIcon name={item.icon} />
                {!collapsed ? <span>{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="mt-8 rounded-lg bg-orange-50 p-3 text-xs text-orange-700">
            <p className="font-semibold text-orange-900">{currentUser?.role}</p>
            <p className="mt-1 break-all">{currentUser?.email}</p>
          </div>
        ) : null}

        <button
          className={`mt-4 flex w-full items-center rounded-lg bg-orange-100 py-2 text-sm text-orange-700 hover:bg-orange-200 ${
            collapsed ? "justify-center px-0" : "gap-2 px-3"
          }`}
          onClick={() => void handleSignOut()}
          title="ログアウト"
        >
          <SidebarIcon name="logout" />
          {!collapsed ? <span>ログアウト</span> : null}
        </button>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
      {toastMessage ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}
