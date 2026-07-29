'use strict';
/**
 * 티츄 룰 엔진 단위 검증 + 봇 자동 대전 시뮬레이션.
 * 실행: node test/simulate-tichu.js (npm test에도 포함됨)
 */
const assert = require('assert');
const core = require('../public/shared/tichu-core.js');
const { Game } = require('../server/src/games/tichu/game');
const { chooseBotAction } = require('../server/src/games/tichu/bot');

const C = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank, special: null });
const deck = core.buildDeck();
const DOG = deck.find((c) => c.special === 'dog');
const MAHJONG = deck.find((c) => c.special === 'mahjong');
const PHOENIX = deck.find((c) => c.special === 'phoenix');
const DRAGON = deck.find((c) => c.special === 'dragon');

/* ---------- 1. 덱/점수 ---------- */
{
  assert.equal(deck.length, 56, '덱은 56장');
  assert.equal(core.handPoints(deck), 100, '덱 전체 점수 합은 항상 100');
  console.log('✅ 덱 구성 및 총점(100점)');
}

/* ---------- 2. 조합 판정 ---------- */
{
  assert.equal(core.analyze([C('jade', 7)]).type, 'single');
  assert.equal(core.analyze([C('jade', 7), C('sword', 7)]).type, 'pair');
  assert.equal(core.analyze([C('jade', 7), C('sword', 6)]), null, '랭크가 다르면 페어 아님');
  assert.equal(core.analyze([C('jade', 7), C('sword', 7), C('star', 7)]).type, 'triple');
  assert.equal(core.analyze([C('jade', 7), C('sword', 7), C('star', 7), C('pagoda', 7)]).type, 'bomb4');
  assert.equal(
    core.analyze([C('jade', 7), C('sword', 7), C('star', 7), C('jade', 9), C('sword', 9)]).type,
    'fullhouse'
  );
  assert.equal(
    core.analyze([C('jade', 4), C('sword', 5), C('star', 6), C('pagoda', 7), C('jade', 8)]).type,
    'straight'
  );
  assert.equal(
    core.analyze([C('jade', 4), C('jade', 5), C('jade', 6), C('jade', 7), C('jade', 8)]).type,
    'bombflush',
    '같은 무늬 연속 5장은 봄(스트레이트플러시)'
  );
  assert.equal(
    core.analyze([C('jade', 4), C('sword', 4), C('star', 5), C('pagoda', 5)]).type,
    'stairs'
  );

  // 특수카드
  assert.equal(core.analyze([DOG]).type, 'single');
  assert.equal(core.analyze([DOG, C('jade', 3)]), null, '개는 싱글로만 가능');
  assert.equal(core.analyze([DRAGON]).rank, 15, '드래곤은 항상 최고 싱글');
  assert.equal(core.analyze([MAHJONG, C('jade', 3)]), null, '마작은 페어에 참여 불가');
  assert.equal(
    core.analyze([MAHJONG, C('sword', 2), C('star', 3), C('pagoda', 4), C('jade', 5)]).type,
    'straight',
    '마작은 스트레이트 맨 아래(1)로만 참여 가능'
  );

  // 불사조 와일드
  assert.equal(core.analyze([C('jade', 7), PHOENIX]).rank, 7, '불사조가 페어의 랭크를 그대로 가짐');
  assert.equal(
    core.analyze([C('jade', 7), C('sword', 7), PHOENIX]).type, 'triple',
    '불사조가 트리플의 한 자리를 채움'
  );
  const straightWithPhoenix = core.analyze([C('jade', 4), C('sword', 5), C('star', 7), C('pagoda', 8), PHOENIX]);
  assert.equal(straightWithPhoenix.type, 'straight');
  assert.equal(straightWithPhoenix.rank, 8, '불사조가 빈 6자리를 채워 4-5-6-7-8 완성');
  assert.equal(
    core.analyze([C('jade', 7), C('sword', 7), C('star', 7), C('pagoda', 7), PHOENIX]),
    null,
    '봄에는 특수카드가 낄 수 없음'
  );

  console.log('✅ 조합 판정(일반/특수카드/불사조 와일드)');
}

