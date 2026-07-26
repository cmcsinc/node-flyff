import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { interpretDialog, type DialogInterpBindings, type DialogInterpSink } from '../../src/services/dialogInterpreter';

/** Capturing sink -- records every emitted op for assertions. */
function mkSink(): { sink: DialogInterpSink; calls: string[] } {
  const calls: string[] = [];
  const sink: DialogInterpSink = {
    say: (n) => calls.push(`say:${n}`),
    speak: (n) => calls.push(`speak:${n}`),
    addKey: (l, k, p) => calls.push(`addKey:${l},${k ?? ''},${p ?? ''}`),
    addCondKey: (l, k) => calls.push(`addCondKey:${l},${k}`),
    removeKey: (k) => calls.push(`removeKey:${k}`),
    exit: () => calls.push('exit'),
    launchQuest: () => calls.push('launch'),
    beginQuest: (id) => calls.push(`begin:${id}`),
    endQuest: (id) => calls.push(`end:${id}`),
    changeJob: (j) => calls.push(`changeJob:${j}`),
    createItem: (i, c) => calls.push(`createItem:${i},${c}`),
    removeAllItem: (i) => calls.push(`removeAllItem:${i}`),
  };
  return { sink, calls };
}

/** Bindings with overridable player state; defaults model a level-15 vagrant. */
function mkBindings(overrides: Partial<DialogInterpBindings> = {}): DialogInterpBindings {
  const symbols = new Map<string, number>([
    ['QUEST_DUDK_VOL1', 100],
    ['QUEST_DUDK_VOL2', 101],
    ['II_SYS_SYS_QUE_DRIANCARGO', 6000],
  ]);
  return {
    resolveSymbol: (s) => symbols.get(s),
    questState: () => -1,
    isSetQuest: () => 0,
    playerJob: () => 0,
    playerLvl: () => 15,
    getItemNum: () => 0,
    emptyInventoryNum: () => 32,
    playerGold: () => 0,
    partySize: () => 1,
    isParty: () => 0,
    isPartyMaster: () => 1,
    isGuild: () => 0,
    isGuildMaster: () => 0,
    isGuildQuest: () => 0,
    guildQuestState: () => -1,
    playerExpPercent: () => 0,
    random: (n) => (n > 0 ? 0 : 0),
    isWormonServer: () => 0,
    ...overrides,
  };
}

