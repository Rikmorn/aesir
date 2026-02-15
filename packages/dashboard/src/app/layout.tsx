import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Sidebar } from "@/components/layout/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ConnectionProvider } from "@/contexts/connection-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="h-screen overflow-hidden bg-background font-sans antialiased">
        <ThemeProvider>
          <NuqsAdapter>
            <ConnectionProvider>
              <div className="flex h-screen">
                <Sidebar />
                <main className="flex-1 overflow-y-auto">{children}</main>
              </div>
            </ConnectionProvider>
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
