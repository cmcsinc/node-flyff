"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

async function patchAccount(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed");
}

export function BanToggleButton({ id, banned }: { id: number; banned: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await patchAccount({ id, banned: !banned });
      toast.success(banned ? "Account unbanned" : "Account banned");
      router.refresh();
    } catch {
      toast.error("Failed to update ban status");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={banned ? "outline" : "ghost"}
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        className={banned ? undefined : "text-destructive hover:text-destructive"}
      >
        {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {banned ? "Unban" : "Ban"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={banned ? "Unban this account?" : "Ban this account?"}
        description={
          banned
            ? "This account will regain access to the server immediately."
            : "This account will be unable to log in. You can reverse this at any time."
        }
        confirmLabel={banned ? "Unban" : "Ban"}
        destructive={!banned}
        onConfirm={handleConfirm}
      />
    </>
  );
}

export function GmToggleButton({ id, gm }: { id: number; gm: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await patchAccount({ id, gm: !gm });
      toast.success(gm ? "GM removed" : "GM granted");
      router.refresh();
    } catch {
      toast.error("Failed to update GM status");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={gm ? "outline" : "ghost"}
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
        className={gm ? undefined : "text-gold hover:text-gold"}
      >
        {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {gm ? "Revoke GM" : "Grant GM"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={gm ? "Revoke GM privileges?" : "Grant GM privileges?"}
        description={
          gm
            ? "This account will lose administrative access to the server."
            : "This account will gain full administrative (GM) access. This is a powerful permission."
        }
        confirmLabel={gm ? "Revoke" : "Grant"}
        destructive={gm}
        onConfirm={handleConfirm}
      />
    </>
  );
}
