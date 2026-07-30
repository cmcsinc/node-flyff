# Admin Form UX Rules

Governs every form in `packages/admin` — resource editors, character live-ops,
server config, and anything else that writes state. The admin panel is the only
place a human hand-edits game data, so a form that misrepresents its data is a
data-corruption bug, not a cosmetic one.

## The Cardinal Rule: No Raw JSON, Ever

**A user must never be shown or asked to edit JSON, YAML, or any other
serialization format in a form.** A `<textarea>` holding `JSON.stringify(value)`
is not a form field — it is a bug report waiting to happen.

```tsx
// FORBIDDEN ❌ — the "object field" anti-pattern
<textarea value={JSON.stringify(value, null, 2)}
  onChange={e => { try { onChange(JSON.parse(e.target.value)) } catch {} }} />

// REQUIRED ✅ — one labelled control per leaf value
<Vector3Field label="Position" value={value} onChange={onChange} />
```

Every value shape gets a real control:

| Data shape | Control |
| --- | --- |
| `number` (int) | number input, `step=1`, min/max from the schema |
| `number` (float) | number input, `step` matched to the field's precision |
| `boolean` | `Switch` with a visible label |
| `string` | text input; `textarea` only for genuine prose/source text |
| Known enum (`dst`, `equip_slot`, `job`, `item_kind2`, …) | searchable select showing **name + raw value** |
| `{x,y,z}` | three labelled number inputs on one row |
| `{min,max}` | two labelled number inputs on one row |
| Nested object | recurse — a titled sub-group of leaf fields |
| `T[]` of scalars | chip list + add/remove |
| `T[]` of objects | table, one typed control per column, add/remove row |
| Generated/derived text (script source) | read-only code block, clearly marked |

If a shape has no control yet, **add one**. Do not fall back to a JSON escape
hatch — an escape hatch becomes the default path.

## Parse and Preserve Types

The editor is the last thing between a human and a file the game server parses.

- **Never widen a type.** A field that came in as `number` must go out as
  `number`; `Number(e.target.value)` on an empty input yields `0`, not
  `undefined` — handle the empty case explicitly.
- **Never lose float precision.** `angle: 0.48` must not round-trip as `0`. Use
  `step="any"` or a precision matched to the source data.
- **Never invent keys.** A field absent from the source entry stays absent
  unless the user fills it in. Do not write `""`/`0` placeholders into the file.
- **Validate against the canonical schema** (`@flyff/resources` Zod schemas)
  server-side before the write. Client validation is UX; the server check is the
  guarantee.
- **Preserve file comments.** Zone/resource YAML carries hand-written comments;
  write via the yaml `Document` API, never `stringify(parse(file))`.

## Labels, Hints, Errors

- **Every control has a visible `<label>`** wired by `htmlFor`/`id`. A
  placeholder is never the only label.
- Use the shared `Field` primitive (`components/ui/field.tsx`) — it wires
  `aria-describedby` and `aria-invalid` for the hint and error.
- **Errors render next to the field they belong to**, never only at the form top,
  and never colour-only (`aria-invalid` + a text message).
- Hints explain the *game* meaning, not the type: "character.inc block — drives
  shop stock, dialog, outfit", not "string".
- Show the raw value alongside a friendly enum name (`HP Max (35)`), so a GM can
  cross-reference the C++ source.

## Layout & Spacing

- **One spacing scale**: `gap-x-6 gap-y-5` between fields, `space-y-1.5` inside a
  field (label → control → hint), `space-y-4` between sections. Do not mix
  `gap-1`, `gap-2`, and `gap-3` in one form.
- Group fields into titled sections in a fixed, meaningful order (Identity →
  Classification → Placement → Stats → …), not object-key order.
- **Never nest a card in a card.** The form owns its section cards; the page
  supplies only the header. A "Placement" card wrapping an "Identity" card
  wrapping fields is two frames too many.
- Leaf fields go in a 2-column grid at `md:`, 1 column below. Wide controls
  (populated tables, nested groups, code blocks) span the full width — and
  **within a section, narrow fields are ordered before wide ones** so a
  full-width row never leaves a hole beside a half-width neighbour.
- **Every row in a grid must be the same height.** A composite field (`{x,y,z}`,
  `{min,max}`) puts each part's name as an inline prefix *inside* the input, not
  on a line above it — a sub-label row makes that field taller than its
  neighbour and visibly breaks the grid.
- **One affordance per empty collection.** An empty table is a single dashed
  "No entries + Add row" block, not a disabled toggle plus a separate empty
  message plus a button.
- A hint for a collection sits **under the label**, not under the control —
  trailing a table it reads as a caption for the last row.
- **Controls are ≥ 36px tall** (44px on touch); inline table inputs are the one
  exception and must still have an accessible name.
- Actions live in **one** sticky bottom bar: primary save, revert, cancel, then
  any destructive action right-aligned. Never a second action row below the
  sticky bar — it slides underneath it.

## Feedback

- Save shows pending → success/error. Never a click with no response.
- Destructive actions (delete a placement, reset a field) go through
  `ConfirmDialog`, and say what is removed and whether it is reversible.
- After a successful write that the game reads at boot, say so ("restart the
  world server to apply") rather than implying it is live.

## Checklist (apply before shipping any admin form)

- [ ] Zero `JSON.stringify` / `JSON.parse` in a user-facing control?
- [ ] Every leaf value has a typed control matching its shape?
- [ ] Every known enum resolves to a name + raw value?
- [ ] Every control has a visible label wired by `htmlFor`?
- [ ] Errors render inline, with `aria-invalid` and text (not colour alone)?
- [ ] Numbers keep their integer/float type and precision on round-trip?
- [ ] Absent keys stay absent; no placeholder values written to disk?
- [ ] Server validates with the canonical Zod schema before writing?
- [ ] Sections in a fixed order, one spacing scale, no card-in-card nesting?
- [ ] Narrow fields ordered before wide ones; every grid row the same height?
- [ ] Exactly one sticky action bar, destructive action inside it?
- [ ] Save/delete give pending + result feedback?