/* ---------- 3. 조합 비교(beats) ---------- */
{
  const single9 = core.analyze([C('jade', 9)]);
  const bomb = core.analyze([C('jade', 7), C('sword', 7), C('star', 7), C('pagoda', 7)]);
  const bombflush = core.analyze([C('jade', 4), C('jade', 5), C('jade', 6), C('jade', 7), C('jade', 8)]);
  assert.equal(core.beats(bomb, single9), true, '봄은 비봄을 항상 이김');
  assert.equal(core.beats(single9, bomb), false);
  assert.equal(core.beats(bombflush, bomb), true, '스트레이트플러시 봄은 포카드 봄을 항상 이김(길이/랭크 무관)');
  assert.equal(core.beats(core.analyze([DRAGON]), single9), true);
  assert.equal(core.beats(bomb, core.analyze([DRAGON])), true, '봄은 드래곤 싱글도 이김');
  assert.equal(
    core.resolvePhoenixSingleRank(null), 1.5, '불사조 리드 값은 1.5'
  );
  assert.equal(
    core.resolvePhoenixSingleRank({ rank: 9 }), 9.5, '불사조 응수 값은 직전 싱글+0.5'
  );
  assert.equal(
    core.resolvePhoenixSingleRank({ rank: 15 }), 15, '드래곤(랭크15)은 불사조로도 이길 수 없음(랭크를 올려주지 않음)'
  );
  {
    const phoenixOnDragon = core.analyze([PHOENIX]);
    phoenixOnDragon.rank = core.resolvePhoenixSingleRank({ rank: 15 });
    assert.equal(
      core.beats(phoenixOnDragon, { type: 'single', length: 1, isBomb: false, rank: 15 }),
      false,
      '불사조는 드래곤을 이길 수 없음'
    );
  }
  console.log('✅ 조합 비교(봄 우선순위, 불사조 동적 랭크)');
}

/* ---------- 4. 카드 나눔(스컵프) 좌석 수학 ---------- */
{
  const players = [
    { id: 'p1', team: 'A' }, { id: 'p2', team: 'B' }, { id: 'p3', team: 'A' }, { id: 'p4', team: 'B' },
  ];
  const g = new Game(players);
  assert.deepEqual(g.playerIds, ['p1', 'p2', 'p3', 'p4'], '팀 태그로 A,B,A,B 교차 좌석 구성');
  for (const pid of g.playerIds) g.declareGrand(pid, false);
  assert.equal(g.phase, 'exchange');

  const before = new Map(g.playerIds.map((pid) => [pid, g.hands.get(pid).map((c) => c.id)]));
  const gives = {};
  for (const pid of g.playerIds) {
    const hand = g.hands.get(pid);
    gives[pid] = { left: hand[0].id, right: hand[1].id, partner: hand[2].id };
    g.submitExchange(pid, gives[pid]);
  }
  assert.equal(g.phase, 'trick', '4명 모두 제출하면 동시에 카드가 나뉘고 트릭 단계로 전환');

  for (let i = 0; i < 4; i++) {
    const pid = g.playerIds[i];
    const rightNeighbor = g.playerIds[(i + 1) % 4];
    const leftNeighbor = g.playerIds[(i + 3) % 4];
    const partner = g.playerIds[(i + 2) % 4];
    const after = g.hands.get(pid).map((c) => c.id);
    assert.equal(after.length, 14, '나눔 후에도 14장 유지');
    assert(after.includes(gives[rightNeighbor].left), '오른쪽 이웃이 나에게 준 왼쪽 선물을 받아야 함');
    assert(after.includes(gives[leftNeighbor].right), '왼쪽 이웃이 나에게 준 오른쪽 선물을 받아야 함');
    assert(after.includes(gives[partner].partner), '파트너가 나에게 준 선물을 받아야 함');
    const givenAway = new Set([gives[pid].left, gives[pid].right, gives[pid].partner]);
    for (const id of givenAway) assert(!after.includes(id), '내가 넘긴 카드는 내 손에 없어야 함');
  }
  const allIds = new Set();
  for (const pid of g.playerIds) for (const id of g.hands.get(pid)) allIds.add(id.id ?? id);
  assert.equal(allIds.size, 56, '나눔 전후 전체 카드 수 보존');
  console.log('✅ 카드 나눔 좌석 수학(왼쪽/오른쪽/파트너 대칭성)');
}

