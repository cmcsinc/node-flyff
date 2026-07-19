import type { Mover, Vec3 } from './Mover.js';
import type { ClientSession } from '../ClientSession.js';
import {
  PacketWriter,
  PACKETTYPE,
  SNAPSHOTTYPE,
  framePacket,
  createLogger,
} from '@flyff/core';

const logger = createLogger({ module: 'world' });

const BROADCAST_RADIUS = 5000;
const SNAPSHOT_INTERVAL_MS = 100;

export class World {
  private movers = new Map<number, Mover>();
  private sessions = new Map<number, ClientSession>();
  private nextMoverId = 1;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private pendingSnapshots = new Map<number, PacketWriter[]>();

  start(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => this.flushSnapshots(), SNAPSHOT_INTERVAL_MS);
    logger.info('World simulation started');
  }

  stop(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    logger.info('World simulation stopped');
  }

  addPlayer(moverId: number, session: ClientSession, mover: Mover): void {
    this.movers.set(moverId, mover);
    this.sessions.set(moverId, session);

    for (const [otherId, other] of this.movers) {
      if (otherId === moverId) continue;
      if (this.distance(mover.pos, other.pos) <= BROADCAST_RADIUS) {
        this.sendAddObj(session, other);
        const otherSession = this.sessions.get(otherId);
        if (otherSession) {
          this.sendAddObj(otherSession, mover);
        }
      }
    }
  }

  removePlayer(moverId: number): Mover | null {
    const mover = this.movers.get(moverId);
    if (!mover) return null;

    const session = this.sessions.get(moverId);

    for (const [otherId, other] of this.movers) {
      if (otherId === moverId) continue;
      if (this.distance(mover.pos, other.pos) <= BROADCAST_RADIUS) {
        const otherSession = this.sessions.get(otherId);
        if (otherSession) {
          this.sendRemoveObj(otherSession, moverId);
        }
      }
    }

    this.movers.delete(moverId);
    this.sessions.delete(moverId);
    return mover;
  }

  getMover(moverId: number): Mover | undefined {
    return this.movers.get(moverId);
  }

  updatePosition(moverId: number, pos: Vec3, angle: number): void {
    const mover = this.movers.get(moverId);
    if (!mover) return;

    mover.pos = pos;
    mover.angle = angle;
    mover.lastUpdate = Date.now();

    this.queueSnapshot(moverId, (w) => {
      w.writeWord(SNAPSHOTTYPE.SETPOS);
      w.writeFloat(pos.x);
      w.writeFloat(pos.y);
      w.writeFloat(pos.z);
      w.writeFloat(angle);
    });
  }

  updateDestination(moverId: number, dest: Vec3): void {
    const mover = this.movers.get(moverId);
    if (!mover) return;

    mover.destPos = dest;
    mover.state = 'walking';

    this.queueSnapshot(moverId, (w) => {
      w.writeWord(SNAPSHOTTYPE.SETDESTPARAM);
      w.writeDword(0);
      w.writeFloat(dest.x);
      w.writeFloat(dest.y);
      w.writeFloat(dest.z);
    });
  }

  private queueSnapshot(moverId: number, build: (w: PacketWriter) => void): void {
    let queue = this.pendingSnapshots.get(moverId);
    if (!queue) {
      queue = [];
      this.pendingSnapshots.set(moverId, queue);
    }
    const writer = new PacketWriter();
    build(writer);
    queue.push(writer);
  }

  private flushSnapshots(): void {
    if (this.pendingSnapshots.size === 0) return;

    for (const [moverId, queue] of this.pendingSnapshots) {
      if (queue.length === 0) continue;
      const mover = this.movers.get(moverId);
      if (!mover) continue;

      const snapshotWriter = new PacketWriter();
      snapshotWriter.writeDword(PACKETTYPE.SNAPSHOT);
      snapshotWriter.writeDword(moverId);
      snapshotWriter.writeWord(queue.length);

      for (const w of queue) {
        const data = w.build();
        snapshotWriter.writeBytes(data);
      }

      const payload = snapshotWriter.build();

      for (const [otherId, other] of this.movers) {
        if (otherId === moverId) continue;
        if (this.distance(mover.pos, other.pos) <= BROADCAST_RADIUS) {
          const session = this.sessions.get(otherId);
          if (session && session.ws.readyState === 1) {
            session.ws.send(framePacket(payload));
          }
        }
      }
    }

    this.pendingSnapshots.clear();
  }

  private sendAddObj(session: ClientSession, mover: Mover): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.ADDOBJ);
    writer.writeDword(0);
    writer.writeDword(mover.id);
    writer.writeDword(0);
    writer.writeByte(mover.type === 'player' ? 0 : 1);
    writer.writeDword(mover.id);
    writer.writeString(mover.name);
    writer.writeDword(mover.classId);
    writer.writeByte(mover.gender);
    writer.writeByte(mover.hairStyle);
    writer.writeByte(mover.hairColor);
    writer.writeByte(mover.faceStyle);
    writer.writeByte(mover.skinColor);
    writer.writeDword(mover.level);
    writer.writeFloat(mover.pos.x);
    writer.writeFloat(mover.pos.y);
    writer.writeFloat(mover.pos.z);
    writer.writeFloat(mover.angle);
    writer.writeDword(mover.hp);
    writer.writeDword(mover.maxHp);
    writer.writeDword(mover.mp);
    writer.writeDword(mover.maxMp);

    session.ws.send(framePacket(writer.build()));
  }

  private sendRemoveObj(session: ClientSession, moverId: number): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.REMOVEOBJ);
    writer.writeDword(0);
    writer.writeDword(moverId);
    writer.writeDword(0);

    session.ws.send(framePacket(writer.build()));
  }

  distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  allocateMoverId(): number {
    return this.nextMoverId++;
  }

  getMoversInRadius(pos: Vec3, radius: number): Mover[] {
    const result: Mover[] = [];
    for (const mover of this.movers.values()) {
      if (this.distance(pos, mover.pos) <= radius) {
        result.push(mover);
      }
    }
    return result;
  }
}
