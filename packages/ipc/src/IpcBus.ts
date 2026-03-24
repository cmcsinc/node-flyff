/**
 * Redis pub/sub bus for asynchronous inter-server messaging.
 *
 * Provides a publish/subscribe interface over Redis with automatic
 * HMAC-SHA256 signing and verification of all messages.
 *
 * @module IpcBus
 */

import { signIpcMessage, verifyIpcMessage } from './signing.js';

/**
 * Envelope wrapper for all IPC messages published on the bus.
 *
 * Every message includes:
 * - ts: Timestamp for replay attack prevention
 * - from: Server identifier that sent the message
 * - sig: HMAC-SHA256 signature covering payload+ts+from
 * - payload: The actual message data
 *
 * @template T - Type of the payload data
 */
export interface IpcMessageEnvelope<T = unknown> {
  ts: number;
  from: string;
  sig: string;
  payload: T;
}

/**
 * Minimal Redis interface for IpcBus.
 *
 * Only includes the methods we actually use from ioredis.
 */
interface IpcRedis {
  on(event: 'message', handler: (channel: string, data: string) => void): void;
  publish(channel: string, data: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  quit(): Promise<void>;
}

/**
 * Message handler function type.
 *
 * Receives the payload and the sender's server identifier.
 * Can be async or sync.
 *
 * @template T - Type of the payload data
 */
export type MessageHandler<T> = (payload: T, from: string) => void | Promise<void>;

/**
 * Redis pub/sub bus with automatic HMAC signing.
 *
 * All published messages are automatically signed with HMAC-SHA256.
 * All received messages are verified before being dispatched to handlers.
 *
 * Messages older than 30 seconds are silently rejected (replay attack prevention).
 * Messages with invalid signatures are silently dropped (tampering detection).
 *
 * @example
 * ```ts
 * const bus = new IpcBus(redis, 'secret-key', 'world-1');
 *
 * // Subscribe to messages
 * await bus.subscribe('player:handoff', async (payload, from) => {
 *   console.log(`Player ${payload.charId} from ${from}`);
 * });
 *
 * // Publish messages
 * await bus.publish('player:handoff', { charId: 123, token: 'abc' });
 *
 * // Cleanup
 * await bus.close();
 * ```
 */
export class IpcBus {
  private channels = new Map<string, MessageHandler<unknown>>();
  private subscribedChannels = new Set<string>();

  /**
   * Create a new IpcBus instance.
   *
   * @param redis - Redis client (must have pub/sub capabilities)
   * @param secret - Shared secret key for signing (from IPC_SECRET env var)
   * @param serverId - Unique identifier for this server (e.g., 'world-1', 'cluster-1')
   */
  constructor(
    private redis: IpcRedis,
    private secret: string,
    private serverId: string
  ) {
    // Set up Redis message listener
    // Note: This only works if redis is NOT in subscriber mode yet
    this.redis.on('message', (channel: string, data: string) => {
      this.handleMessage(channel, data);
    });
  }

  /**
   * Publish a message to a channel.
   *
   * The message will be signed with HMAC-SHA256 before publishing.
   * All subscribers to the channel will receive the message.
   *
   * @param channel - Channel name (e.g., 'player:handoff', 'server:status')
   * @param payload - Message payload (must be JSON-serializable)
   * @throws Error if Redis publish fails
   *
   * @example
   * ```ts
   * await bus.publish('player:handoff', { charId: 123, token: 'abc' });
   * ```
   */
  async publish<T>(channel: string, payload: T): Promise<void> {
    const ts = Date.now();
    const from = this.serverId;
    const sig = signIpcMessage(this.secret, payload, from, ts);

    const envelope: IpcMessageEnvelope<T> = { ts, from, sig, payload };
    await this.redis.publish(channel, JSON.stringify(envelope));
  }

  /**
   * Subscribe to messages on a channel.
   *
   * Only one handler per channel is allowed. Subscribing again to the
   * same channel will replace the previous handler.
   *
   * All received messages are verified for signature and freshness
   * before being passed to the handler. Invalid messages are dropped silently.
   *
   * @param channel - Channel name to subscribe to
   * @param handler - Function to call when messages arrive
   * @throws Error if Redis subscribe fails
   *
   * @example
   * ```ts
   * await bus.subscribe('player:handoff', async (payload, from) => {
   *   console.log(`Player ${payload.charId} from ${from}`);
   * });
   * ```
   */
  async subscribe<T>(
    channel: string,
    handler: MessageHandler<T>
  ): Promise<void> {
    // Store the handler
    this.channels.set(channel, handler as MessageHandler<unknown>);

    // Only subscribe to Redis if we haven't already
    if (!this.subscribedChannels.has(channel)) {
      await this.redis.subscribe(channel);
      this.subscribedChannels.add(channel);
    }
  }

  /**
   * Unsubscribe from a channel.
   *
   * Removes the handler and unsubscribes from Redis if no other
   * handlers are registered for this channel.
   *
   * @param channel - Channel name to unsubscribe from
   */
  unsubscribe(channel: string): void {
    this.channels.delete(channel);

    if (this.subscribedChannels.has(channel)) {
      this.redis.unsubscribe(channel);
      this.subscribedChannels.delete(channel);
    }
  }

  /**
   * Handle an incoming message from Redis.
   *
   * Parses the message, verifies the signature, checks the timestamp,
   * and dispatches to the registered handler if valid.
   *
   * Invalid messages (bad signature, too old, malformed JSON) are
   * dropped silently to prevent log spam and DoS.
   *
   * @param channel - Channel the message was published on
   * @param data - Raw message data (JSON string)
   */
  private handleMessage(channel: string, data: string): void {
    const handler = this.channels.get(channel);
    if (!handler) {
      return; // No handler registered for this channel
    }

    try {
      const envelope = JSON.parse(data) as IpcMessageEnvelope;

      // Verify signature and freshness
      if (!verifyIpcMessage(
        this.secret,
        envelope.payload,
        envelope.sig,
        envelope.from,
        envelope.ts
      )) {
        return; // Invalid signature or stale message — drop silently
      }

      // Dispatch to handler (catch errors to prevent crashing the bus)
      Promise.resolve(handler(envelope.payload, envelope.from)).catch((err) => {
        // Log handler errors but don't crash
        // TODO: Use pino logger when available
        console.error(`Error in IPC handler for channel ${channel}:`, err);
      });
    } catch {
      // Malformed JSON or other parsing error — drop silently
    }
  }

  /**
   * Close the bus and clean up resources.
   *
   * Unsubscribes from all channels and clears the handler map.
   * Does NOT close the Redis connection — that's the caller's responsibility.
   */
  async close(): Promise<void> {
    // Unsubscribe from all channels
    for (const channel of this.subscribedChannels) {
      await this.redis.unsubscribe(channel);
    }

    // Clear state
    this.channels.clear();
    this.subscribedChannels.clear();
  }

  /**
   * Get the list of currently subscribed channels.
   *
   * @returns Set of channel names
   */
  getSubscribedChannels(): Set<string> {
    return new Set(this.subscribedChannels);
  }

  /**
   * Get the server ID for this bus instance.
   *
   * @returns Server identifier
   */
  getServerId(): string {
    return this.serverId;
  }
}
