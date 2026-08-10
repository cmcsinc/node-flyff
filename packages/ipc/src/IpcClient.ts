/**
 * Internal TLS TCP client for synchronous inter-server communication.
 *
 * Connects to an IpcServer to make synchronous requests that require
 * immediate responses.
 *
 * @module IpcClient
 */

import * as tls from 'node:tls';
import { signIpcMessage } from './signing';

/**
 * Request payload structure.
 *
 * All requests must include:
 * - endpoint: The name of the endpoint being called
 * - data: The request data (arbitrary JSON)
 */
export interface IpcRequestPayload {
  endpoint: string;
  data: unknown;
}

/**
 * Response envelope structure.
 *
 * Wraps the response payload with success/error information.
 */
export interface IpcResponseSuccess {
  success: true;
  data: unknown;
}

export interface IpcResponseError {
  success: false;
  error: string;
}

export type IpcResponseEnvelope = IpcResponseSuccess | IpcResponseError;

/**
 * TLS options for the IPC client.
 */
export interface IpcClientTLSOptions {
  /**
   * Client certificate (PEM format).
   */
  cert: string;

  /**
   * Client private key (PEM format).
   */
  key: string;

  /**
   * CA certificate for server verification (optional).
   * If provided, the server must present a certificate signed by this CA.
   */
  ca?: string;

  /**
   * Reject unauthorized certificates.
   * @default true
   */
  rejectUnauthorized?: boolean;
}

/**
 * Error thrown when a request times out.
 */
export class IpcTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcTimeoutError';
  }
}

/**
 * Error thrown when a request fails on the server.
 */
export class IpcRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcRequestError';
  }
}

/**
 * Internal TLS TCP client for synchronous IPC requests.
 *
 * Connects to an IpcServer and provides a request() method for
 * synchronous communication. Handles connection pooling,
 * message signing, and response parsing.
 *
 * @example
 * ```ts
 * const client = new IpcClient(
 *   'localhost',
 *   9999,
 *   { cert: '...', key: '...' },
 *   'secret-key',
 *   'world-1'
 * );
 *
 * await client.connect();
 *
 * try {
 *   const result = await client.request('get-session', { token: 'abc' });
 *   console.log(result);
 * } finally {
 *   await client.close();
 * }
 * ```
 */
export class IpcClient {
  private socket: tls.TLSSocket | null = null;

  /**
   * Create a new IpcClient instance.
   *
   * @param host - Server hostname or IP (must be internal-only)
   * @param port - Server port
   * @param tlsOptions - TLS configuration (cert, key, optional CA)
   * @param secret - Shared secret key for signing requests
   * @param serverId - Unique identifier for this server (included in signature)
   */
  constructor(
    private host: string,
    private port: number,
    private tlsOptions: IpcClientTLSOptions,
    private secret: string,
    private serverId: string
  ) {}

  /**
   * Connect to the IPC server.
   *
   * Establishes a TLS connection and waits for the secure handshake to complete.
   *
   * @throws Error if connection fails or TLS handshake fails
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = tls.connect({
        host: this.host,
        port: this.port,
        cert: this.tlsOptions.cert,
        key: this.tlsOptions.key,
        ca: this.tlsOptions.ca,
        rejectUnauthorized: this.tlsOptions.rejectUnauthorized ?? true,
      });

      this.socket.on('secureConnect', () => {
        resolve();
      });

      this.socket.on('error', (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * Send a request to the server and wait for a response.
   *
   * The request is signed with HMAC-SHA256 before sending.
   * The method waits for a response until the timeout is reached.
   *
   * @param endpoint - Endpoint name to call
   * @param data - Request data (must be JSON-serializable)
   * @param timeoutMs - Maximum time to wait for response (default 5000ms)
   * @returns Response data from the server
   * @throws IpcTimeoutError if timeout is reached
   * @throws IpcRequestError if the server returns an error
   * @throws Error if not connected or socket error occurs
   *
   * @example
   * ```ts
   * const result = await client.request('get-session', { token: 'abc' });
   * console.log(result);
   * ```
   */
  async request<T = unknown>(
    endpoint: string,
    data: unknown,
    timeoutMs = 5000
  ): Promise<T> {
    if (this.socket === null) {
      throw new Error('Not connected -- call connect() first');
    }

    const ts = Date.now();
    const from = this.serverId;
    const sig = signIpcMessage(this.secret, { endpoint, data }, from, ts);

    const payload = { endpoint, data };
    const envelope = { ts, from, sig, payload };
    const message = JSON.stringify(envelope) + '\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new IpcTimeoutError(`Request timeout after ${String(timeoutMs)}ms`));
      }, timeoutMs);

      // Track accumulated data for this request
      let buffer = Buffer.alloc(0);

      const dataHandler = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk]);

        // Try to extract a complete response
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          const responseBytes = buffer.subarray(0, newlineIndex);
          cleanup();

          try {
            const envelope = JSON.parse(responseBytes.toString()) as IpcResponseEnvelope;

            if (!envelope.success) {
              reject(new IpcRequestError(envelope.error));
              return;
            }

            resolve(envelope.data as T);
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            reject(new Error(`Failed to parse response: ${errorMessage}`));
          }
        }
      };

      const errorHandler = (): void => {
        cleanup();
        reject(new Error('Socket error during request'));
      };

      const socket = this.socket;
      const cleanup = (): void => {
        clearTimeout(timeout);
        socket.off('data', dataHandler);
        socket.off('error', errorHandler);
      };

      socket.on('data', dataHandler);
      socket.once('error', errorHandler);
      socket.write(message);
    });
  }

  /**
   * Close the connection to the server.
   *
   * Destroys the socket and cleans up resources.
   */
  close(): void {
    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Check if the client is currently connected.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === 'open';
  }

  /**
   * Get the host this client is configured to connect to.
   *
   * @returns Hostname or IP
   */
  getHost(): string {
    return this.host;
  }

  /**
   * Get the port this client is configured to connect to.
   *
   * @returns Port number
   */
  getPort(): number {
    return this.port;
  }
}
