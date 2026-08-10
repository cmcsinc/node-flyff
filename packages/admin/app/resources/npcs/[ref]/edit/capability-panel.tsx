'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Info, Plus, RotateCcw, Save, Store, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { EnumOption } from '@/lib/field-schema';
import type { IncBlockView, MmiOption } from '@/lib/character-inc';
import {
  ShopTabEditor,
  draftsFromTabs,
  type ExplicitDraft,
  type RuleDraft,
  type TabDraft,
} from './shop-tab-editor';

/** `MMI_TRADE` — the menu that makes the shop tabs meaningful. */
const MMI_TRADE = 2;

/** `AddVendorSlot( 0..3 )` — the game supports exactly four shop tabs. */
const MAX_TABS = 4;

/** Shape of `/api/character-inc` PUT's JSON reply. */
interface PutResponse {
  ok?: boolean;
  error?: string;
  placements?: number;
}

/**
 * NPC capability editor — the `AddMenu( MMI_* )` list of a `character.inc` block.
 *
 * Three things this panel must not misrepresent, all encoded in the UI:
 *
 * 1. **Only four menus work.** They render as real switches; the other ~274 sit
 *    behind a "show all" toggle, visibly marked as parsed-but-inert. Hiding them
 *    entirely is not an option — a save would silently drop the ones an NPC
 *    already declares.
 * 2. **The edit is block-global.** A `character_key` is shared, so the header
 *    states how many placements it affects and lists them.
 * 3. **It is not live.** `m_abMoverMenu` is filled once at world-server boot, so
 *    the success path says "restart", never "applied".
 */
