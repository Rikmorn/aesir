import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Sidebar } from "@/components/layout/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aesir Dashboard",
  description: "Agent execution monitoring and management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <NuqsAdapter>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </NuqsAdapter>
      </body>
    </html>
  );
}
