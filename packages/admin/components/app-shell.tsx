"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppShellContextValue {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const AppShellContext = React.createContext<AppShellContextValue>({
  mobileOpen: false,
  setMobileOpen: () => {},
});

/** Provider that owns the mobile sidebar open/close state. */
export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <AppShellContext.Provider value={{ mobileOpen, setMobileOpen }}>{children}</AppShellContext.Provider>
  );
}

export function useAppShell() {
  return React.useContext(AppShellContext);
}

/** Hamburger button shown in the header on small screens to open the sidebar. */
export function MobileNavToggle() {
  const { mobileOpen, setMobileOpen } = useAppShell();
  return (
    <button
      type="button"
      aria-label={mobileOpen ? "Close menu" : "Open menu"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen(!mobileOpen)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
    >
      {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </button>
  );
}

/** Backdrop that closes the sidebar when clicked (mobile only). */
export function SidebarBackdrop() {
  const { mobileOpen, setMobileOpen } = useAppShell();
  if (!mobileOpen) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
      onClick={() => setMobileOpen(false)}
    />
  );
}

/** Wrapper that applies mobile vs desktop sidebar visibility. */
export function SidebarContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  const { mobileOpen, setMobileOpen } = useAppShell();
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-sidebar-border bg-sidebar-background transition-transform lg:flex",
        mobileOpen ? "flex translate-x-0" : "hidden -translate-x-full lg:translate-x-0",
        className,
      )}
    >
      {children}
      {/* Close affordance on mobile */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={() => setMobileOpen(false)}
        className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
