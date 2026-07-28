"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {}

/** Accessible styled toggle built on a native checkbox (role=switch). */
const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <label className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center", className)}>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full bg-input transition-colors",
          "peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 h-4 w-4 rounded-full bg-foreground shadow-sm transition-transform",
          "peer-checked:translate-x-4 peer-checked:bg-primary-foreground",
        )}
      />
    </label>
  ),
);
Switch.displayName = "Switch";

export { Switch };
