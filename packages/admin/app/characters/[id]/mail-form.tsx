"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import type { PickerItem } from "../../inventory/[characterId]/types";

/**
 * Client-side mirror of the API limits. Both are hard client caps:
 * `CMailBox::Serialize` writes title/text into a fixed archive and the client
 * discards the rest of the stream past an overflow, breaking the whole mailbox.
 */
const TITLE_MAX = 31;
const TEXT_MAX = 255;

/**
 * Compose-mail form. Persists via `POST /api/mail`; a `delivered:false` response
 * means the row is stored but the world couldn't be nudged (offline) — the
 * player receives it at next login, which the toast says explicitly.
 */
export function MailForm({
  characterId,
  pickerItems,
  onSent,
}: {
  characterId: number;
  /** Same catalog the inventory explorer uses — reused for the attachment picker. */
  pickerItems: PickerItem[];
  /** Called after a successful send — lets a host modal close itself. */
  onSent?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [gold, setGold] = React.useState("");
  const [itemQuery, setItemQuery] = React.useState("");
  const [item, setItem] = React.useState<PickerItem | null>(null);
  const [itemCount, setItemCount] = React.useState(1);
  const [pending, setPending] = React.useState(false);

  const results = React.useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return [];
    return pickerItems
      .filter((it) => it.name.toLowerCase().includes(q) || String(it.id) === q)
      .slice(0, 8);
  }, [pickerItems, itemQuery]);

  const titleError = title.length > TITLE_MAX ? `Max ${TITLE_MAX} characters` : undefined;
  const textError = text.length > TEXT_MAX ? `Max ${TEXT_MAX} characters` : undefined;
  const goldError = gold !== "" && !/^\d{1,19}$/.test(gold.trim()) ? "Digits only" : undefined;
  const maxCount = item?.stackSize ?? 9999;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim() === "") {
      toast.error("Title is required");
      return;
    }
    if (titleError || textError || goldError) return;

    setPending(true);
    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverId: characterId,
          title: title.trim(),
          text,
          gold: gold.trim() === "" ? undefined : gold.trim(),
          itemId: item?.id,
          itemCount: item ? Math.max(1, Math.min(itemCount, maxCount)) : undefined,
        }),
      });
      const body: { ok?: boolean; error?: string; delivered?: boolean } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(
        body.delivered ? "Mail sent" : "Mail saved — delivered at next login (world offline)",
      );
      setTitle("");
      setText("");
      setGold("");
      setItem(null);
      setItemQuery("");
      setItemCount(1);
      router.refresh();
      onSent?.();
    } catch (err) {
      toast.error("Failed to send mail", { description: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-border pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Send mail
      </p>

      <Field htmlFor="mail-title" label="Title" hint={`${title.length}/${TITLE_MAX}`} error={titleError}>
        <Input
          id="mail-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Compensation"
        />
      </Field>

      <Field htmlFor="mail-text" label="Message" hint={`${text.length}/${TEXT_MAX}`} error={textError}>
        <textarea
          id="mail-text"
          value={text}
          maxLength={TEXT_MAX}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background hover:border-ring/40 aria-invalid:border-destructive"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="mail-gold" label="Penya" hint="Blank = none" error={goldError}>
          <Input
            id="mail-gold"
            inputMode="numeric"
            value={gold}
            onChange={(e) => setGold(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field htmlFor="mail-item-count" label="Item count" hint={`Max ${maxCount}`}>
          <Input
            id="mail-item-count"
            type="number"
            min={1}
            max={maxCount}
            value={itemCount}
            disabled={!item}
            onChange={(e) => setItemCount(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field htmlFor="mail-item" label="Attached item" hint="Search by name or id — blank = none">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="mail-item"
            value={itemQuery}
            onChange={(e) => {
              setItemQuery(e.target.value);
              setItem(null);
            }}
            placeholder="none"
            className="pl-9"
            autoComplete="off"
          />
        </div>
      </Field>

      {item ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-sm">
          <Image src={item.iconUrl} alt="" width={24} height={24} unoptimized className="rounded" />
          <span className="flex-1 truncate">{item.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setItem(null);
              setItemQuery("");
            }}
          >
            Clear
          </Button>
        </div>
      ) : (
        results.length > 0 && (
          <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
            {results.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    setItem(it);
                    setItemQuery(it.name);
                    setItemCount(1);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-secondary"
                >
                  <Image src={it.iconUrl} alt="" width={22} height={22} unoptimized className="rounded" />
                  <span className="flex-1 truncate">{it.name}</span>
                  <span className="text-xs text-muted-foreground">#{it.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mail className="mr-1 h-3.5 w-3.5" />
        )}
        Send mail
      </Button>
    </form>
  );
}
