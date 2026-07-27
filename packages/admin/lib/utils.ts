import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format large numbers with commas. */
export function formatNumber(n: number | bigint | string): string {
  return BigInt(n).toLocaleString();
}

/** Format a timestamp (Unix epoch ms number, ISO string, or Date) to a readable date. */
export function formatDate(ts: string | number | Date | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : typeof ts === "string" ? new Date(ts) : ts;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Flyff job ID to class name. */
const JOB_NAMES: Record<number, string> = {
  0: "Vagrant",
  1: "Mercenary",
  2: "Acrobat",
  3: "Assist",
  4: "Magician",
  5: "Knight",
  6: "Blade",
  7: "Jester",
  8: "Ranger",
  9: "Ringmaster",
  10: "Billposter",
  11: "Psykeeper",
  12: "Elementor",
  13: "Knight (Master)",
  14: "Blade (Master)",
  15: "Jester (Master)",
  16: "Ranger (Master)",
  17: "Ringmaster (Master)",
  18: "Billposter (Master)",
  19: "Psykeeper (Master)",
  20: "Elementor (Master)",
  21: "Lord",
  22: "Stormblade",
  32: "Slayer",
  33: "Templar",
};

export function jobName(classId: number): string {
  return JOB_NAMES[classId] ?? `Class ${classId}`;
}
