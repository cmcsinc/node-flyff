/**
 * Quest draft → PUT body, and the blast-radius tier the edit reaches.
 *
 * These exist because `propQuest.inc` is a client-facing file: the confirm dialog
 * and the success toast tell a GM whether a client patch is still outstanding, and
 * both read `pendingTier`. Getting that wrong means telling someone a structural
 * condition change is "server only" — they restart, ship nothing, and every
 * un-patched client then disagrees with the server about whether the quest is
 * available.
 *
 * The other failure mode under test is positional: the writer addresses statements
 * by index inside the `setting { }` group, so a draft that shifted or reordered
 * args would rewrite statements the GM never touched.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  addCommand,
  buildPutBody,
  draftFromView,
  isDirty,
  pendingTier,
  setArg,
  toggleRemoved,
  type QuestDraft,
} from "../app/resources/quests/[id]/edit/quest-drafts";
import { pairQuestArgs } from "../lib/quest-args";
import { questCmdSpec } from "../lib/quest-fields";
import type { CommandView, QuestEditorView } from "../lib/quest-editor";
import type { QuestArg } from "@flyff/resources";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function num(value: number): QuestArg {
  return { type: "num", value };
}

/** Build a CommandView the way the server-side loader does. */
function cmdView(index: number, cmd: string, args: readonly QuestArg[]): CommandView {
  const spec = questCmdSpec(cmd);
  return {
    index,
    cmd,
    args: pairQuestArgs({ cmd, args: [...args] }, spec),
    ...(spec ? { spec } : {}),
    tier: spec?.tier ?? "structural",
    dead: spec === undefined,
  };
}

/**
 * A quest with one command per tier:
 * - `SetRepeat` — server
 * - `SetEndRewardGold` — cosmetic
 * - `SetBeginCondLevel` — structural
 */
function view(): QuestEditorView {
  return {
    id: 5100,
    symbol: "QUEST_NEWBIE3_RIN",
    title: "A Favour",
    titleToken: "IDS_PROPQUEST_INC_000123",
    commands: [
      cmdView(0, "SetRepeat", [num(1)]),
      cmdView(1, "SetEndRewardGold", [num(100), num(200)]),
      cmdView(2, "SetBeginCondLevel", [num(75), num(129)]),
    ],
    states: {},
    dialog: {},
    tierCounts: { server: 1, cosmetic: 1, structural: 1 },
  };
}

function base(): { draft: QuestDraft; baseline: QuestDraft } {
  const v = view();
  return { draft: draftFromView(v), baseline: draftFromView(v) };
}

// ── draftFromView ────────────────────────────────────────────────────────────

void describe("draftFromView", () => {
  void it("keeps commands in file order — the writer addresses them by index", () => {
    const d = draftFromView(view());
    assert.deepEqual(
      d.commands.map((c) => c.cmd),
      ["SetRepeat", "SetEndRewardGold", "SetBeginCondLevel"],
    );
  });

  void it("carries each command's tier so the panel can band without a second lookup", () => {
    const d = draftFromView(view());
    assert.deepEqual(
      d.commands.map((c) => c.tier),
      ["server", "cosmetic", "structural"],
    );
  });

  void it("drops spec-only slots — an unfilled optional arg is not an argument", () => {
    // SetEndCondKillNPC has 3 required args + a 3-arg optional goal tail, so its
    // view carries 6 slots for 3 stored args.
    const v = cmdView(0, "SetEndCondKillNPC", [num(0), num(1), num(10)]);
    assert.equal(v.args.length, 6, "expected the goal tail to be offered");
    const d = draftFromView({ ...view(), commands: [v] });
    assert.equal(d.commands[0].args.length, 3, "unfilled goal slots leaked into the draft");
  });
});

// ── isDirty ──────────────────────────────────────────────────────────────────

void describe("isDirty", () => {
  void it("is false for an untouched draft", () => {
    const { draft, baseline } = base();
    assert.equal(isDirty(draft, baseline), false);
  });

  void it("sees a changed arg", () => {
    const { draft, baseline } = base();
    assert.equal(isDirty(setArg(draft, 2, 0, num(80)), baseline), true);
  });

  void it("sees a removal, and stops seeing it after undo", () => {
    const { draft, baseline } = base();
    const removed = toggleRemoved(draft, 0);
    assert.equal(isDirty(removed, baseline), true);
    assert.equal(isDirty(toggleRemoved(removed, 0), baseline), false);
  });

  void it("sees an added command", () => {
    const { draft, baseline } = base();
    assert.equal(isDirty(addCommand(draft, "SetEndRewardExp"), baseline), true);
  });

  void it("sees a title change", () => {
    const { draft, baseline } = base();
    assert.equal(isDirty({ ...draft, title: "Another Favour" }, baseline), true);
  });

  void it("ignores a rewrite to the same value", () => {
    const { draft, baseline } = base();
    assert.equal(isDirty(setArg(draft, 2, 0, num(75)), baseline), false);
  });
});

// ── setArg ───────────────────────────────────────────────────────────────────

