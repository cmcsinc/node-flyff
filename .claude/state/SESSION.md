# Session

- **Active goal:** Diagnose v19 JOIN crash at `CItemContainer<CItemElem>::Serialize` (`Item.h:938`).
- **Branch:** `feat/v19-client-switch`
- **Progress:** Found v19 `__3RD_LEGEND16` serializer-size drift. `MAX_JOB` was 32 instead of 40 and `MAX_SKILL_JOB` was 45 instead of 51. Both fields occur before inventory/bank containers in `CMover::Serialize`, shifting client reads by 80 bytes and producing an invalid container slot index.
- **Changes:** Updated v19 constants, JOIN writer, client-mirror byte walk, and all stale JOIN byte-size assertions. Existing completed-quest BYTE cap remains included.
- **Verification:** `pnpm --filter @flyff/world-server exec tsx --test test/**/*.test.ts` — 227 pass, 0 fail. Full recursive `tsc --noEmit` has existing cross-package `rootDir` errors unrelated to this diff.
- **Next step:** Restart world server (`pnpm server:world`) so it loads source changes. User must test real v19 JOIN; task remains in progress until user confirms.
