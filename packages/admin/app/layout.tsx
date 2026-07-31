import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { SidebarNav } from "@/components/sidebar-nav";
import {
  AppShellProvider,
  MobileNavToggle,
  SidebarBackdrop,
  SidebarContainer,
} from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { ThemedToaster } from "@/components/themed-toaster";
import { ThemeToggle, THEME_INIT_SCRIPT } from "@/components/theme-toggle";
import { LogOut } from "lucide-react";
import "./globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flyff Admin",
  description: "Server management panel for the Flyff emulator",
};

function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint — no flash of wrong palette. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <AppShellProvider>
          {session ? (
            <div className="flex min-h-screen">
              {/* Keyboard users can jump past the sidebar to page content. */}
              <a
                href="#content"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
              >
                Skip to content
              </a>
              <SidebarBackdrop />
              <SidebarContainer>
                <SidebarNav />
              </SidebarContainer>

              <main id="content" className="flex min-h-screen flex-1 flex-col lg:pl-64">
                <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <div className="flex h-14 items-center gap-3 px-4 md:px-8">
                    <MobileNavToggle />
                    <div className="flex-1" />
                    <ThemeToggle />
                    {session.user && (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 rounded-full border border-border bg-muted/60 py-1 pl-1 pr-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                            {initials(session.user.name)}
                          </span>
                          <span className="hidden text-sm font-medium sm:inline">
                            {session.user.name}
                          </span>
                        </div>
                        <form action="/api/auth/signout" method="POST">
                          <button
                            type="submit"
                            aria-label="Sign out"
                            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <LogOut className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Sign out</span>
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                </header>
                <div className="flex-1 p-4 md:p-8">{children}</div>
              </main>
            </div>
          ) : (
            <>
              {/* Signed-out (login) pages have no header, so the switch floats. */}
              <ThemeToggle className="fixed right-4 top-4 z-50" />
              {children}
            </>
          )}
          <ThemedToaster />
        </AppShellProvider>
      </body>
    </html>
  );
}
