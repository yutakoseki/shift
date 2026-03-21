"use client";

import Link from "next/link";

export default function DataPage() {
  const links = [
    { href: "/data/full-time-staff", title: "常勤の先生管理", description: "名前・担当クラス・可能シフトパターン" },
    {
      href: "/data/part-time-staff",
      title: "パートの先生管理",
      description: "勤務条件（曜日・時間・週回数・可能シフトなど）"
    },
    { href: "/data/children", title: "園児管理", description: "名前・生年月日・登園曜日/時間（年齢自動計算）" },
    { href: "/data/shift-patterns", title: "シフトパターン管理", description: "A1〜D4 とカスタムシフト" },
    { href: "/data/child-ratios", title: "対人数（比率）管理", description: "0〜5歳児の比率（1/◯）" },
    { href: "/data/classes", title: "クラス管理", description: "クラス名（ひよこ等）と対象年齢帯" }
  ] as const;

  return (
    <main className="space-y-6 p-4 md:p-6">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-orange-900">データ管理</h1>
        <p className="mt-1 text-sm text-orange-700">項目を選んで個別管理ページへ移動してください。</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border border-orange-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:bg-orange-50"
          >
            <h2 className="text-lg font-semibold text-orange-900">{item.title}</h2>
            <p className="mt-1 text-sm text-orange-700">{item.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
