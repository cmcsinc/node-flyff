export const PACKETTYPE = Object.freeze({
  PING:                 0x00000014,
  KEEP_ALIVE:           0x00000018,

  CACHE_ADDR:           0x000000f2,
  PLAYER_LIST:          0x000000f3,
  CREATE_PLAYER:        0x000000f4,
  DELETE_PLAYER:        0x000000f5,
  GETPLAYERLIST:        0x000000f6,
  SEL_PLAYER:           0x000000f7,
  SAVE_PLAYER:          0x000000f8,
  CERTIFY:              0x000000fc,
  SRVR_LIST:            0x000000fd,
  ERROR:                0x000000fe,

  JOIN:                 0x0000ff00,
  LEAVE:                0x0000ff01,
  DESTROY_ALLPLAYERS:   0x0000ff02,
  CLOSE_ERROR:          0x0000ff04,
  PRE_JOIN:             0x0000ff05,

  CHAT:                 0x00ff0000,
  ADDOBJ:               0x00ff0002,
  REMOVEOBJ:            0x00ff0003,
  CONTROL:              0x00ff0004,
  CREATEITEM:           0x00ff0005,
  MOVEITEM:             0x00ff0006,
  DROPITEM:             0x00ff0007,
  DROPGOLD:             0x00ff0008,
  DOEQUIP:              0x00ff000b,
  DAMAGE:               0x00ff000c,
  SETEXPERIENCE:        0x00ff000d,
  MELEE_ATTACK:         0x00ff0010,
  MAGIC_ATTACK:         0x00ff0011,
  RANGE_ATTACK:         0x00ff0012,
  MOVERDEATH:           0x00ff0013,
  MOTION:               0x00ff0016,
  USESKILL:             0x00ff0020,
  DOUSEITEM:            0x00ff0021,
  SETTARGET:            0x00ff0023,
  REVIVAL:              0x00ff00c0,
  WHISPER:              0x00ff00d4,
  SAY:                  0x00ff00e0,
  SHOUT:                0x00ff00e1,
  DEFINEDTEXT:          0x00ff00ec,
  SCRIPTDLG:            0x00ff00b0,
  BUYITEM:              0x00ff00b3,

  REPLACE:              0x00ff0f00,
  SETQUEST:             0x00ff0ff3,
  SCRIPT_CREATE_ITEM:   0x00ff0ff4,
  SCRIPT_ADD_GOLD:      0x00ff0ff5,

  SNAPSHOT:             0xffffff00,
  PLAYERMOVED:          0xffffff01,
  PLAYERBEHAVIOR:       0xffffff02,
  PLAYERMOVED2:         0xffffff03,
  PLAYERCORR:           0xffffff05,
  MOVERDESTPOS:         0xffffff0f,
  PLAYERANGLE:          0xffffff29,
  QUERYGETPOS:          0xffffff08,
  GETPOS:               0xffffff09,

  GUILD:                0xffffff30,

  // v15 client → world — `WORLDSERVER/DPSrvr.cpp` handlers.
  MAP_KEY:              0xfffff000, // OnMapKey — per-.wld checksum as client loads the world
  QUERY_PLAYER_DATA:    0xf000f802, // OnQueryPlayerData — peer data when client cache stale
} as const);

export type PacketType = typeof PACKETTYPE[keyof typeof PACKETTYPE];

/**
 * v15 certifier login error codes — the `LONG lError` payload of the
 * `PACKETTYPE_ERROR` (0xfe) reply (`_Network/MsgHdr.h:1312-1346`).
 * The client's `OnError` switch (`Neuz/DPCertified.cpp:305-389`) shows a
 * localized message for each; an unmapped code (e.g. our old `0`) shows nothing.
 * 0 (`ERROR_OK`) is a deliberate no-op — never use it for a real failure.
 */
export const LOGIN_ERROR = Object.freeze({
  WRONG_PASSWORD:        120, // ERROR_FLYFF_PASSWORD — invalid credentials
  UNKNOWN_ACCOUNT:       121, // ERROR_FLYFF_ACCOUNT
  BLOCKED:               119, // ERROR_BLOCKGOLD_ACCOUNT — banned / gold-blocked
  THROTTLE_15SEC:        134, // ERROR_15SEC_PREVENT — login rate limit
  THROTTLE_15MIN:        135, // ERROR_15MIN_PREVENT
  ALREADY_LOGGED_IN:     103, // ERROR_DUPLICATE_ACCOUNT
  ILLEGAL_VERSION:       107, // ERROR_ILLEGAL_VER
  CERT_GENERAL:          136, // ERROR_CERT_GENERAL — DB/generic failure
} as const);

export type LoginError = typeof LOGIN_ERROR[keyof typeof LOGIN_ERROR];

export const SNAPSHOTTYPE = Object.freeze({
  CHAT:           0x0001,
  ACTMSG:         0x0002,
  DOEQUIP:        0x0006,
  SETPOS:         0x0010,
  SETLEVEL:       0x0011,
  SETEXPERIENCE:  0x0012,
  DAMAGE:         0x0013,
  UPDATE_MOVER:   0x0017,
  UPDATE_ITEM:    0x0018,
  USESKILL:       0x0019,
  SETDESTPARAM:   0x001c,
  RESETDESTPARAM: 0x001d,
  SETPOINTPARAM:  0x001e,
  GETPOS:         0x001f,
  SETFAME:        0x0040,
  SETSTATE:       0x006a,
  SETSCALE:       0x0039,
} as const);

export type SnapshotType = typeof SNAPSHOTTYPE[keyof typeof SNAPSHOTTYPE];

export function lookupPacketType(value: number): string | undefined {
  for (const [key, val] of Object.entries(PACKETTYPE)) {
    if (val === value) return key;
  }
  return undefined;
}

export function lookupSnapshotType(value: number): string | undefined {
  for (const [key, val] of Object.entries(SNAPSHOTTYPE)) {
    if (val === value) return key;
  }
  return undefined;
}
