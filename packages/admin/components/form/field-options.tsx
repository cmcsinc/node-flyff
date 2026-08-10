'use client';

import { createContext, useContext } from 'react';
import type { EnumOption } from '@/lib/field-schema';

/**
 * Runtime-injected option lists for fields whose valid values live behind the
 * server-only resource index (character.inc keys, NPC mover ids).
 *
 * Static registries in `field-schema.ts` still work for everything else; this
 * context wins when a key exists in both places.
 */

const FieldOptionsCtx = createContext<Record<string, EnumOption[]>>({});

/** Wrap a subtree with runtime option lists. */
export function FieldOptionsProvider({
  options,
  children,
}: {
  options: Record<string, EnumOption[]>;
  children: React.ReactNode;
}): React.JSX.Element {
  return <FieldOptionsCtx.Provider value={options}>{children}</FieldOptionsCtx.Provider>;
}

/**
 * Options injected by the current page, or an empty record when no provider is
 * mounted (non-NPC forms, storybook, tests).
 */
export function useFieldOptions(): Record<string, EnumOption[]> {
  return useContext(FieldOptionsCtx);
}