/* ---------- 5. 마작 소원 강제 ---------- */
{
  const players = [
    { id: 'p1', team: 'A' }, { id: 'p2', team: 'B' }, { id: 'p3', team: 'A' }, { id: 'p4', team: 'B' },
  ];
  const g = new Game(players);
  for (const pid of g.playerIds) g.declareGrand(pid, false);
  for (const pid of g.playerIds) {
    const hand = g.hands.get(pid);
    g.submitExchange(pid, { left: hand[0].id, right: hand[1].id, partner: hand[2].id });
  }
  const mahjongHolder = g.playerIds.find((pid) => g.hands.get(pid).some((c) => c.special === 'mahjong'));
  assert.equal(g.currentPlayerId(), mahjongHolder, '마작 보유자가 첫 리드');
  g.play(mahjongHolder, [MAHJONG.id], 8); // 소원: 8
  assert.equal(g.wish, 8);

  // 소원(8)을 만족하는 패가 있는데 패스/다른 패를 내면 거부되어야 함
  const nextPid = g.currentPlayerId();
  const hand = g.hands.get(nextPid);
  const has8 = hand.find((c) => c.rank === 8 && !c.special);
  if (has8) {
    assert.throws(() => g.pass(nextPid), /소원/, '소원을 만족하는 패가 있으면 패스 불가');
    const otherCard = hand.find((c) => c.id !== has8.id);
    if (otherCard) {
      const combo = core.analyze([otherCard]);
      if (combo) assert.throws(() => g.play(nextPid, [otherCard.id]), /소원/, '소원 무시 불가');
    }
    g.play(nextPid, [has8.id]);
    assert.equal(g.wish, null, '소원 카드를 내면 소원 해제');
  }
  console.log('✅ 마작 소원 강제');
}

/* ---------- 6. 봄(폭탄) 끼어들기: 내 차례가 아니어도 사용 가능 ---------- */
{
  const players = [
    { id: 'p1', team: 'A' }, { id: 'p2', team: 'B' }, { id: 'p3', team: 'A' }, { id: 'p4', team: 'B' },
  ];
  const g = new Game(players);
  for (const pid of g.playerIds) g.declareGrand(pid, false);
  for (const pid of g.playerIds) {
    const hand = g.hands.get(pid);
    g.submitExchange(pid, { left: hand[0].id, right: hand[1].id, partner: hand[2].id });
  }
  const leader = g.currentPlayerId();
  const leaderHand = g.hands.get(leader);
  const leadCard = leaderHand.find((c) => !c.special) || leaderHand[0];
  g.play(leader, [leadCard.id]);

  // 정상적인 다음 차례(+1)가 아니라 그다음(+2, 대각선)에게 강제로 봄을 심어 "끼어들기"를 검증한다.
  const interrupterIdx = (g.seatIndex(leader) + 2) % 4;
  const interrupter = g.playerIds[interrupterIdx];
  assert.notEqual(g.currentPlayerId(), interrupter, '테스트 전제: 끼어드는 사람이 원래 차례가 아니어야 함');

  const bombRank = 9;
  const bomb = ['jade', 'sword', 'star', 'pagoda'].map((suit) => ({ id: `${suit}-${bombRank}-bomb`, suit, rank: bombRank, special: null }));
  g.hands.set(interrupter, g.hands.get(interrupter).concat(bomb));

  g.play(interrupter, bomb.map((c) => c.id));
  assert.equal(g.current.byId, interrupter, '봄을 낸 사람이 새 current 소유자가 되어야 함');
  assert.equal(g.current.combo.isBomb, true);
  const expectedNext = g.playerIds[(interrupterIdx + 1) % 4];
  assert.equal(g.currentPlayerId(), expectedNext, '끼어든 사람의 다음 자리부터 턴이 이어져야 함');

  const other = g.playerIds.find((id) => id !== g.currentPlayerId() && !g.finishOrder.includes(id));
  const otherHand = g.hands.get(other);
  const singleCard = otherHand.find((c) => !c.special);
  if (singleCard) {
    assert.throws(() => g.play(other, [singleCard.id]), /차례/, '비봄 조합은 여전히 자기 차례에만 낼 수 있어야 함');
  }
  console.log('✅ 봄(폭탄) 끼어들기(내 차례가 아니어도 가능, 턴은 끼어든 사람 다음으로 이어짐)');
}

