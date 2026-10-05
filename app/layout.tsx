import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import { ThemeProvider } from "@/components/theme-provider";

// Self-hosted per SSP brand guidelines (Nunito for sub-headers/copy, per
// Marketing's 2026-10 clarification) - the variable font file is vendored in
// app/fonts/ rather than fetched from Google Fonts at build time, so the app
// never depends on Google's CDN being reachable.
const nunito = localFont({
  src: "./fonts/Nunito-Variable.woff2",
  variable: "--font-nunito",
  weight: "200 1000",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SSP LMS",
  description: "SSP Learning Management System — visual demo",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${nunito.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SessionProvider session={session}>
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