export function CapabilityPanel({
  block,
  options,
  kind3Options,
  jobOptions,
  itemOptions,
}: {
  block: IncBlockView;
  options: readonly MmiOption[];
  kind3Options: readonly EnumOption[];
  jobOptions: readonly EnumOption[];
  itemOptions: readonly EnumOption[];
}): React.JSX.Element {
  const initial = useMemo(() => new Set(block.menus), [block.menus]);
  const [menus, setMenus] = useState<Set<number>>(() => new Set(block.menus));
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  // Shop stock. All three lists are flat across tabs (the file is too) and each
  // tab editor filters to its own slot.
  const baseline = useMemo(() => draftsFromTabs(block.tabs), [block.tabs]);
  const [tabs, setTabs] = useState<TabDraft[]>(() => baseline.tabs);
  const [rules, setRules] = useState<RuleDraft[]>(() => baseline.rules);
  const [explicit, setExplicit] = useState<ExplicitDraft[]>(() => baseline.explicit);
  const [active, setActive] = useState(() => String(baseline.tabs[0]?.slot ?? 0));

  const implemented = options.filter((o) => o.implemented);
  const declaredOnly = options.filter((o) => !o.implemented);
  // An inert menu the NPC already declares stays visible even when collapsed,
  // so nothing the file contains is hidden from the person editing it.
  const declaredVisible = showAll ? declaredOnly : declaredOnly.filter((o) => menus.has(o.id));

  const menusDirty = menus.size !== initial.size || [...menus].some((id) => !initial.has(id));
  const shopDirty =
    JSON.stringify(sortTabs(tabs)) !== JSON.stringify(sortTabs(baseline.tabs)) ||
    JSON.stringify(sortRules(rules)) !== JSON.stringify(sortRules(baseline.rules)) ||
    JSON.stringify(sortExplicit(explicit)) !== JSON.stringify(sortExplicit(baseline.explicit));
  const dirty = menusDirty || shopDirty;

  /** A caption is required — the client would render a blank tab otherwise. */
  const blankCaption = tabs.some((t) => t.label.trim() === '');

  function toggle(id: number, on: boolean): void {
    setMenus((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function revert(): void {
    setMenus(new Set(block.menus));
    setTabs(baseline.tabs);
    setRules(baseline.rules);
    setExplicit(baseline.explicit);
    setActive(String(baseline.tabs[0]?.slot ?? 0));
  }

  /** Append a tab at the lowest free slot, with its own fresh caption. */
  function addTab(): void {
    const used = new Set(tabs.map((t) => t.slot));
    let slot = 0;
    while (used.has(slot) && slot < MAX_TABS) slot++;
    if (slot >= MAX_TABS) return;
    setTabs([...tabs, { slot, label: '' }]);
    setActive(String(slot));
  }

  /** Drop a tab and everything stocking it — orphan rules would be invisible. */
  function removeTab(slot: number): void {
    const next = tabs.filter((t) => t.slot !== slot);
    setTabs(next);
    setRules(rules.filter((r) => r.slot !== slot));
    setExplicit(explicit.filter((e) => e.slot !== slot));
    setActive(String(next[0]?.slot ?? 0));
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      // Only dirty sections are sent — an absent field leaves that part of the
      // file untouched, so a menus-only save can't blank the shop.
      const body: Record<string, unknown> = { key: block.key };
      if (menusDirty) body.menus = [...menus].sort((a, b) => a - b);
      if (shopDirty) {
        body.tabs = sortTabs(tabs);
        body.rules = sortRules(rules);
        body.explicit = sortExplicit(explicit);
      }

      const res = await fetch('/api/character-inc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as PutResponse | null;
      if (!res.ok) {
        toast.error(data?.error ?? 'Save failed');
        return;
      }
      const n = data?.placements ?? block.sharers.length;
      toast.success(
        'Saved to character.inc — restart the world server to apply' +
          (n > 1 ? ` (${String(n)} placements)` : ''),
      );
      router.refresh();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!block.exists) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Capability</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {block.key ? (
              <>
                No <code className="font-mono">{block.key}</code> block exists in{' '}
                <code className="font-mono">character.inc</code>, so this NPC has no menus. Set a{' '}
                <strong>Character key</strong> that matches a block to give it capability.
              </>
            ) : (
              <>
                This placement has no <strong>Character key</strong>. Capability, display name,
                outfit, and shop stock all resolve through that key — set one above.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <CardTitle className="text-sm">
              Capability
              <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                {block.key}
              </span>
            </CardTitle>
            {block.name && <Badge variant="secondary">{block.name}</Badge>}
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              These are <code className="font-mono">AddMenu( MMI_* )</code> lines in{' '}
              <code className="font-mono">character.inc</code> — the real source of NPC capability.
              The zone file&apos;s <code className="font-mono">functions</code> field is read by
              nothing. Changes need a <strong>world-server restart</strong>.
            </span>
          </p>

          {block.sharers.length > 1 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-snug text-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Affects {block.sharers.length} placements.</strong> They share this
                character key and there is no per-placement override:{' '}
                {block.sharers.map((s) => `${s.zoneName} #${String(s.id)}`).join(', ')}.
              </span>
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Server-implemented
            </p>
            <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
              {implemented.map((o) => (
                <MenuRow
                  key={o.id}
                  option={o}
                  checked={menus.has(o.id)}
                  onChange={(on) => {
                    toggle(o.id, on);
                  }}
                  warning={warningFor(o.id, block)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Declared only · not implemented server-side
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer text-xs"
                onClick={() => {
                  setShowAll((v) => !v);
                }}
                aria-expanded={showAll}
              >
                {showAll ? 'Hide' : `Show all ${String(declaredOnly.length)}`}
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              The client parses these into <code className="font-mono">m_abMoverMenu</code>, but no
              server handler reads them — enabling one changes nothing yet. Kept editable so an
              NPC&apos;s existing declarations survive a save.
            </p>
            {declaredVisible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                None declared on this NPC.
              </p>
            ) : (
              <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                {declaredVisible.map((o) => (
                  <MenuRow
                    key={o.id}
                    option={o}
                    checked={menus.has(o.id)}
                    onChange={(on) => {
                      toggle(o.id, on);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Store className="h-3.5 w-3.5" aria-hidden="true" />
                Shop stock
              </p>
              {!menus.has(MMI_TRADE) && (
                <Badge variant="warning">Trade menu off — players can&apos;t open this shop</Badge>
              )}
            </div>

            {tabs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-5">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  No shop tabs. Adding one writes an{' '}
                  <code className="font-mono">AddVendorSlot</code> line plus its caption into{' '}
                  <code className="font-mono">character.txt.txt</code>, which the client reads.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTab}
                  className="cursor-pointer gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add tab
                </Button>
              </div>
            ) : (
              <Tabs value={active} onValueChange={setActive}>
                <div className="flex flex-wrap items-center gap-2">
                  <TabsList>
                    {tabs.map((t) => (
                      <TabsTrigger key={t.slot} value={String(t.slot)}>
                        {t.label.trim() || `Tab ${String(t.slot + 1)}`}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          {block.tabs.find((v) => v.slot === t.slot)?.filled ?? 0}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {tabs.length < MAX_TABS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={addTab}
                      className="cursor-pointer gap-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add tab
                    </Button>
                  )}
                </div>
                {tabs.map((t) => (
                  <TabsContent key={t.slot} value={String(t.slot)} className="space-y-4 pt-4">
                    <ShopTabEditor
                      slot={t.slot}
                      view={block.tabs.find((v) => v.slot === t.slot)}
                      tab={t}
                      rules={rules}
                      explicit={explicit}
                      kind3Options={kind3Options}
                      jobOptions={jobOptions}
                      itemOptions={itemOptions}
                      onTabChange={(patch) => {
                        setTabs(tabs.map((x) => (x.slot === t.slot ? { ...x, ...patch } : x)));
                      }}
                      onRulesChange={setRules}
                      onExplicitChange={setExplicit}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        removeTab(t.slot);
                      }}
                      className="cursor-pointer gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove this tab
                    </Button>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>
        </CardContent>

        {/*
          Actions sit inside the card, not in a sticky bar: the placement form
          above already owns the page's one sticky bar, and a second element
          pinned to bottom:0 would overlap it.
        */}
        <CardFooter className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            onClick={() => {
              setConfirming(true);
            }}
            disabled={!dirty || saving || blankCaption}
            className="cursor-pointer gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="outline"
            onClick={revert}
            disabled={!dirty || saving}
            className="cursor-pointer gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </Button>
          {blankCaption ? (
            <span className="text-[11px] font-medium text-destructive">
              Every tab needs a caption — the client would show a blank tab.
            </span>
          ) : (
            dirty && (
              <span className="text-[11px] text-muted-foreground">
                Unsaved: {[menusDirty && 'menus', shopDirty && 'shop'].filter(Boolean).join(' + ')}
              </span>
            )
          )}
        </CardFooter>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Write to character.inc?"
        description={
          `This edits raw/character.inc, the same file the game client parses` +
          (block.sharers.length > 1
            ? `, and affects all ${String(block.sharers.length)} placements sharing "${block.key}"`
            : '') +
          `. The world server must be restarted before the change takes effect. ` +
          `Reversible by re-editing, or by restoring the file from git.`
        }
        confirmLabel="Write"
        onConfirm={save}
      />
    </>
  );
}

// Stable ordering so a dirty check compares content, not click order, and the
// written file is deterministic.
function sortTabs(ts: readonly TabDraft[]): TabDraft[] {
  return [...ts].sort((a, b) => a.slot - b.slot);
}

function sortRules(rs: readonly RuleDraft[]): RuleDraft[] {
  return [...rs].sort((a, b) => a.slot - b.slot || a.kind3.localeCompare(b.kind3));
}

function sortExplicit(es: readonly ExplicitDraft[]): ExplicitDraft[] {
  return [...es].sort((a, b) => a.slot - b.slot || a.itemId - b.itemId);
}

/** Flag a menu that is enabled but has no data behind it — a silent no-op NPC. */
function warningFor(id: number, block: IncBlockView): string | undefined {
  if (id === MMI_TRADE && block.vendorTabCount === 0) return 'No shop tabs — sells nothing.';
  if (id === 74 && block.buffSkillCount === 0) return 'No SetBuffSkill entries — grants nothing.';
  if (id === 0 && !block.dialogFile) return 'No m_szDialog file set.';
  return undefined;
}

function MenuRow({
  option,
  checked,
  onChange,
  warning,
}: {
  option: MmiOption;
  checked: boolean;
  onChange: (on: boolean) => void;
  warning?: string;
}): React.JSX.Element {
  const id = `mmi-${String(option.id)}`;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Switch
        id={id}
        checked={checked}
        onChange={(e) => {
          onChange(e.currentTarget.checked);
        }}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-xs font-medium">
          {option.label}
        </label>
        <p className="font-mono text-[10px] leading-snug text-muted-foreground">{option.symbol}</p>
        {option.purpose && (
          <p className="text-[11px] leading-snug text-muted-foreground">{option.purpose}</p>
        )}
        {warning && <p className="text-[11px] leading-snug text-warning">{warning}</p>}
      </div>
    </div>
  );
}