/* ---------- 7. 1등으로 나가며 이긴 트릭을 아무도 못 밟으면, 다음 리드는 "바로 다음(오른쪽) 좌석" ---------- */
{
  const players = [
    { id: 'p1', team: 'A' }, { id: 'p2', team: 'B' }, { id: 'p3', team: 'A' }, { id: 'p4', team: 'B' },
  ];
  const g = new Game(players);
  for (const pid of g.playerIds) g.declareGrand(pid, false);
  for (const pid of g.playerIds) {
    const hand = g.hands.get(pid);
    g.submitExchange(pid, { left: hand[0].id, right: hand[1].id, partner: hand[2].id });
  }
  const leader = g.currentPlayerId();
  const nextInRotation = g.playerIds[(g.seatIndex(leader) + 1) % 4];

  // 리더는 최고 싱글(A) 한 장만, 나머지는 그걸 못 이기는 낮은 싱글 한 장씩만 가진 것으로 만든다.
  g.hands.set(leader, [{ id: 'ace-lead', suit: 'jade', rank: 14, special: null }]);
  for (const pid of g.playerIds) {
    if (pid === leader) continue;
    g.hands.set(pid, [{ id: `low-${pid}`, suit: 'jade', rank: 3, special: null }]);
  }

  g.play(leader, ['ace-lead']);
  assert(g.finishOrder.includes(leader), '리더는 마지막 카드를 내며 1등으로 나가야 함');
  assert.equal(g.endReason, null, '파트너가 아직 안 나갔으므로 더블윈이 아니어야 함');

  // 나머지 세 명이 전부 패스(아무도 못 밟음)
  for (let i = 0; i < 3; i++) {
    const pid = g.currentPlayerId();
    assert.notEqual(pid, leader, '이미 나간 사람에게 다시 차례가 오면 안 됨');
    g.pass(pid);
  }
  assert.equal(g.currentPlayerId(), nextInRotation, '1등이 이긴 트릭을 아무도 못 밟으면 다음 리드는 좌석상 바로 다음 사람');
  assert.equal(g.leaderId, nextInRotation);
  console.log('✅ 1등이 이긴 트릭을 아무도 못 밟았을 때 다음 리드는 바로 다음 좌석');
}

