/**
 * Internal TLS TCP server for synchronous inter-server communication.
 *
 * Provides a request/response pattern over TLS for operations that require
 * immediate responses (e.g., checking if a player exists before handoff).
 *
 * @module IpcServer
 */

import * as tls from 'node:tls';
import { verifyIpcMessage } from './signing';

/**
 * Request payload structure.
 *
 * All requests must include:
 * - endpoint: The name of the endpoint being called
 * - data: The request data (arbitrary JSON)
 */
export interface IpcRequest {
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
 * Request handler function type.
 *
 * Receives the request payload and the client socket.
 * Can return any JSON-serializable data, or throw an error.
 */
export type RequestHandler = (
  request: IpcRequest,
  socket: tls.TLSSocket
) => Promise<unknown>;

/**
 * TLS options for the IPC server.
 */
export interface IpcServerTLSOptions {
  /**
   * Server certificate (PEM format).
   */
  cert: string;

  /**
   * Server private key (PEM format).
   */
  key: string;

  /**
   * CA certificate for client verification (optional).
   * If provided, clients must present a certificate signed by this CA.
   */
  ca?: string;

  /**
   * Require client certificates.
   * @default true
   */
  requestCert?: boolean;

  /**
   * Reject unauthorized connections.
   * @default true
   */
  rejectUnauthorized?: boolean;
}

/**
 * Internal TLS TCP server for synchronous IPC requests.
 *
 * This server provides a request/response pattern for operations that
 * need immediate feedback, complementing the async pub/sub of IpcBus.
 *
 * All incoming requests must be signed with HMAC-SHA256. The server
 * verifies the signature before processing any request.
 *
 * @example
 * ```ts
 * const server = new IpcServer(
 *   9999,
 *   { cert: '...', key: '...' },
 *   'secret-key'
 * );
 *
 * await server.start(async (req, socket) => {
 *   if (req.endpoint === 'get-session') {
 *     return getSessionToken(req.data as { token: string });
 *   }
 *   throw new Error('Unknown endpoint');
 * });
 * ```
 */
export class IpcServer {
  private server: tls.Server | null = null;

  /**
   * Create a new IpcServer instance.
   *
   * @param port - Port to listen on (must be internal-only, not exposed publicly)
   * @param tlsOptions - TLS configuration (cert, key, optional CA)
   * @param secret - Shared secret key for verifying request signatures
   */
  constructor(
    private port: number,
    private tlsOptions: IpcServerTLSOptions,
    private secret: string
  ) {}

  /**
   * Start the TLS server.
   *
   * The server will listen on the configured port and handle incoming
   * TLS connections. Each connection can send multiple requests.
   *
   * @param handler - Function to handle incoming requests
   * @throws Error if the server fails to bind to the port
   */
  async start(handler: RequestHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = tls.createServer({
        cert: this.tlsOptions.cert,
        key: this.tlsOptions.key,
        ca: this.tlsOptions.ca,
        requestCert: this.tlsOptions.requestCert ?? true,
        rejectUnauthorized: this.tlsOptions.rejectUnauthorized ?? true,
      });

      // Handle incoming connections
      this.server.on('secureConnection', (socket) => {
        this.handleConnection(socket, handler);
      });

      // Handle server errors
      this.server.on('error', (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      // Start listening
      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  /**
   * Handle a new TLS connection.
   *
   * Sets up the data handler for the socket.
   *
   * @param socket - TLS socket
   * @param handler - Request handler function
   */
  private handleConnection(socket: tls.TLSSocket, handler: RequestHandler): void {
    // Track accumulated data for this socket
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Try to extract complete messages
      // Messages are newline-delimited JSON
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        // Extract one message
        const messageBytes = buffer.subarray(0, newlineIndex);
        buffer = buffer.subarray(newlineIndex + 1);

        // Process the message
        this.processMessage(messageBytes, socket, handler).catch(() => {
          // Errors are logged inside processMessage
        });
        newlineIndex = buffer.indexOf('\n');
      }
    });

    // Handle socket errors
    socket.on('error', () => {
      // Silently destroy the socket
      socket.destroy();
    });
  }

  /**
   * Process a single message from a socket.
   *
   * Parses the message, verifies the signature, executes the handler,
   * and sends the response.
   *
   * @param messageBytes - Raw message bytes (JSON without newline)
   * @param socket - TLS socket to send response on
   * @param handler - Request handler function
   */
  private async processMessage(
    messageBytes: Buffer,
    socket: tls.TLSSocket,
    handler: RequestHandler
  ): Promise<void> {
    try {
      // Parse the request envelope
      const envelope = JSON.parse(messageBytes.toString()) as {
        ts: number;
        from: string;
        sig: string;
        payload: IpcRequest;
      };

      // Verify signature
      if (!verifyIpcMessage(
        this.secret,
        envelope.payload,
        envelope.sig,
        envelope.from,
        envelope.ts
      )) {
        // Invalid signature -- destroy the connection
        socket.destroy();
        return;
      }

      // Execute the handler
      const responseData = await handler(envelope.payload, socket);

      // Send success response
      const response: IpcResponseEnvelope = {
        success: true,
        data: responseData,
      };
      socket.write(JSON.stringify(response) + '\n');
    } catch (err) {
      // Send error response
      const response: IpcResponseEnvelope = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }

  /**
   * Close the server and stop accepting connections.
   *
   * Waits for all existing connections to close before resolving.
   */
  async close(): Promise<void> {
    if (this.server === null) {
      return;
    }

    const server = this.server;
    return new Promise((resolve) => {
      server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Get the port this server is configured to listen on.
   *
   * @returns Port number
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the server is currently listening.
   *
   * @returns true if server is listening, false otherwise
   */
  isListening(): boolean {
    return this.server?.listening ?? false;
  }
}
