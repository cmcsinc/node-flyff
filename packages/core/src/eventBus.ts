/**
 * Typed EventEmitter wrapper for the Flyff emulator.
 *
 * ## Usage
 * ```ts
 * import { createEventBus } from '@flyff/core/eventBus';
 *
 * type MyEvents = {
 *   'player:login':  [charId: number, name: string];
 *   'player:logout': [charId: number];
 * };
 *
 * const bus = createEventBus<MyEvents>();
 * bus.on('player:login', (charId, name) => { ... });
 * bus.emit('player:login', 42, 'Aran');
 * ```
 *
 * @module eventBus
 */

import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Map of event names to the tuple of argument types for that event.
 *
 * @example
 * ```ts
 * type AppEvents = {
 *   'auth:ok':   [accountId: number];
 *   'auth:fail': [reason: string];
 * };
 * ```
 */
export type EventMap = Record<string, unknown[]>;

/**
 * Typed EventBus interface.  All methods are fully typed to the `Events` map,
 * so emitting the wrong arguments or listening to an unknown event is a
 * compile-time error.
 */
export interface EventBus<Events extends EventMap> {
  /** Register a persistent listener for `event`. */
  on<E extends keyof Events>(event: E, listener: (...args: Events[E]) => void): void;
  /** Remove a previously registered listener. */
  off<E extends keyof Events>(event: E, listener: (...args: Events[E]) => void): void;
  /** Register a listener that fires only once then removes itself. */
  once<E extends keyof Events>(event: E, listener: (...args: Events[E]) => void): void;
  /** Emit `event` with the given arguments. Returns `true` if any listener handled it. */
  emit<E extends keyof Events>(event: E, ...args: Events[E]): boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new typed `EventBus` instance backed by Node's `EventEmitter`.
 *
 * @returns A typed `EventBus<Events>` object.
 */
export function createEventBus<Events extends EventMap>(): EventBus<Events> {
  const emitter = new EventEmitter();

  return {
    on<E extends keyof Events>(
      event: E,
      listener: (...args: Events[E]) => void,
    ): void {
      emitter.on(event as string, listener as (...a: unknown[]) => void);
    },

    off<E extends keyof Events>(
      event: E,
      listener: (...args: Events[E]) => void,
    ): void {
      emitter.off(event as string, listener as (...a: unknown[]) => void);
    },

    once<E extends keyof Events>(
      event: E,
      listener: (...args: Events[E]) => void,
    ): void {
      emitter.once(event as string, listener as (...a: unknown[]) => void);
    },

    emit<E extends keyof Events>(event: E, ...args: Events[E]): boolean {
      return emitter.emit(event as string, ...args);
    },
  };
}