/* ---------- 8. 봇 자동 대전(다수 핸드) ---------- */
{
  function applyAction(game, pid, action) {
    const kind = action.kind;
    if (kind === 'grand_tichu') return game.declareGrand(pid, !!action.declare);
    if (kind === 'tichu') return game.declareTichu(pid);
    if (kind === 'exchange') return game.submitExchange(pid, action.gives || {});
    if (kind === 'play') return game.play(pid, action.cardIds || [], action.wish);
    if (kind === 'pass') return game.pass(pid);
    if (kind === 'wish') return game.resolveWish(pid, action.rank == null ? null : +action.rank);
    if (kind === 'give_dragon') return game.giveDragon(pid, action.toPlayerId);
    throw new Error('unknown kind ' + kind);
  }
  function currentActor(game) {
    if (game.finished) return null;
    if (game.pendingWish) return game.pendingWish;
    if (game.pendingDragonGive) return game.pendingDragonGive;
    if (game.phase === 'grand_declare') return game.playerIds.find((id) => game.grandPending.has(id)) || null;
    if (game.phase === 'exchange') return game.playerIds.find((id) => !game.exchangeSubmitted.has(id)) || null;
    return game.currentPlayerId();
  }

  // 손패 나눔(core.analyze는 브루트포스라 14장 기준 결정당 수~십ms 소요) — 실행 시간을 감안해
  // 핸드 수는 적당히 제한하되, 매 핸드마다 다양한 상황(더블윈/3아웃/개/드래곤/봄)을 충분히 훑는다.
  const N = 150;
  let doubleWins = 0, threeOuts = 0, dogUsed = 0, bombUsed = 0;
  for (let iter = 0; iter < N; iter++) {
    const players = [
      { id: 'p1', team: 'A' }, { id: 'p2', team: 'B' }, { id: 'p3', team: 'A' }, { id: 'p4', team: 'B' },
    ];
    const g = new Game(players);
    let steps = 0;
    let sawDog = false;
    while (!g.finished) {
      steps++;
      assert(steps < 3000, `핸드 ${iter}가 3000스텝을 넘김(무한루프 의심)`);
      const pid = currentActor(g);
      assert(pid, `핸드 ${iter}: 진행 중인데 다음 행동 주체가 없음(phase=${g.phase})`);
      const action = chooseBotAction(g, pid);
      if (action.kind === 'play' && action.cardIds) {
        if (action.cardIds.includes(DOG.id)) sawDog = true;
        const combo = core.analyze(action.cardIds.map((id) => g.hands.get(pid).find((c) => c.id === id)));
        if (combo && combo.isBomb) bombUsed++;
      }
      applyAction(g, pid, action); // 실패하면 예외가 그대로 터져 테스트 실패
    }
    if (g.endReason === 'doubleWin') doubleWins++; else threeOuts++;
    if (sawDog) dogUsed++;

    // 카드 총점 보존(더블윈이 아니면 "4등 손패 + 전원 획득 트릭"의 합이 항상 100)
    if (g.endReason !== 'doubleWin') {
      const fourthId = g.playerIds.find((id) => !g.finishOrder.includes(id));
      const totalCollected = g.playerIds.reduce((s, id) => s + core.handPoints(g.collected.get(id)), 0);
      const total = totalCollected + core.handPoints(g.hands.get(fourthId));
      assert.equal(total, 100, `핸드 ${iter}: 카드 점수 보존 실패(합=${total})`);
    }
    // 카드 매수 보존(개를 냈다면 그 카드는 아무도 획득하지 않으므로 56장이 아니라 55장)
    const allIds = new Set();
    for (const id of g.playerIds) for (const c of g.hands.get(id)) allIds.add(c.id);
    for (const id of g.playerIds) for (const c of g.collected.get(id)) allIds.add(c.id);
    for (const c of g.trickPile) allIds.add(c.id);
    assert.equal(allIds.size, sawDog ? 55 : 56, `핸드 ${iter}: 카드 매수 보존 실패`);
  }
  assert(doubleWins + threeOuts === N);
  console.log(
    `✅ 봇 자동 대전 ${N}핸드 (더블윈 ${doubleWins}, 3아웃 ${threeOuts}, 개 사용 ${dogUsed}, 봄 사용 ${bombUsed}) — ` +
    `크래시/무한루프/점수보존 이상 없음`
  );
}

console.log('\n🎉 모든 티츄 테스트 통과');
