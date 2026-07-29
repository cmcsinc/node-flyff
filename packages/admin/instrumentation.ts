/**
 * Next.js instrumentation hook — runs once per server process at startup.
 *
 * Preloads the game resource index so the first request that needs an item,
 * skill, or quest definition doesn't pay the YAML parse cost.
 *
 * @module instrumentation
 */

export async function register(): Promise<void> {
  // Guarded so the Edge Runtime bundle never pulls in `node:fs` (via the
  // resource loaders). `NEXT_RUNTIME` is inlined at build time, so the whole
  // block is dead-code-eliminated from the edge chunk.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ warmResourceCache }, { TYPE_DIRS }] = await Promise.all([
      import("./lib/resource-cache"),
      import("./lib/resources"),
    ]);
    await warmResourceCache(Object.values(TYPE_DIRS));
  }
}
