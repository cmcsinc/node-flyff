# Flyff Opcode / SNSP Reference

## Login Server (LS) Opcodes

| SNSP | Value | C→S / S→C | Description |
|---|---|---|---|
| `SNSP_LOGIN_CERTIFY` | `0xFC03` | C→S | Send username+password |
| `SNSP_LOGIN_RESP` | `0xFC04` | S→C | Login result |
| `SNSP_SERVER_LIST` | `0xFC07` | S→C | List of available servers |
| `SNSP_LOGIN_WORLD` | `0xFC0B` | C→S | Select server/channel |
| `SNSP_WORLD_RESULT` | `0xFC0C` | S→C | World selection result + token |

## Cluster Server (CS) Opcodes

| SNSP | Value | C→S / S→C | Description |
|---|---|---|---|
| `SNSP_CHAR_LIST` | `0xFB01` | S→C | Send character list |
| `SNSP_CHAR_CREATE` | `0xFB0C` | C→S | Create new character |
| `SNSP_CHAR_CREATE_RESP` | `0xFB0D` | S→C | Create result |
| `SNSP_CHAR_DELETE` | `0xFB0E` | C→S | Delete character |
| `SNSP_CHAR_SELECT` | `0xFB0B` | C→S | Select character to play |
| `SNSP_CHAR_SELECT_RESP` | `0xFB02` | S→C | Enter world result + world addr |

## World Server (WS) Opcodes

### Player / Session
| SNSP | Value | Description |
|---|---|---|
| `SNSP_WELCOME` | `0x0010` | Server welcome + session key |
| `SNSP_PLAYER_ENTER` | `0x0034` | Full player spawn packet |
| `SNSP_PLAYER_EXIT` | `0x0036` | Player despawn |
| `SNSP_SNAPSHOT` | `0x00CA` | Snapshot/keepalive |

### Movement
| SNSP | Value | Description |
|---|---|---|
| `SNSP_PLAYER_MOVE` | `0x00D9` | Movement (pos+angle) |
| `SNSP_PLAYER_STOP` | `0x00DA` | Stop movement |
| `SNSP_PLAYER_JUMP` | `0x00DB` | Jump |
| `SNSP_DESTPOS` | `0x00DC` | Destination position (click-to-move) |

### Chat
| SNSP | Value | Description |
|---|---|---|
| `SNSP_CHAT` | `0x00C6` | Normal chat |
| `SNSP_PARTY_CHAT` | `0x00C7` | Party chat |
| `SNSP_GUILD_CHAT` | `0x00CC` | Guild chat |
| `SNSP_WHISPER` | `0x00C9` | Private message |
| `SNSP_SHOUT` | `0x00C8` | Shout (area-wide) |

### Combat
| SNSP | Value | Description |
|---|---|---|
| `SNSP_ATTACK` | `0x00E0` | Melee attack |
| `SNSP_MAGIC_ATTACK` | `0x00E1` | Skill/magic attack |
| `SNSP_HIT` | `0x00E4` | Hit result (damage) |
| `SNSP_DEAD` | `0x00E6` | Entity death |
| `SNSP_REVIVE` | `0x00E7` | Resurrection |

### NPCs & Objects
| SNSP | Value | Description |
|---|---|---|
| `SNSP_OBJECT_SHOW` | `0x0035` | Spawn NPC/Monster/Item |
| `SNSP_OBJECT_HIDE` | `0x0037` | Despawn entity |
| `SNSP_NPC_MOVE` | `0x00D9` | NPC movement |
| `SNSP_TALK_NPC` | `0x011B` | Open NPC dialog |
| `SNSP_TALK_NPC_CLOSE` | `0x011C` | Close NPC dialog |

### Inventory & Items
| SNSP | Value | Description |
|---|---|---|
| `SNSP_INVEN_MOVE` | `0x0025` | Move item in inventory |
| `SNSP_INVEN_USE` | `0x0026` | Use/equip item |
| `SNSP_INVEN_DROP` | `0x0027` | Drop item |
| `SNSP_PICKUP` | `0x0028` | Pick up item |
| `SNSP_INVEN_CHANGED` | `0x0098` | Inventory update push |

### Stats & Level
| SNSP | Value | Description |
|---|---|---|
| `SNSP_LEVEL_UP` | `0x00B0` | Level up notification |
| `SNSP_EXP_CHANGE` | `0x00B1` | Experience change |
| `SNSP_HP_MP_CHANGE` | `0x0097` | HP/MP update |
| `SNSP_STAT_CHANGE` | `0x0099` | Stat point change |

### Skills
| SNSP | Value | Description |
|---|---|---|
| `SNSP_SKILL_LIST` | `0x0060` | Send skill list |
| `SNSP_SKILL_LEARN` | `0x0061` | Learn skill |
| `SNSP_SKILL_USE` | `0x0063` | Use skill |
| `SNSP_SKILL_RESULT` | `0x0065` | Skill result |

### Party
| SNSP | Value | Description |
|---|---|---|
| `SNSP_PARTY_CREATE` | `0x0080` | Create party |
| `SNSP_PARTY_INVITE` | `0x0081` | Invite to party |
| `SNSP_PARTY_JOIN` | `0x0082` | Join party |
| `SNSP_PARTY_LEAVE` | `0x0083` | Leave party |
| `SNSP_PARTY_INFO` | `0x0085` | Party member HP/MP |

### Guild
| SNSP | Value | Description |
|---|---|---|
| `SNSP_GUILD_CREATE` | `0x00A0` | Create guild |
| `SNSP_GUILD_INVITE` | `0x00A1` | Guild invite |
| `SNSP_GUILD_JOIN` | `0x00A2` | Join guild |
| `SNSP_GUILD_KICK` | `0x00A4` | Kick from guild |
| `SNSP_GUILD_INFO` | `0x00A8` | Guild info update |

---

> Values above are based on leaked v19/v18 source. Different Flyff versions may vary — always cross-check with a packet capture or the specific source version you are targeting.
