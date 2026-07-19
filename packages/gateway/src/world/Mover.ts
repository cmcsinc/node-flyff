export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MoverType = 'player' | 'npc' | 'monster';

export interface Mover {
  id: number;
  type: MoverType;
  name: string;
  pos: Vec3;
  angle: number;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  classId: number;
  gender: number;
  hairStyle: number;
  hairColor: number;
  faceStyle: number;
  skinColor: number;
  state: 'idle' | 'walking' | 'running' | 'dead';
  destPos: Vec3 | null;
  lastUpdate: number;
}
