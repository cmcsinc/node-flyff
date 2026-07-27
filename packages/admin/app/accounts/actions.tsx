"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

async function toggleBan(id: number, banned: boolean) {
  const res = await fetch("/api/accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, banned: !banned }),
  });
  if (!res.ok) throw new Error("Failed");
}

async function toggleGm(id: number, gm: boolean) {
  const res = await fetch("/api/accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, gm: !gm }),
  });
  if (!res.ok) throw new Error("Failed");
}

export function BanToggleButton({ id, banned }: { id: number; banned: boolean }) {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        try {
          await toggleBan(id, banned);
          toast.success(banned ? "Account unbanned" : "Account banned");
          router.refresh();
        } catch {
          toast.error("Failed to update ban status");
        }
      }}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {banned ? "Unban" : "Ban"}
    </button>
  );
}

export function GmToggleButton({ id, gm }: { id: number; gm: boolean }) {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        try {
          await toggleGm(id, gm);
          toast.success(gm ? "GM removed" : "GM granted");
          router.refresh();
        } catch {
          toast.error("Failed to update GM status");
        }
      }}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {gm ? "Revoke GM" : "Grant GM"}
    </button>
  );
}
