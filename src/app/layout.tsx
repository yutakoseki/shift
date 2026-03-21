import type { Metadata } from "next";
import "./globals.css";
import "@aws-amplify/ui-react/styles.css";

export const metadata: Metadata = {
  title: "保育園シフト管理",
  description: "園長先生向けシフト管理MVP"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
