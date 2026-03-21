"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";

export default function LoginPage() {
  const router = useRouter();
  configureAmplify();

  useEffect(() => {
    void getCurrentUser()
      .then(() => {
        router.replace("/");
      })
      .catch(() => {
        // 未ログイン時は何もしない
      });
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-bold">保育園シフト管理ログイン</h1>
        <Authenticator
          hideSignUp
          components={{
            Header() {
              return <p className="mb-2 text-sm text-slate-600">園長先生用アカウントでログインしてください。</p>;
            }
          }}
        />
      </div>
    </main>
  );
}
