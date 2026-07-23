/**
 * Cluster->World handoff token service.
 *
 * Issues single-use HMAC-signed tokens so the world server can authenticate a
 * client that just selected a character. Mirrors the login->cluster
 * `TokenService` pattern but keyed on `charId`. The token is cached briefly so
 * the world side can confirm it has not already been consumed.
 *
 * @module services/worldToken.service
 */

import crypto from 'node:crypto';
import { createHmac } from 'node:crypto';
import type { ICacheAdapter } from '@flyff/core/cache';
import type { WorldTokenService } from './charSelect.service';

export class WorldHandoffTokenService implements WorldTokenService {
  constructor(
    private cache: ICacheAdapter,
    private ipcSecret: string,
  ) {}

  private sign(data: string): string {
    return createHmac('sha256', this.ipcSecret).update(data).digest('hex');
  }

  async generateWorldHandoffToken(charId: number): Promise<string> {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const raw = `${charId}:${timestamp}:${random}`;
    const signature = this.sign(raw);
    const token = `${raw}:${signature}`;
    await this.cache.set(`worldhandoff:${token}`, String(charId), 60);
    return token;
  }
}
