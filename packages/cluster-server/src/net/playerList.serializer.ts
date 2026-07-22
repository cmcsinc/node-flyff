/**
 * Serializes the `PACKETTYPE_PLAYER_LIST` (0xf3) reply.
 *
 * Wire layout mirrors the C++ `CDbManager::SendPlayerList`
 * (`game/source/_Database/DbManager.cpp:423-731`). The per-character struct
 * follows `DbManager.cpp:643-700`; missing fields (party/guild/war/equipment)
 * default to 0 for the vertical slice.
 *
 * @module net/playerList.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { CharacterRow } from '@flyff/database';

// v15 canonical constants (referenced by C++ but defined outside game/source/).
const MI_MALE = 11;
const MI_FEMALE = 12;
const WI_WORLD_MADRIGAL = 1;
// Client reads this as g_Neuz.m_nCharacterBlock[slot] (DPLoginClient.cpp:429).
// 0 = blocked -> "You cannot use this character", 1 = usable, 2 = empty slot.
const CHARACTER_BLOCK_USABLE = 1;

/**
 * Builds PLAYER_LIST packets from a character roster.
 */
export class PlayerListSerializer {
  /**
   * Serialize a full PLAYER_LIST packet.
   *
   * @param dwAuthKey - Auth key echoed from the GETPLAYERLIST request.
   * @param chars - Characters to include.
   * @returns Packet buffer (opcode DWORD already written).
   */
  build(dwAuthKey: number, chars: readonly CharacterRow[]): Buffer {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.PLAYER_LIST);
    writer.writeDword(dwAuthKey >>> 0);
    writer.writeDword(chars.length);

    for (const c of chars) {
      this.writeChar(writer, c);
    }

    // countMessenger -- slice has no messenger blocks.
    writer.writeDword(0);
    return writer.build();
  }

  /**
   * Write a single per-character struct in canonical field order.
   */
  private writeChar(writer: PacketWriter, c: CharacterRow): void {
    writer.writeDword(c.slot);                       // islot (int, 4 bytes)
    writer.writeDword(CHARACTER_BLOCK_USABLE);       // m_nCharacterBlock: 1 = usable
    writer.writeDword(WI_WORLD_MADRIGAL);            // dwWorldID
    writer.writeDword(c.gender === 1 ? MI_FEMALE : MI_MALE); // m_dwIndex
    writer.writeString(c.name);                      // m_szName
    writer.writeFloat(c.x);                          // m_vPos.x
    writer.writeFloat(c.y);                          // m_vPos.y
    writer.writeFloat(c.z);                          // m_vPos.z
    writer.writeDword(c.id);                         // m_idPlayer
    writer.writeDword(0);                            // m_idparty
    writer.writeDword(0);                            // m_idGuild
    writer.writeDword(0);                            // m_idWar
    writer.writeDword(c.skin_color);                 // m_dwSkinSet
    writer.writeDword(c.hair_style);                 // m_dwHairMesh
    writer.writeDword(c.hair_color);                 // m_dwHairColor
    writer.writeDword(c.face_style);                 // m_dwHeadMesh
    writer.writeByte(c.gender & 0xFF);               // sex (BYTE)
    writer.writeDword(c.class);                      // m_nJob
    writer.writeDword(c.level);                      // m_nLevel
    writer.writeDword(0);                            // jobLv placeholder
    writer.writeDword(c.strength);                   // m_nStr
    writer.writeDword(c.stamina);                    // m_nSta
    writer.writeDword(c.dexterity);                  // m_nDex
    writer.writeDword(c.intelligence);               // m_nInt
    writer.writeDword(0);                            // m_dwMode
    writer.writeDword(0);                            // equipCount (no equip in slice)
  }
}
