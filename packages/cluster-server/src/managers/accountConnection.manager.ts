/**
 * AccountConnectionManager — live account → client-socket table.
 *
 * Mirrors the C++ cluster's `g_UserMng` lifecycle
 * (`LOGINSERVER/DPLoginSrvr.cpp` `AddUser` / `OnRemoveConnection`): an account
 * may hold at most one live cluster connection. When the same account connects
 * again (client "went back" without the old socket closing yet), the stale
 * socket is destroyed so the new one wins — otherwise the account is wedged
 * until the client process is killed.
 *
 * Cleanup is automatic: `bind()` attaches a one-shot `close` listener that
 * removes the entry (only if it still points at that socket), so a normal
 * disconnect frees the account for immediate re-login.
 *
 * @module managers/accountConnection.manager
 */

import type { Socket } from 'node:net';

export class AccountConnectionManager {
  private readonly byAccount = new Map<string, Socket>();
  /** Sockets that already have their `close` cleanup listener attached. */
  private readonly bound = new WeakSet<Socket>();

  /**
   * Bind `account` to `socket`, kicking any prior socket for that account.
   *
   * @returns the stale socket that was displaced (already `destroy()`-ed), or
   *   null when this is the account's first/only connection.
   */
  bind(account: string, socket: Socket): Socket | null {
    const prev = this.byAccount.get(account);
    this.byAccount.set(account, socket);

    if (!this.bound.has(socket)) {
      this.bound.add(socket);
      socket.once('close', () => {
        // Only clear if we still own the slot — a newer connect may have
        // already replaced us (in which case the newer socket must survive).
        if (this.byAccount.get(account) === socket) this.byAccount.delete(account);
      });
    }

    if (prev && prev !== socket) {
      prev.destroy();
      return prev;
    }
    return null;
  }

  /** The live socket for `account`, or null. */
  get(account: string): Socket | null {
    return this.byAccount.get(account) ?? null;
  }

  /** Number of accounts with a live cluster connection. */
  get size(): number {
    return this.byAccount.size;
  }
}
