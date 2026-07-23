/**
 * @flyff/ipc -- Public API
 *
 * Secure inter-server IPC framework for the Flyff emulator:
 *   - Internal IPC opcode constants (`IPC_OP`)
 *   - Registration token utilities (HMAC-SHA256 derived)
 *   - Zod schemas for all registration and handshake messages
 *
 * @module @flyff/ipc
 */

// ---------------------------------------------------------------------------
// IPC Opcode constants
// ---------------------------------------------------------------------------
export { IPC_OP } from './opcodes';
export type { IpcOpcode } from './opcodes';

// ---------------------------------------------------------------------------
// Registration token utilities
// ---------------------------------------------------------------------------
export {
  computeRegistrationToken,
  verifyRegistrationToken,
} from './registration';
export type { ServerType } from './registration';

// ---------------------------------------------------------------------------
// Zod schemas -- registration & handshake messages
// ---------------------------------------------------------------------------
export {
  // World <-> Cluster
  RegisterWorldRequestSchema,
  RegisterWorldAckSchema,
  WorldHeartbeatSchema,
  WorldHeartbeatAckSchema,
  UnregisterWorldSchema,
  // Cluster <-> Login
  RegisterClusterRequestSchema,
  RegisterClusterAckSchema,
  ClusterHeartbeatSchema,
  ClusterHeartbeatAckSchema,
  UnregisterClusterSchema,
  // Player handoff
  PlayerEnterWorldSchema,
  PlayerEnterWorldAckSchema,
} from './schemas/registration.schema';

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------
export type {
  RegisterWorldRequest,
  RegisterWorldAck,
  WorldHeartbeat,
  WorldHeartbeatAck,
  UnregisterWorld,
  RegisterClusterRequest,
  RegisterClusterAck,
  ClusterHeartbeat,
  ClusterHeartbeatAck,
  UnregisterCluster,
  PlayerEnterWorld,
  PlayerEnterWorldAck,
} from './schemas/registration.schema';

// ---------------------------------------------------------------------------
// Core IPC Framework
// ---------------------------------------------------------------------------
export { signIpcMessage, verifyIpcMessage } from './signing';
export { CircuitBreaker, CircuitOpenError } from './circuit';
export type { CircuitBreakerOptions, CircuitState } from './circuit';
export { IpcBus } from './IpcBus';
export type { IpcMessageEnvelope, MessageHandler } from './IpcBus';
export { LocalBus, createLocalBus } from './localBus';
export type { LocalBusLike, LocalBusOptions } from './localBus';
export { IpcServer } from './IpcServer';
export type { IpcRequest, IpcResponseEnvelope, RequestHandler, IpcServerTLSOptions } from './IpcServer';
export { IpcClient, IpcTimeoutError, IpcRequestError } from './IpcClient';
export type { IpcRequestPayload, IpcClientTLSOptions } from './IpcClient';
