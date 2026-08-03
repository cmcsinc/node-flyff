# Prose rewrite brief — propQuest.txt.txt + WorldDialog.txt

You are fixing **English grammar and readability** in Flyff quest/dialog strings.
These were machine-translated from Korean and carry broken grammar, wrong tense,
garbled idioms, and missing words. You make them read like natural English game
text. You do NOT redesign content.

## Input
A JSON array of `{ "id": "<token or row-index>", "text": "..." }`. Each `text`
is one string-table row after mechanical normalization already ran (spacing,
ellipsis, punctuation are already fixed).

## Output
Write a JSON array of `{ "id": "...", "text": "..." }` — ONLY rows you changed
— to the output path given in your task. Return a one-line summary:
`chunk <n>: <x>/<y> rewritten`. Do not print the rewrites.

## Hard rules — these NEVER change
1. **`id` is immutable.** Copy it verbatim. Never reorder, drop, or add rows.
2. **Markup survives verbatim**: `#b`, `#nb`, `#nc`, `#cffRRGGBB`, `<Name>`,
   `[label][]`, `(…)`, and the **literal two-char escape `\n`** (it is NOT a
   newline — it is the text `\` + `n` the client expands). Preserve each exactly.
3. **Proper nouns never change**: NPC names (Valin, Boboku, Julia, Martin,
   Rooney, <Heren>, <Billion>…), place names (Flaris, Darkon, Saint Morning,
   Madrigal, Kaillun…), item/monster names (Lawolf, Aibatt, Bang, Vision Stone,
   Beaujolais…), job names (Mercenary, Acrobat, Assist, Magician…). If unsure
   whether a word is a proper noun, treat it as one.
4. **Numbers, counts, quantities never change**: "20 Aibatt Wings", "level 15",
   "5 pieces". Do not round or alter.
5. **Meaning never changes.** You fix grammar, not facts. If a sentence's intent
   is unclear, make minimal tense/article/word-order fixes. Do not invent lore.
6. **Second person "I"**: quest text is the player's journal — keep first person.
   Dialog is an NPC speaking — keep second/third person as-is.

## Latin1 constraint (WorldDialog / dialog chunks only)
Dialog text must be representable in latin1 (codepoints U+0000–U+00FF). No curly
quotes, no em/en dashes, no ellipsis character. Use `"` not `"`/`"`, `...` not
`…`, `-` not `—`, `'` not `'`. Quest chunks (UTF-16LE) have no such limit.

## What to fix
- Wrong tense ("I should went" → "I should go")
- Missing articles ("I am now Mercenary" → "I am now a Mercenary")
- Broken word order, garbled idioms, fragments run together
- Subject/verb disagreement, pluralization
- Run-on sentences with no punctuation between clauses
- Obvious word-choice errors from mistranslation ("stationeries" → "stationery
  supplies", "doc" → "doctor" only if clearly a title — when unsure, keep it)

## What to leave alone
- Intentional style: exclamations, "hoho"/"hehehe"/"whoops", ellipses for pause
- Korean text (rows with Hangul) — return unchanged, omit from output
- Already-correct sentences — omit from output (only emit changes)
- Numbers, names, markup — per rules above

## Style target
Concise, natural, in-voice for a mid-2000s MMORPG. Match the tone of nearby
strings. When a sentence is fine except for one word, change only that word.
