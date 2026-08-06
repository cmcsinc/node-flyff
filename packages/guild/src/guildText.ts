/**
 * Guild refusal + notice text ids, resolved from `game/resource/defineText.h`.
 *
 * Every guard in the guild services already names its TID in a comment; these
 * are those names with their numbers, so the guard can actually send the line.
 * The client resolves the template and colour from `textClient.inc` by id, so
 * the number is the whole contract -- a wrong one shows the wrong sentence.
 *
 * **Values verified individually against `defineText.h`.** They are NOT one
 * contiguous block: the guild run is 1241-1329, but `GUILDWAROHTERLV6` (1334)
 * and `GUILDNOTINCLUDE` (1335) sit after an unrelated pair, and the `COM*`
 * family is down at 675-697 with the rest of the party/community texts. Copying
 * a range instead of each define would silently shift several of these.
 *
 * Two spellings are the original's, kept verbatim so a grep against the C++
 * finds them: `OHTER` (sic, for "other") in {@link TID_GAME_GUILDWAROHTERLV6},
 * and `INVAIT` (sic) in {@link TID_GAME_GUILDINVAITNOTWARR}.
 *
 * @module guildText
 */

// ── Community / party family (675-697) -- shared with the pre-guild "company"
// wording; guild reuses them rather than defining its own.
/** Already in a guild, on create (`DPCoreSrvr.cpp:1369`). */
export const TID_GAME_COMCREATECOM = 675;
/** Not the guild master (`DPCacheSrvr.cpp:1213`, and every master-only guard). */
export const TID_GAME_COMDELNOTKINGPIN = 676;
/** Not in a guild at all (`DPCacheSrvr.cpp:1205`). */
export const TID_GAME_COMNOHAVECOM = 677;
/** Guild name already taken (`DPCoreSrvr.cpp:1378`). */
export const TID_GAME_COMOVERLAPNAME = 679;
/** The invitee is already in a guild, re-checked on accept (`:1309`). */
export const TID_GAME_COMHAVECOM = 684;
/** Roster is full (`:1318`). */
export const TID_GAME_COMOVERMEMBER = 685;
/** A master may not simply leave -- transfer or disband (`:1412`). */
export const TID_GAME_COMLEAVEKINGPIN = 691;
/** Only the master may kick (`:1402`). */
export const TID_GAME_COMLEAVENOKINGPIN = 690;
/** Invite target is already in a guild, at invite time (`DPSrvr.cpp:9993`). */
export const TID_GAME_COMACCEPTHAVECOM = 694;
/** The invitee declined -- sent to the INVITER (`DPSrvr.cpp:1812`). */
export const TID_GAME_COMACCEPTDENY = 697;

// ── Guild family (1241-1329) ─────────────────────────────────────────────────
/** Guild bank has no free slot (`DPSrvr.cpp:3660`). */
export const TID_GAME_GUILDBANKFULL = 1276;
/** Not enough penya in the guild pool (`DPSrvr.cpp:1876`). */
export const TID_GAME_GUILDNOTENGGOLD = 1262;
/** Guild level too low for nicknames -- needs 10 (`DPCacheSrvr.cpp:1812`). */
export const TID_GAME_GUILDNOTLEVEL = 1272;
/** The inviter went offline before the accept landed (`:1264`). */
export const TID_GAME_GUILDCHROFFLINE = 1278;
/** Target's rank is at or above the requester's (`:1483`). */
export const TID_GAME_GUILDAPPOVER = 1279;
/** Requester's rank lacks PF_MEMBERLEVEL (`:1493`, and PF_LEVEL at `:1684`). */
export const TID_GAME_GUILDAPPNOTWARRANT = 1280;
/** The NEW rank is at or above the requester's own (`:1488`). */
export const TID_GAME_GUILDWARRANTREGOVER = 1281;
/** That rank's headcount cap is full (`:1505`). */
export const TID_GAME_GUILDAPPNUMOVER = 1282;
/** Inviter's rank lacks PF_INVITATION (`DPSrvr.cpp:9986`). */
export const TID_GAME_GUILDINVAITNOTWARR = 1283;
/** A duel is refused while either side is at war (`Mover.cpp:7178`). */
export const TID_GAME_GUILDWARERRORDUEL = 1294;
/**
 * Roster mutations are blocked during a war. The single most-used guild text --
 * four separate CoreServer guards send it (`DPCacheSrvr.cpp:1385`, `:1469`,
 * `:1548`, `:1668`), covering kick/leave, rank, authority, and class.
 */
export const TID_GAME_GUILDWARNOMEMBER = 1302;
/** Surrender with no war in progress (`DPCacheSrvr.cpp:2291`). */
export const TID_GAME_GUILDWARNOETC = 1310;
/** A guild at war may not disband (`:1219`). */
export const TID_GAME_GUILDWARNODISMISS = 1313;
/** Accept named a guild that does not exist (`:2535`). */
export const TID_GAME_GUILDWARNOFINDGUILD = 1321;
/** Accept while already at war (`:2528`). */
export const TID_GAME_GUILDWARNOREQUEST = 1320;
/** Declarer's guild is below level 6 (`:2454`). */
export const TID_GAME_GUILDWARREQLV6 = 1324;
/** Declarer is already in a war (`:2461`). */
export const TID_GAME_GUILDWARSTILLNOWAR = 1325;
/** No guild by that name (`:2468`). */
export const TID_GAME_GUILDWARNOTHINGGUILD = 1326;
/** The other guild's master is offline (`:2481`, `:2548`). */
export const TID_GAME_GUILDWARMASTEROFF = 1327;
/** The other guild is already in a war (`:2493`, `:2553`). */
export const TID_GAME_GUILDWAROTHERWAR = 1328;
/** Target guild has fewer than 10 members (`:2487`). */
export const TID_GAME_GUILDWARMEMBER10 = 1329;

// ── The two strays past 1330 ─────────────────────────────────────────────────
/**
 * Target guild is below level 6 (`:2474`). Note the misspelling -- `OHTER`, not
 * `OTHER` -- which is why this is easy to miss when grepping.
 */
export const TID_GAME_GUILDWAROHTERLV6 = 1334;
/** Still inside the 2-day rejoin lockout (`:1274`). */
export const TID_GAME_GUILDNOTINCLUDE = 1335;

// ── Elsewhere ────────────────────────────────────────────────────────────────
/** Invite refused because the target is in combat (`DPSrvr.cpp:10008`). */
export const TID_GAME_BATTLE_NOTGUILD = 1386;
/** Nickname length out of the 2..12 range (`DPCacheSrvr.cpp:1829`). */
export const TID_DIAG_0011_01 = 2908;
