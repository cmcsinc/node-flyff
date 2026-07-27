import type { Metadata } from "next";
import { SidebarNav } from "@/components/sidebar-nav";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { Toaster } from "sonner";
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
            <aside className="fixed inset-y-0 left-0 z-30 w-60 border-r border-border bg-sidebar-background">
              <SidebarNav />
            </aside>

            {/* Main content */}
            <main className="ml-60 flex-1">
              <div className="p-8">
                <header className="mb-8 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Welcome back, {session.user?.name}</h2>
                    <p className="text-sm text-muted-foreground">Manage your Flyff server</p>
                  </div>
                  <form action="/api/auth/signout" method="POST">
                    <button
                      type="submit"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Sign out
                    </button>
                  </form>
                </header>
                <Separator className="mb-8" />
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
