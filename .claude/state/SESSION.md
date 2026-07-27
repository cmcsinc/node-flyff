# Session: 2026-07-27

## Current Task
Implement full Party system (social + shared EXP + loot share). Plan approved.
Plan file: C:\Users\Cyan\.claude\plans\encapsulated-wibbling-plum.md (READ IT — full spec).

## Branch
feat/party-system (off master). Never commit to master.

## Progress
- [x] Task 1: opcodes + entity field — DONE
  - core/constants/opcodes.ts: added party PACKETTYPE (MEMBERREQUEST 0xffffff17,
    MEMBERREQUESTCANCLE 0xffffff18, ADDPARTYMEMBER 0xffffff11, REMOVEPARTYMEMBER
    0xffffff12, PARTYCHANGELEADER 0xffffff2f, PARTYCHANGEITEMMODE 0xffffff20,
    PARTYCHANGEEXPMODE 0xffffff21, PARTYCHAT 0xffffff59) + SNAPSHOTTYPE (ERRORPARTY
    0x0081, PARTYMEMBER 0x0082, PARTYREQEST 0x0083, PARTYREQESTCANCEL 0x0084,
    PARTYEXP 0x0085, PARTYMEMBERLEVEL 0x0087, ADDPARTYCHANGELEADER 0x0079,
    PARTYCHAT 0x0069, PARTYCHANGEITEMMODE 0x008f, PARTYCHANGEEXPMODE 0x0090).
  - entities/src/player.ts: added `m_idParty: number = NULL_ID` after m_idDuelTarget.
- [ ] Task 2: party.serializer.ts in world-core + re-export + byte tests
- [ ] Task 3: @flyff/party package (manager+service+handler+index+pkg.json/tsconfig+tests)
- [ ] Task 4: CombatService partyExp seam (factor grant helper out of grantExp @ combat.service.ts:351) + LootService sameParty seam (loot.service.ts:188)
- [ ] Task 5: wiring compose.ts(~496 duel block)/clientServer.ts(deps+register ~149)/index.ts(onDisconnect ~219)

## Templates (exact)
- Manager: packages/combat/src/managers/duel.manager.ts (in-mem Map, pending w/ timer, onDisconnect)
- Service: packages/combat/src/services/duel.service.ts (deps{playerManager,manager,now?}; sendTo per recipient)
- Handler: packages/combat/src/handlers/duel.handler.ts (IN_WORLD gate, forged-id reject, try/catch PacketError)
- Serializer: packages/world-core/src/serializers/duel.serializer.ts (snap(subtype,recipientObjid) 14B prefix; return UNFRAMED)
- Wiring refs: compose.ts:494-514 duel block; clientServer.ts:60-113 deps + :147-149 register; index.ts:219 onDisconnect

## Key facts
- CParty::Serialize body order (party.cpp:169-223): m_uPartyId:DWORD, m_nKindTroup:int,
  m_nSizeofMember:int, m_nLevel:int, m_nExp:int, m_nPoint:int, m_nTroupsShareExp:int,
  m_nTroupeShareItem:int, m_idDuelParty:u_long, m_nModeTime[5]:int[]; if kindTroup→String name (skip, solo);
  per member: m_uPlayerId:u_long, m_bRemove:BOOL. PARTYMEMBER(0x0082) prefix body = idPlayer:DWORD | String leader | String member | int size | CParty::Serialize.
- CombatService.grantExp @ combat.service.ts:351. partyExp seam OPTIONAL dep; returns non-null=party handled it (skip solo). distributeExp: 64m proximity gate, fAddExp=base*0.2*(size-1), memberExp=(base+fAddExp)*(lv²/Σnearbylv²), level gate lv>maxLv-20. Factor per-player grant body into shared helper.
- LootService.isLoot @ loot.service.ts:188: owner || sameParty?.(player,item.m_idOwn) || FFA(7s). sameParty OPTIONAL dep.
- PlayerManager: get(charId), getByName, sendTo(player,buf) frames+writes, all(). No party field on it.
- CPlayer: m_idPlayer(=objid), m_szName, m_vPos, m_nZoneId, m_nLevel, m_idParty(new).
- Avoid cycle: @flyff/party depends on combat/world-core types; combat+inventory get party via injected closures (partyExp, sameParty). NOT direct import.
- Disconnect: index.ts onDisconnect hook -> resolve playerManager.get(charId), call partyService.onDisconnect(player) BEFORE joinService.disconnectByCharId.

## Not committed. Override rule: no complete/fixed until user tests in-client.
