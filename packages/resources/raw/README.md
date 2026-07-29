# raw/ — editable source snapshot

Verbatim copy of the original Flyff resource files from `game/resource/`.
These are the **source of truth** for the generated YAML in `../data/`.

## Workflow

1. Edit a file here (e.g. `propMover.txt`).
2. Run `pnpm convert` (from `packages/resources/`).
3. `data/**/*.yml` is regenerated from `raw/`.

The game client keeps reading the originals in `game/resource/` — this folder
exists so the converter has a stable, version-controlled source to parse, and so
server-side edits don't touch the client's files.

## Files

| File | Enc | Produces |
| --- | --- | --- |
| `propMover.txt` + `propMover.txt.txt` + `defineObj.h` | UTF-8 / UTF-16LE | `data/movers/{monsters,npcs,player}.yml` |
| `Spec_Item.txt` + `propItem.txt.txt` + `defineItem.h` | UTF-8 / UTF-16LE | `data/items/{weapons,armors,consumables,materials,questitems}.yml` (v19 superset of `propItem.txt`; see `converters/items.ts`) |
| `propSkill.txt` + `propSkill.txt.txt` + `defineSkill.h` | UTF-16LE | `data/skills/<job>.yml` |
| `WorldDialog.txt` | UTF-8 | `data/dialogues/_strings.yml` |
| `character.inc` | UTF-16LE | `data/dialogues/_npc-map.yml` (block key → `szNpc` prefix) |
| `character.inc` + `defineItem.h` + `defineNeuz.h` | UTF-16LE | loaded directly by `loaders/characterInc.loader.ts` (outfit + menus + dialogFile) |
| `NpcScript.cpp` | UTF-8 | `data/dialogues/<prefix>.yml` per NPC (2845 states / 271 files) |

Neighbor files (`propMotion.txt`, `propCtrl.txt`, `mdlDyna.inc`,
`propJob.inc`, `World.inc`, remaining `define*.h`) are staged for future
converters (control objects, jobs, zones) — not yet wired.

## Gaps (TODO)

- Items: only `IK1_WEAPON`/`IK1_ARMOR`/`IK1_MAGIC`/`IK1_GENERAL` are bucketed;
  jewelry, quest, pets, cash are skipped (~1800 rows). Add buckets as needed.
- Skills: per-level stats (MP/FP cost, damage) live in `propSkillAdd.csv` and are
  not yet merged — each skill ships with one placeholder level.
- NPC outfits (`character.inc` `SetFigure`/`SetEquip`) not yet parsed.
- Dialogs: the simple call subset (`Say`/`Speak`/`AddKey`/`Exit`/`SetScriptTimer`/
  `LaunchQuest`) is structured; ~600 states use advanced calls (conditionals,
  `GetQuestState`/`BeginQuest`/`ChangeJob`/`CreateItem`/…) and are kept verbatim
  in `source:` for porting. The S→C reply runtime (`ScriptDlgService`) is also
  still a stub — data is migrated + linked, serving text to the client is the
  remaining `ponytail`.
