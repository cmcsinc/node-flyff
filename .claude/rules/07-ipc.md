# Inter-Server IPC Rules

Governs all communication between the Login, Cluster, and World servers via `@flyff/ipc`.

## Always Use @flyff/ipc — Never Raw Redis

```ts
// FORBIDDEN ❌
redis.publish('some-channel', JSON.stringify(data));

// REQUIRED ✅
await ipcBus.publish('player:handoff', { charId, token, worldId });
```

## Every Message Must Be HMAC-Signed

All messages published via `IpcBus` are automatically signed with `IPC_SECRET`. On the receiving end, always verify before processing:

```ts
// Subscriber side — always verify
ipcBus.subscribe('player:handoff', async (envelope) => {
  // IpcBus.subscribe() verifies the signature internally.
  // If you use raw Redis subscribe(), you MUST call verifyIpcMessage() yourself.
  const { charId, token, worldId } = envelope.payload;
  // ...
});
```

## Replay Attack Prevention

Reject any IPC message where:
- `envelope.ts` is missing
- `Date.now() - envelope.ts > 30_000` (message older than 30 seconds)
- `envelope.sig` does not match the HMAC of `payload + ts + from`

## Typed Schemas for Every Channel

Every IPC channel must have a Zod schema defined in `packages/ipc/src/schemas/`:

```ts
// packages/ipc/src/schemas/player.ts
export const PlayerHandoffSchema = z.object({
  charId: z.number().int().positive(),
  token:  z.string().length(32),
  worldId: z.string(),
});
```

Never publish or consume untyped payloads.

## Circuit Breaker

Long-running IPC calls (sync request/response via `IpcClient`) must be wrapped in a `CircuitBreaker`:

```ts
const breaker = new CircuitBreaker({ threshold: 5, resetMs: 30_000 });
const result = await breaker.call(() => ipcClient.request('get-session', { token }));
```

If the breaker is open, fail fast and return a fallback rather than queuing up retries.

## IPC Channel Naming Convention

Channels must follow the pattern `<domain>:<action>`:

| Channel | Direction | Payload |
| --- | --- | --- |
| `player:handoff` | Cluster → World | `{ charId, token, worldId }` |
| `player:disconnect` | World → Cluster | `{ charId, reason }` |
| `server:status` | World → Cluster | `{ serverId, playerCount, tick }` |
| `gm:broadcast` | Login → All | `{ message, scope }` |
| `session:invalidate` | Login → Cluster | `{ accountId }` |

## Internal TLS TCP (IpcServer/IpcClient)

- Use for **synchronous request/response** patterns (e.g., cluster asking world if a player exists).
- Bind only to `localhost` or the private VLAN — never expose on public interface.
- Authenticate with the shared `IPC_SECRET` on first connect before processing any messages.
