// src/app/layout.tsx
export const metadata = { title: "shipping-and-packing-system-web-app" };

import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
