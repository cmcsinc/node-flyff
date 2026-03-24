/**
 * @flyff/ipc — Public API
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
export { IPC_OP } from './opcodes.js';
export type { IpcOpcode } from './opcodes.js';

// ---------------------------------------------------------------------------
// Registration token utilities
// ---------------------------------------------------------------------------
export {
  computeRegistrationToken,
  verifyRegistrationToken,
} from './registration.js';
export type { ServerType } from './registration.js';

// ---------------------------------------------------------------------------
// Zod schemas — registration & handshake messages
// ---------------------------------------------------------------------------
export {
  // World ↔ Cluster
  RegisterWorldRequestSchema,
  RegisterWorldAckSchema,
  WorldHeartbeatSchema,
  WorldHeartbeatAckSchema,
  UnregisterWorldSchema,
  // Cluster ↔ Login
  RegisterClusterRequestSchema,
  RegisterClusterAckSchema,
  ClusterHeartbeatSchema,
  ClusterHeartbeatAckSchema,
  UnregisterClusterSchema,
  // Player handoff
  PlayerEnterWorldSchema,
  PlayerEnterWorldAckSchema,
} from './schemas/registration.schema.js';

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
} from './schemas/registration.schema.js';

// ---------------------------------------------------------------------------
// Core IPC Framework
// ---------------------------------------------------------------------------
export { signIpcMessage, verifyIpcMessage } from './signing.js';
export { CircuitBreaker, CircuitOpenError } from './circuit.js';
export type { CircuitBreakerOptions, CircuitState } from './circuit.js';
export { IpcBus } from './IpcBus.js';
export type { IpcMessageEnvelope, MessageHandler } from './IpcBus.js';
export { IpcServer } from './IpcServer.js';
export type { IpcRequest, IpcResponseEnvelope, RequestHandler, IpcServerTLSOptions } from './IpcServer.js';
export { IpcClient, IpcTimeoutError, IpcRequestError } from './IpcClient.js';
export type { IpcRequestPayload, IpcClientTLSOptions } from './IpcClient.js';