void describe("setArg", () => {
  void it("changes only the addressed arg", () => {
    const { draft } = base();
    const next = setArg(draft, 1, 1, num(999));
    assert.deepEqual(next.commands[1].args.map((a) => a.value), [100, 999]);
    assert.deepEqual(next.commands[2].args.map((a) => a.value), [75, 129]);
  });

  void it("pads intermediate slots so a filled optional arg lands in its own position", () => {
    // Filling goal-X (index 3) of SetEndCondKillNPC when only 3 args are stored
    // must not let the value slide into index 3-as-next-free.
    const v = cmdView(0, "SetEndCondKillNPC", [num(0), num(1), num(10)]);
    const d = draftFromView({ ...view(), commands: [v] });
    const next = setArg(d, 0, 3, { type: "num", value: 1500 });
    assert.deepEqual(next.commands[0].args.map((a) => a.value), [0, 1, 10, 1500]);
  });

  void it("preserves a sym arg's type when the value is unchanged", () => {
    // The writer's symbol ladder reuses the file's own token for an unchanged
    // value; losing `sym` here would emit a bare number in its place.
    const sym: QuestArg = { type: "sym", value: 26921 };
    const v = cmdView(0, "SetEndRewardItem", [num(-1), num(1), num(-1), sym, num(1)]);
    const d = draftFromView({ ...view(), commands: [v] });
    assert.equal(d.commands[0].args[3].type, "sym");
    const next = setArg(d, 0, 4, num(2));
    assert.equal(next.commands[0].args[3].type, "sym", "an unrelated edit dropped the symbol");
  });
});

// ── addCommand ───────────────────────────────────────────────────────────────

void describe("addCommand", () => {
  void it("seeds one arg per fixed slot, excluding a variadic tail", () => {
    const { draft } = base();
    // SetBeginCondPreviousQuest = 1 fixed (mode) + variadic quest ids.
    const next = addCommand(draft, "SetBeginCondPreviousQuest");
    assert.equal(next.commands.at(-1)?.args.length, 1);
  });

  void it("starts a sentinel-bearing slot at its sentinel, not zero", () => {
    // SetEndRewardItem's first arg is sex: 0 is "male", -1 is "any". A new
    // command defaulting to 0 would silently restrict the reward to one sex.
    const { draft } = base();
    const next = addCommand(draft, "SetEndRewardItem");
    assert.equal(next.commands.at(-1)?.args[0].value, -1);
  });

  void it("records the added command's tier", () => {
    const { draft } = base();
    assert.equal(addCommand(draft, "SetEndCondItem").commands.at(-1)?.tier, "structural");
    assert.equal(addCommand(draft, "SetEndRemoveGold").commands.at(-1)?.tier, "server");
  });
});

// ── pendingTier — the load-bearing one ───────────────────────────────────────

void describe("pendingTier", () => {
  void it("is null when nothing changed", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(draft, baseline), null);
  });

  void it("reports server for a server-only arg change", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(setArg(draft, 0, 0, num(0)), baseline), "server");
  });

  void it("reports cosmetic for a reward change", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(setArg(draft, 1, 0, num(500)), baseline), "cosmetic");
  });

  void it("reports structural for a begin-condition change", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(setArg(draft, 2, 0, num(80)), baseline), "structural");
  });

  void it("reports the WORST tier when several are touched, not the last", () => {
    // Understating this is the dangerous direction: the GM would be told a
    // restart suffices and ship no client patch.
    const { draft, baseline } = base();
    const both = setArg(setArg(draft, 2, 0, num(80)), 0, 0, num(0));
    assert.equal(pendingTier(both, baseline), "structural");
    // And in the other application order.
    const reversed = setArg(setArg(draft, 0, 0, num(0)), 2, 0, num(80));
    assert.equal(pendingTier(reversed, baseline), "structural");
  });

  void it("counts a removed command at its own tier", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(toggleRemoved(draft, 2), baseline), "structural");
    assert.equal(pendingTier(toggleRemoved(draft, 0), baseline), "server");
  });

  void it("counts a title change as cosmetic — the client shows it from its own copy", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier({ ...draft, title: "New" }, baseline), "cosmetic");
  });

  void it("counts an added command at its tier", () => {
    const { draft, baseline } = base();
    assert.equal(pendingTier(addCommand(draft, "SetEndCondItem"), baseline), "structural");
  });
});

// ── buildPutBody ─────────────────────────────────────────────────────────────

void describe("buildPutBody", () => {
  void it("omits both halves when nothing changed", () => {
    const { draft, baseline } = base();
    assert.deepEqual(buildPutBody(5100, draft, baseline), { id: 5100 });
  });

  void it("sends the title alone when only the title changed", () => {
    const { draft, baseline } = base();
    const body = buildPutBody(5100, { ...draft, title: "New" }, baseline);
    assert.equal(body.title, "New");
    assert.equal(body.commands, undefined, "an untouched command list was resent");
  });

  void it("sends the full command list when one arg changed", () => {
    // The writer replaces the setting group wholesale, so a partial list would
    // delete the commands it omitted.
    const { draft, baseline } = base();
    const body = buildPutBody(5100, setArg(draft, 2, 0, num(80)), baseline);
    assert.ok(body.commands, "the command list was omitted");
    assert.equal(body.commands.length, 3);
    assert.deepEqual(body.commands[2].args.map((a) => a.value), [80, 129]);
  });

  void it("drops removed commands from the emitted list", () => {
    const { draft, baseline } = base();
    const body = buildPutBody(5100, toggleRemoved(draft, 1), baseline);
    assert.deepEqual(body.commands?.map((c) => c.cmd), ["SetRepeat", "SetBeginCondLevel"]);
  });

  void it("keeps arg types intact so the writer can reuse original symbols", () => {
    const sym: QuestArg = { type: "sym", value: 26921 };
    const v = cmdView(0, "SetEndRewardItem", [num(-1), num(1), num(-1), sym, num(1)]);
    const one = { ...view(), commands: [v] };
    const d = draftFromView(one);
    const body = buildPutBody(5100, setArg(d, 0, 4, num(5)), draftFromView(one));
    assert.deepEqual(body.commands?.[0]?.args[3], { type: "sym", value: 26921 });
  });
});
