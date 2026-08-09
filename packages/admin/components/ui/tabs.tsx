"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const noop = (): void => {
  // default no-op; replaced by Tabs with a real handler.
};

const TabsContext = React.createContext<TabsContextValue>({
  value: "",
  onValueChange: noop,
  baseId: "tabs",
});

const Tabs = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value?: string; defaultValue?: string; onValueChange?: (v: string) => void }
>(({ className, value: controlledValue, defaultValue, onValueChange, children, ...props }, ref): React.ReactElement => {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const baseId = React.useId();
  const value = controlledValue ?? internalValue;
  const handleValueChange = React.useCallback(
    (v: string): void => {
      onValueChange?.(v);
      if (controlledValue === undefined) setInternalValue(v);
    },
    [onValueChange, controlledValue],
  );

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange, baseId }}>
      <div ref={ref} className={cn("", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
});
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        "inline-flex h-auto max-w-full items-center justify-start gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext);
  const active = ctx.value === value;
  const tabId = `${ctx.baseId}-trigger-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    props.onKeyDown?.(e);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const list = e.currentTarget.parentElement;
      if (!list) return;
      const triggers = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const idx = triggers.indexOf(e.currentTarget);
      if (idx === -1) return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = triggers[(idx + dir + triggers.length) % triggers.length];
      next.focus();
      ctx.onValueChange(next.dataset.value ?? "");
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={panelId}
      data-value={value}
      tabIndex={active ? 0 : -1}
      className={cn(
        "inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        active ? "bg-background text-foreground shadow" : "hover:text-foreground",
        className,
      )}
      onClick={(): void => { ctx.onValueChange(value); }}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext);
  const active = ctx.value === value;
  const panelId = `${ctx.baseId}-panel-${value}`;
  const tabId = `${ctx.baseId}-trigger-${value}`;
  if (!active) return null;
  return (
    <div
      ref={ref}
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      tabIndex={0}
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    />
  );
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