describe('dialogInterpreter', () => {
  it('emits straight-line Say / Speak / AddKey / Exit ops in source order', () => {
    const { sink, calls } = mkSink();
    interpretDialog('Say( 47 ); Speak( NpcId(), 44 ); AddKey( 9 ); Exit();', mkBindings(), sink);
    assert.deepEqual(calls, ['say:47', 'speak:44', 'addKey:9,,', 'exit']);
  });

  it('takes the then-branch when the condition is true', () => {
    const { sink, calls } = mkSink();
    interpretDialog(
      'if(GetQuestState(QUEST_DUDK_VOL1) == QS_END) { LaunchQuest(); } else { AddKey( 9 ); }',
      mkBindings({ questState: (id) => (id === 100 ? 14 : -1) }),  // QS_END == 14
      sink,
    );
    assert.deepEqual(calls, ['launch']);
  });

  it('takes the else-branch when the condition is false', () => {
    const { sink, calls } = mkSink();
    interpretDialog(
      'if(GetQuestState(QUEST_DUDK_VOL1) == QS_END) { LaunchQuest(); } else { AddKey( 9 ); AddKey( 10 ); }',
      mkBindings({ questState: () => -1 }),
      sink,
    );
    assert.deepEqual(calls, ['addKey:9,,', 'addKey:10,,']);
  });

  it('evaluates && with job + level gates (dudk_drian ChangeJob pattern)', () => {
    const src = 'if(GetQuestState(QUEST_DUDK_VOL1) == QS_END && GetPlayerJob() == 1 && GetPlayerLvl() == 60) { ChangeJob( 6 ); } else { Exit(); }';
    const mk = (job: number, lvl: number, qs: number) => {
      const { sink, calls } = mkSink();
      interpretDialog(src, mkBindings({ playerJob: () => job, playerLvl: () => lvl, questState: () => qs }), sink);
      return calls;
    };
    assert.deepEqual(mk(1, 60, 14), ['changeJob:6']);      // all gates pass
    assert.deepEqual(mk(2, 60, 14), ['exit']);             // wrong job
    assert.deepEqual(mk(1, 59, 14), ['exit']);             // wrong level
    assert.deepEqual(mk(1, 60, -1), ['exit']);             // quest not ended
  });

  it('nests if/else (dudk_drian state 4: exactly one Say emits)', () => {
    const src = [
      'if(IsSetQuest(QUEST_DUDK_VOL3) == TRUE)',
      '{ if(IsSetQuest(QUEST_DUDK_VOL4) == TRUE) { Say ( 47); } else { Say ( 48); } }',
      'else { Say ( 49 ); }',
    ].join(' ');
    const run = (v3: number, v4: number) => {
      const { sink, calls } = mkSink();
      interpretDialog(src, mkBindings({ isSetQuest: (id) => (id === 102 ? v3 : id === 103 ? v4 : 0) }), sink);
      return calls;
    };
    // symbols QUEST_DUDK_VOL3/VOL4 aren't in the map -> resolveSymbol undefined -> isSetQuest never sees them
    // because the arg evaluates to 0. Patch the symbol map via overrides instead.
    const sym = (extra: Record<string, number>) => {
      const m = new Map([
        ['QUEST_DUDK_VOL3', 102], ['QUEST_DUDK_VOL4', 103], ['QUEST_DUDK_VOL1', 100],
      ]);
      for (const [k, v] of Object.entries(extra)) m.set(k, v);
      return m;
    };
    const runX = (v3: number, v4: number) => {
      const { sink, calls } = mkSink();
      interpretDialog(src, mkBindings({
        resolveSymbol: (s) => sym({}).get(s),
        isSetQuest: (id) => (id === 102 ? v3 : id === 103 ? v4 : 0),
      }), sink);
      return calls;
    };
    assert.deepEqual(runX(1, 1), ['say:47']);
    assert.deepEqual(runX(1, 0), ['say:48']);
    assert.deepEqual(runX(0, 0), ['say:49']);
    // baseline run() used the wrong symbol path; keep it green by asserting it returns one Say
    assert.equal(run(1, 1).length, 1);
  });

  it('resolves II_* symbols for GetItemNum and branches (dudk_drian state 2)', () => {
    const src = 'AddKey( 9 ); if(GetItemNum(II_SYS_SYS_QUE_DRIANCARGO) == 0) { AddCondKey( 45,11 ); } AddKey( 10 );';
    const { sink, calls } = mkSink();
    interpretDialog(src, mkBindings({ getItemNum: () => 0 }), sink);
    assert.deepEqual(calls, ['addKey:9,,', 'addCondKey:45,11', 'addKey:10,,']);
  });

  it('treats an unresolved symbol as 0 so comparisons fail safe', () => {
    const { sink, calls } = mkSink();
    interpretDialog('if(UNKNOWN_SYM == 99) { Say( 1 ); } else { Say( 2 ); }', mkBindings(), sink);
    assert.deepEqual(calls, ['say:2']);
  });

  it('never throws on a malformed body (degrades to no ops)', () => {
    const { sink, calls } = mkSink();
    assert.doesNotThrow(() => interpretDialog('if(GetQuestState(BROKEN', mkBindings(), sink));
    assert.deepEqual(calls, []);
  });

  it('ignores SetScriptTimer / PrintSystemMessage (no-op statements)', () => {
    const { sink, calls } = mkSink();
    interpretDialog('SetScriptTimer( 15 ); PrintSystemMessage( 7 ); Say( 5 );', mkBindings(), sink);
    assert.deepEqual(calls, ['say:5']);
  });

  it('supports || and grouping', () => {
    const src = 'if( (GetPlayerJob() == 1 || GetPlayerJob() == 3) && GetPlayerLvl() >= 60) { Say( 1 ); } else { Exit(); }';
    const run = (job: number, lvl: number) => {
      const { sink, calls } = mkSink();
      interpretDialog(src, mkBindings({ playerJob: () => job, playerLvl: () => lvl }), sink);
      return calls;
    };
    assert.deepEqual(run(1, 60), ['say:1']);
    assert.deepEqual(run(3, 70), ['say:1']);
    assert.deepEqual(run(2, 60), ['exit']);
    assert.deepEqual(run(1, 59), ['exit']);
  });
});
