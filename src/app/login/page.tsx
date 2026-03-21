"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { confirmSignUp, getCurrentUser, resendSignUpCode, signIn, signUp } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";

export default function LoginPage() {
  const router = useRouter();
  configureAmplify();
  const [mode, setMode] = useState<"signIn" | "signUp" | "confirm">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const hasMinLength = password.length >= 8;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const isPasswordValid = hasMinLength && hasLowercase && hasUppercase && hasNumber && hasSymbol;
  const isPasswordMatched = confirmPassword.length > 0 && password === confirmPassword;

  useEffect(() => {
    void getCurrentUser()
      .then(() => {
        router.replace("/");
      })
      .catch(() => {
        // 未ログイン時は何もしない
      });
  }, [router]);

  async function onSubmitSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setLoading(true);
    try {
      await signIn({
        username: email.trim(),
        password
      });
      router.replace("/");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitSignUp(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    if (!isPasswordValid) {
      setErrorMessage("パスワード条件を満たしていません。チェック項目を確認してください。");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("パスワードが一致しません。");
      return;
    }

    setLoading(true);
    try {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim()
          }
        }
      });
      setMode("confirm");
      setInfoMessage("確認コードをメールに送信しました。届いたコードを入力してください。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新規登録に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitConfirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setLoading(true);
    try {
      await confirmSignUp({
        username: email.trim(),
        confirmationCode: code.trim()
      });
      setInfoMessage("登録が完了しました。ログインしてください。");
      setMode("signIn");
      setCode("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "確認コードの認証に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  async function onResendCode(): Promise<void> {
    setErrorMessage("");
    setInfoMessage("");
    setLoading(true);
    try {
      await resendSignUpCode({ username: email.trim() });
      setInfoMessage("確認コードを再送信しました。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "確認コードの再送に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg shadow-orange-100">
        <div className="mb-5 text-center">
          <p className="text-sm font-medium text-orange-600">Hoikuen Shift</p>
          <h1 className="mt-1 text-2xl font-bold text-orange-900">保育園シフト管理</h1>
          <p className="mt-2 text-sm text-orange-700">園長先生・管理担当の方向けログイン画面です。</p>
        </div>

        <div className="mb-4 flex rounded-xl bg-orange-100 p-1">
          <button
            className={`w-1/2 rounded-lg py-2 text-sm font-semibold ${
              mode === "signIn" ? "bg-white text-orange-700 shadow-sm" : "text-orange-700/80"
            }`}
            onClick={() => setMode("signIn")}
            type="button"
          >
            ログイン
          </button>
          <button
            className={`w-1/2 rounded-lg py-2 text-sm font-semibold ${
              mode === "signUp" || mode === "confirm" ? "bg-white text-orange-700 shadow-sm" : "text-orange-700/80"
            }`}
            onClick={() => setMode("signUp")}
            type="button"
          >
            新規登録
          </button>
        </div>

        <div className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-xs leading-relaxed text-orange-700">
          {mode === "confirm"
            ? "メールに届いた確認コードを入力すると登録が完了します。"
            : "初めて使う場合は「新規登録」からアカウントを作成してください。"}
        </div>

        {errorMessage ? (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p>
        ) : null}
        {infoMessage ? (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{infoMessage}</p>
        ) : null}

        {mode === "signIn" ? (
          <form className="space-y-3" onSubmit={(event) => void onSubmitSignIn(event)}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">メールアドレス</span>
              <input
                type="email"
                className="w-full rounded-lg bg-orange-50 px-3 py-2 outline-none transition focus:bg-white"
                placeholder="example@hoikuen.jp"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">パスワード</span>
              <input
                type="password"
                className="w-full rounded-lg bg-orange-50 px-3 py-2 outline-none transition focus:bg-white"
                placeholder="パスワードを入力"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button
              className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              disabled={loading}
              type="submit"
            >
              {loading ? "処理中..." : "ログイン"}
            </button>
          </form>
        ) : null}

        {mode === "signUp" ? (
          <form className="space-y-3" onSubmit={(event) => void onSubmitSignUp(event)}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">メールアドレス</span>
              <input
                type="email"
                className="w-full rounded-lg bg-orange-50 px-3 py-2 outline-none transition focus:bg-white"
                placeholder="example@hoikuen.jp"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">パスワード</span>
              <input
                type="password"
                className="w-full rounded-lg bg-orange-50 px-3 py-2 outline-none transition focus:bg-white"
                placeholder="8文字以上で入力"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <ul className="space-y-1 rounded-lg bg-orange-50 px-3 py-2 text-xs">
              <li className={hasMinLength ? "text-emerald-700" : "text-orange-700"}>
                {hasMinLength ? "✓" : "○"} 8文字以上
              </li>
              <li className={hasLowercase ? "text-emerald-700" : "text-orange-700"}>
                {hasLowercase ? "✓" : "○"} 小文字（a-z）を含む
              </li>
              <li className={hasUppercase ? "text-emerald-700" : "text-orange-700"}>
                {hasUppercase ? "✓" : "○"} 大文字（A-Z）を含む
              </li>
              <li className={hasNumber ? "text-emerald-700" : "text-orange-700"}>
                {hasNumber ? "✓" : "○"} 数字（0-9）を含む
              </li>
              <li className={hasSymbol ? "text-emerald-700" : "text-orange-700"}>
                {hasSymbol ? "✓" : "○"} 記号を含む（例: !@#$%）
              </li>
            </ul>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">パスワード（確認）</span>
              <input
                type="password"
                className={`w-full rounded-lg px-3 py-2 outline-none transition ${
                  confirmPassword.length === 0
                    ? "bg-orange-50 focus:bg-white"
                    : isPasswordMatched
                      ? "bg-emerald-50 focus:bg-emerald-100"
                      : "bg-red-50 focus:bg-red-100"
                }`}
                placeholder="もう一度入力"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {confirmPassword.length > 0 ? (
              <p className={`text-xs ${isPasswordMatched ? "text-emerald-700" : "text-red-600"}`}>
                {isPasswordMatched ? "✓ パスワードが一致しています" : "○ パスワードが一致していません"}
              </p>
            ) : null}
            <button
              className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              disabled={loading || !isPasswordValid || !isPasswordMatched}
              type="submit"
            >
              {loading ? "処理中..." : "確認コードを受け取る"}
            </button>
          </form>
        ) : null}

        {mode === "confirm" ? (
          <form className="space-y-3" onSubmit={(event) => void onSubmitConfirm(event)}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-orange-900">確認コード</span>
              <input
                type="text"
                className="w-full rounded-lg bg-orange-50 px-3 py-2 outline-none transition focus:bg-white"
                placeholder="メールに届いたコード"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <button
              className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white transition hover:bg-orange-600 disabled:opacity-60"
              disabled={loading}
              type="submit"
            >
              {loading ? "処理中..." : "登録を完了する"}
            </button>
            <button
              className="w-full rounded-lg bg-orange-100 px-4 py-2 text-orange-700 transition hover:bg-orange-200 disabled:opacity-60"
              disabled={loading}
              onClick={() => void onResendCode()}
              type="button"
            >
              確認コードを再送
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
