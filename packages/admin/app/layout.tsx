import type { Metadata } from "next";
import { SidebarNav } from "@/components/sidebar-nav";
import { auth } from "@/lib/auth";
import { Toaster } from "sonner";
import { LogOut, User } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flyff Admin",
  description: "Server management panel for the Flyff emulator",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background antialiased">
        {session ? (
          <div className="flex min-h-screen">
            {/* Sidebar */}
            <aside className="fixed inset-y-0 left-0 z-30 w-60 border-r border-border bg-sidebar-background flex flex-col">
              <SidebarNav />
            </aside>

            {/* Main content */}
            <main className="ml-60 flex-1">
              <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex h-14 items-center justify-between px-8">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{session.user?.name}</span>
                    </div>
                  </div>
                  <form action="/api/auth/signout" method="POST">
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                  </form>
                </div>
              </header>
              <div className="p-8">
                {children}
              </div>
            </main>
          </div>
        ) : (
          children
        )}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
