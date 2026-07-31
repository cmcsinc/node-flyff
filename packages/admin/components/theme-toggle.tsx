"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "flyff-admin-theme";

/**
 * Inline script that applies the stored theme before first paint. Rendered in
 * `<head>` so there is no flash of the wrong palette on load — React hydration
 * happens far too late to do this in an effect.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var d=s==='dark'||((!s||s==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

function apply(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Three-way theme switch (light / dark / follow OS), persisted to
 * localStorage. A radio group rather than a toggle button: "system" is a real
 * third state, and a two-state toggle cannot express it.
 */
export function ThemeToggle({ className }: { className?: string }): React.JSX.Element {
  const [choice, setChoice] = React.useState<ThemeChoice>("system");

  // Read the stored choice after mount — localStorage does not exist on the
  // server, and the pre-paint script has already applied the class.
  React.useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeChoice | null;
    if (stored === "light" || stored === "dark" || stored === "system") setChoice(stored);
  }, []);

  // While following the OS, react to it changing mid-session.
  React.useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      apply("system");
    };
    mq.addEventListener("change", onChange);
    return (): void => {
      mq.removeEventListener("change", onChange);
    };
  }, [choice]);

  function select(value: ThemeChoice): void {
    setChoice(value);
    localStorage.setItem(THEME_STORAGE_KEY, value);
    apply(value);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => {
              select(value);
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
              active
                ? "bg-card text-primary shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
