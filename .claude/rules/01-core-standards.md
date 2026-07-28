# Core Coding Standards

These rules apply to every file in the project without exception.

## Port Discipline (This Project's Prime Directive)

**This is a port of a working C++ server, not new development.** The C++ source in
`game/source/` is the spec. Every feature, bug, formula, packet layout, and game rule
already exists there in working form.

- **Read the C++ before writing code.** If a task names a mechanic, formula, or packet,
  find its C++ implementation in `game/source/` (see the `flyff-research` skill for how)
  and translate it. Do not design from scratch, "best-effort," or invent logic.
- **Translate faithfully.** Match field order, types, rounding, and pipeline position
  exactly. Where a simplification is unavoidable (a downstream system doesn't exist yet),
  leave a `// ponytail:` comment naming the unported part so it can be wired later.
- **The C++ wins disagreements.** If a design idea or existing TS code contradicts the
  C++, the C++ is correct. Fix the TS to match — do not "fix" the C++ behavior.
- **When you can't port 1:1, surface it.** Never silently work around the C++; tell the
  user what diverged and why, and let them decide before you proceed.
- **Reference the audit.** `docs/c++-fidelity-audit.md` tracks known TS↔C++ deviations.
  Consult it before implementing, and add to it when you find a new divergence.

## TypeScript

- **Strict mode is mandatory.** `"strict": true` in every `tsconfig.json`. Zero `any`. Use `unknown` + type narrowing instead.
- **No `@ts-ignore` or `@ts-expect-error`** unless accompanied by a comment explaining why it is unavoidable.
- **No type assertions** (`as SomeType`) unless you have just narrowed the type with a runtime check.
- **ESM only.** Every file uses `import`/`export`. No `require()`, no `.cjs` files. Imports are **extensionless** (moduleResolution `Bundler`): dev `tsx` resolves via `tsconfig.base.json` `paths` → `packages/*/src`, prod resolves via package `exports` → `dist/*.js`.
- **`"type": "module"`** in every `package.json`.
- **Consistent type imports.** Always use `import type { Foo }` for types that are only used as types — never mix value and type imports on the same line without the `type` keyword.

## Naming

- **Files:** `<feature>.<layer>.ts` — e.g. `auth.handler.ts`, `character.repo.ts`, `zone.manager.ts`, `combat.system.ts`.
- **Game entity classes** mirror C++ originals: `CPlayer`, `CMover`, `CCtrl`, `CItem`. Keep the `C` prefix.
- **C++ fields on entities:** preserve `m_` prefix and Hungarian notation — `m_nLevel`, `m_szName`, `m_vPos`, `m_dwCharId`.
- **New code** (not mirroring C++): plain `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types.
- **Interfaces:** `I` prefix — `ICacheAdapter`, `ICharacterRow`, `IpcMessage`.
- **Opcode constants:** preserve original C++ `SNSP_*` naming exactly.
- **Enums/constant sets:** `Object.freeze({ KEY: value } as const)` or `const enum`.

## Functions & Files

- **Max function length: 50 lines.** Extract helper functions if exceeded.
- **Max file length: 300 lines.** Split into submodules if exceeded.
- **All async functions** must have explicit error handling — either `try/catch` or a `.catch()` chain at the call site.
- **No `process.exit()`** in library code — only allowed in server entry-point `index.ts` files.

## Imports

Order must be:
1. Node.js built-ins (`node:fs`, `node:path`, `node:net`, …)
2. External npm packages (`zod`, `pino`, `knex`, …)
3. Internal `@flyff/*` workspace packages
4. Relative imports (`./`, `../`)

## Logging

- **Use `pino` logger always.** Never `console.log` in non-script files.
- Log level mapping: `logger.error` for caught errors that affect the player/request, `logger.warn` for suspicious/recoverable conditions, `logger.info` for lifecycle events, `logger.debug` for verbose diagnostics.
- Always pass a structured context object as the first argument: `logger.info({ charId, action }, 'Player moved')`.

## Errors

- All custom errors must extend `FlyffError` from `@flyff/core/errors`.
- The three standard subclasses are `PacketError`, `AuthError`, `GameError`.
- Never throw plain `Error` — always throw a typed subclass so handlers can discriminate.
