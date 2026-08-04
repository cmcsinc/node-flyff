"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Swords,
  Package,
  ScrollText,
  Sparkles,
  Settings,
  ChevronDown,
  Sword,
  Bug,
  Map,
  Gem,
  MessageSquareText,
  PackageCheck,
  Server,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useAppShell } from "@/components/app-shell";

interface NavLeaf {
  label: string;
  href: string;
  icon: LucideIcon;
}
interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
}
type NavItem = NavLeaf | NavGroup;

function isGroup(item: NavItem): item is NavGroup {
  return (item as NavGroup).children !== undefined;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Accounts", href: "/accounts", icon: Users },
  { label: "Characters", href: "/characters", icon: Swords },
  { label: "Servers", href: "/servers", icon: Server },
  {
    label: "Resources",
    icon: Package,
    children: [
      { label: "Items", href: "/resources/items", icon: Sword },
      { label: "Movers", href: "/resources/movers", icon: Bug },
      { label: "NPCs", href: "/resources/npcs", icon: Users },
      { label: "Spawns", href: "/resources/spawns", icon: Bug },
      { label: "Skills", href: "/resources/skills", icon: Sparkles },
      { label: "Quests", href: "/resources/quests", icon: ScrollText },
      { label: "Drops", href: "/resources/drops", icon: Gem },
      { label: "Zones", href: "/resources/zones", icon: Map },
      { label: "Set Items", href: "/resources/set-items", icon: Gem },
      { label: "Dialogues", href: "/resources/dialogues", icon: MessageSquareText },
    ],
  },
  { label: "Client Patch", href: "/client-patch", icon: PackageCheck },
  { label: "Settings", href: "/settings", icon: Settings },
];

function pathMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function LeafLink({ item }: { item: NavLeaf }) {
  const pathname = usePathname();
  const active = pathMatches(pathname, item.href);
  const Icon = item.icon;
  const { setMobileOpen } = useAppShell();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={() => setMobileOpen(false)}
      className={cn(
        // py-2.5 on touch (44px row), tightened on desktop where the pointer is fine.
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {/* active accent bar */}
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary glow-primary" />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

function GroupNav({ item }: { item: NavGroup }) {
  const pathname = usePathname();
  const childActive = item.children.some((c) => pathMatches(pathname, c.href));
  const [open, setOpen] = useState(childActive);
  const Icon = item.icon;
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
          childActive
            ? "text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-3" role="group" aria-label={item.label}>
          {item.children.map((child) => (
            <LeafLink key={child.href} item={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarNav() {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4" aria-label="Primary">
      <div className="mb-4 px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 glow-primary">
            <Sword className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-none tracking-tight">Flyff Admin</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Server Management</p>
          </div>
        </div>
      </div>
      <div className="space-y-0.5">
        {NAV_ITEMS.map((item) =>
          isGroup(item) ? <GroupNav key={item.label} item={item} /> : <LeafLink key={item.href} item={item} />,
        )}
      </div>
    </nav>
  );
}
