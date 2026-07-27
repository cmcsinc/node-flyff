"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Swords,
  Package,
  Landmark,
  ScrollText,
  Sparkles,
  Settings,
  ChevronDown,
  Sword,
  Bug,
  Map,
  Gem,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Accounts", href: "/accounts", icon: Users },
  { label: "Characters", href: "/characters", icon: Swords },
  {
    label: "Resources",
    icon: Package,
    children: [
      { label: "Items", href: "/resources/items", icon: Sword },
      { label: "Movers", href: "/resources/movers", icon: Bug },
      { label: "Skills", href: "/resources/skills", icon: Sparkles },
      { label: "Quests", href: "/resources/quests", icon: ScrollText },
      { label: "Drops", href: "/resources/drops", icon: Gem },
      { label: "Zones", href: "/resources/zones", icon: Map },
      { label: "Set Items", href: "/resources/set-items", icon: Gem },
      { label: "Dialogues", href: "/resources/dialogues", icon: MessageSquareText },
    ],
  },
  { label: "Settings", href: "/settings", icon: Settings },
];

function NavItemComponent({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const isActive = item.href ? pathname === item.href : false;
  const hasChildren = item.children && item.children.length > 0;
  const Icon = item.icon;

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
        </button>
        {open && (
          <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
            {item.children!.map((child) => (
              <NavItemComponent key={child.label} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href!}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export function SidebarNav() {
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      <div className="mb-4 px-3">
        <h1 className="text-lg font-bold tracking-tight">Flyff Admin</h1>
        <p className="text-xs text-muted-foreground">Server Management</p>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavItemComponent key={item.label} item={item} />
      ))}
    </nav>
  );
}
