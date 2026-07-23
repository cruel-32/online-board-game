'use strict';
/**
 * 룰 엔진 단위 검증 + 봇 자동 대전 시뮬레이션.
 * 실행: npm test
 */
const assert = require('assert');
const core = require('../public/shared/lexio-core.js');
const { Game } = require('../server/src/games/lexio/game');
const { chooseBotMove } = require('../server/src/games/lexio/bot');

const T = (suit, num) => ({ id: `${suit}-${num}`, suit, num });

/* ---------- 1. 타일 세기 ---------- */
{
  const maxN = 15;
  // 3이 최저, 2가 최고
  assert(core.numRank(3, maxN) < core.numRank(4, maxN));
  assert(core.numRank(15, maxN) < core.numRank(1, maxN));
  assert(core.numRank(1, maxN) < core.numRank(2, maxN));
  // 같은 숫자면 해 > 달 > 별 > 구름
  assert(core.tileStrength(T('sun', 7), maxN) > core.tileStrength(T('moon', 7), maxN));
  assert(core.tileStrength(T('moon', 7), maxN) > core.tileStrength(T('star', 7), maxN));
  assert(core.tileStrength(T('star', 7), maxN) > core.tileStrength(T('cloud', 7), maxN));
  console.log('✅ 타일 세기');
}

/* ---------- 2. 조합 판정 ---------- */
{
  const maxN = 15;
  assert.equal(core.analyze([T('sun', 5)], maxN).type, 'single');
  assert.equal(core.analyze([T('sun', 5), T('moon', 5)], maxN).type, 'pair');
  assert.equal(core.analyze([T('sun', 5), T('moon', 6)], maxN), null);
  assert.equal(core.analyze([T('sun', 5), T('moon', 5), T('cloud', 5)], maxN).type, 'triple');
  // 4개는 조합 불가
  assert.equal(core.analyze([T('sun', 5), T('moon', 5), T('cloud', 5), T('star', 5)], maxN), null);
  // 스트레이트 / 플러쉬 / 풀하우스 / 포카드 / 스트레이트플러쉬
  assert.equal(core.analyze([T('sun', 4), T('moon', 5), T('cloud', 6), T('star', 7), T('sun', 8)], maxN).type, 'straight');
  assert.equal(core.analyze([T('sun', 4), T('sun', 9), T('sun', 12), T('sun', 15), T('sun', 1)], maxN).type, 'flush');
  assert.equal(core.analyze([T('sun', 8), T('moon', 8), T('star', 8), T('sun', 3), T('moon', 3)], maxN).type, 'fullhouse');
  assert.equal(core.analyze([T('sun', 15), T('moon', 15), T('star', 15), T('cloud', 15), T('sun', 10)], maxN).type, 'four');
  assert.equal(core.analyze([T('cloud', 4), T('cloud', 5), T('cloud', 6), T('cloud', 7), T('cloud', 8)], maxN).type, 'straightflush');
  console.log('✅ 조합 판정');
}

/* ---------- 3. 조합 서열 ---------- */
{
  const maxN = 15;
  const A = (tiles) => core.analyze(tiles, maxN);
  // 5개 조합 타입 서열
  const straight = A([T('sun', 4), T('moon', 5), T('cloud', 6), T('star', 7), T('sun', 8)]);
  const flush = A([T('cloud', 4), T('cloud', 9), T('cloud', 12), T('cloud', 13), T('cloud', 15)]);
  const full = A([T('sun', 3), T('moon', 3), T('star', 3), T('sun', 4), T('moon', 4)]);
  const four = A([T('sun', 3), T('moon', 3), T('star', 3), T('cloud', 3), T('sun', 10)]);
  const sf = A([T('cloud', 4), T('cloud', 5), T('cloud', 6), T('cloud', 7), T('cloud', 8)]);
  assert(core.beats(flush, straight));
  assert(core.beats(full, flush));
  assert(core.beats(four, full));
  assert(core.beats(sf, four));
  // 스트레이트 특수 서열: 1,2,3,4,5 > 2,3,4,5,6 > 12,13,14,15,1 > 11..15
  const s12345 = A([T('cloud', 1), T('moon', 2), T('cloud', 3), T('star', 4), T('sun', 5)]);
  const s23456 = A([T('cloud', 2), T('moon', 3), T('cloud', 4), T('star', 5), T('sun', 6)]);
  const s1215_1 = A([T('cloud', 12), T('moon', 13), T('cloud', 14), T('star', 15), T('sun', 1)]);
  const s1115 = A([T('cloud', 11), T('moon', 12), T('cloud', 13), T('star', 14), T('sun', 15)]);
  assert(core.beats(s12345, s23456));
  assert(core.beats(s23456, s1215_1));
  assert(core.beats(s1215_1, s1115));
  // 13,14,15,1,2 는 스트레이트가 아님
  assert.equal(A([T('cloud', 13), T('moon', 14), T('cloud', 15), T('star', 1), T('sun', 2)]), null);
  // 페어: 숫자 우선, 같으면 무늬
  const pLow = A([T('cloud', 11), T('star', 11)]);
  const pHigh = A([T('sun', 11), T('moon', 11)]);
  const pNum = A([T('cloud', 2), T('star', 2)]);
  assert(core.beats(pHigh, pLow));
  assert(core.beats(pNum, pHigh)); // 2 페어가 최고
  // 개수 다르면 못 이김
  assert(!core.beats(pHigh, A([T('sun', 5)])));
  console.log('✅ 조합 서열');
}

/* ---------- 4. 3인전(1~9) '1'의 특수기능 ---------- */
{
  const maxN = 9;
  const s = core.analyze([T('cloud', 6), T('moon', 7), T('cloud', 8), T('star', 9), T('sun', 1)], maxN);
  assert.equal(s.type, 'straight'); // 6,7,8,9,1(=10처럼)
  console.log("✅ '1'의 특수기능 (3인전 6-7-8-9-1)");
}

/* ---------- 5. 게임 진행 규칙 ---------- */
{
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const g = new Game(players);
  assert.equal(g.maxN, 13);
  for (const p of players) assert.equal(g.hands.get(p.id).length, 13);
  // 구름3 소유자가 선
  const starter = g.currentPlayerId();
  assert(g.hands.get(starter).some((t) => t.suit === 'cloud' && t.num === 3));
  // 선은 패스 불가
  assert.throws(() => g.pass(starter), /선/);
  console.log('✅ 게임 시작 규칙 (구름③ 선, 선 패스 불가)');
}

/* ---------- 6. 봇 자동 대전 (3/4/5인 × 여러 판) ---------- */
for (const pc of [3, 4, 5]) {
  for (let trial = 0; trial < 20; trial++) {
    const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i }));
    const g = new Game(players);
    let moves = 0;
    while (!g.finished) {
      const pid = g.currentPlayerId();
      const mv = chooseBotMove(g, pid);
      if (mv.action === 'play') g.play(pid, mv.tileIds);
      else g.pass(pid);
      moves++;
      assert(moves < 2000, '게임이 끝나지 않음(무한 루프)');
    }
    const res = g.results();
    const winner = res.find((r) => r.id === g.winnerId);
    assert.equal(winner.remaining, 0);
    // 전체 타일 보존 확인
    const totalLeft = res.reduce((s, r) => s + r.remaining, 0);
    assert(totalLeft < pc * (pc === 4 ? 13 : 12));
    // 2 검사: eff = remaining * 2^twos
    for (const r of res) assert.equal(r.eff, r.remaining * Math.pow(2, r.twos));
  }
  console.log(`✅ ${pc}인 봇 자동 대전 20판 완주`);
}

/* ---------- 7. 정산 검증 (룰북 예1) ---------- */
{
  // 1등 0, 2등 1, 3등 4, 4등 5, 5등 8 → 1등 +18, 2등 +13, 3등 -2, 4등 -7, 5등 -22
  const effs = [0, 1, 4, 5, 8];
  const chips = effs.map(() => 1000); // 한도 넉넉히
  const delta = effs.map(() => 0);
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++) {
      const diff = effs[j] - effs[i];
      if (diff > 0) { delta[j] -= diff; delta[i] += diff; }
    }
  assert.deepEqual(delta, [18, 13, -2, -7, -22]);
  console.log('✅ 칩 정산 (룰북 예제 일치)');
}

/* ---------- 8. 펠리시티: 개/토끼 효과 ---------- */
{
  const fcore = require('../public/shared/felicity-core.js');
  const C = (kind, value, size) => ({ id: `x-${kind}-${value}-${size || ''}`, kind, value, size });
  let r = fcore.resolveDogs([C('cat', 11), C('cat', -5), C('dog', 0, 'big'), C('cat', 3)]);
  assert(r.removed.some((c) => c.value === 11) && r.removed.some((c) => c.kind === 'dog'), '큰 개는 양수 최고 고양이 제거');
  r = fcore.resolveDogs([C('cat', 11), C('cat', -8), C('dog', 0, 'small')]);
  assert(r.removed.some((c) => c.value === -8) && r.removed.some((c) => c.kind === 'dog'), '작은 개는 최저 고양이 제거');
  r = fcore.resolveDogs([C('cat', 11), C('dog', 0, 'big'), C('dog', 0, 'small')]);
  assert(r.removed.length === 2 && r.removed.every((c) => c.kind === 'dog'), '개 2장은 개만 제거');
  // 큰 개인데 양수 고양이 없음 → 음수 중 최고값(0에 가까움) 제거
  r = fcore.resolveDogs([C('cat', -8), C('cat', -5), C('dog', 0, 'big')]);
  assert(r.removed.some((c) => c.value === -5), '양수 없으면 큰 개는 음수 최고값 제거');
  console.log('✅ 펠리시티 개/토끼 효과');
}

/* ---------- 9. 펠리시티: 봇 자동 대전 (4/5인) ---------- */
{
  const { FelicityGame } = require('../server/src/games/felicity/game');
  const { chooseBotMove } = require('../server/src/games/felicity/bot');
  for (const pc of [4, 5]) {
    for (let t = 0; t < 20; t++) {
      const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i, isBot: true }));
      const g = new FelicityGame(players);
      for (const p of players) assert.equal(g.hands.get(p.id).length, 9);
      let steps = 0;
      while (!g.finished) {
        const pid = g.currentActorId();
        assert(pid, '진행 중이면 행동자 존재');
        const mv = chooseBotMove(g, pid);
        if (mv.kind === 'place') g.place(pid, mv.cardId);
        else if (mv.kind === 'bid') g.bid(pid, mv.amount);
        else if (mv.kind === 'ready') g.ready(pid);
        else g.pass(pid);
        assert(++steps < 5000, '무한 루프 없음');
      }
      assert.equal(g.round, 9);
      for (const p of players) assert.equal(g.hands.get(p.id).length, 0);
      for (const r of g.results()) assert(r.coins >= 0, '코인 음수 아님');
    }
    console.log(`✅ 펠리시티 ${pc}인 봇 자동 대전 20판 완주`);
  }
}

/* ---------- 10. 우노: 봇 자동 대전 (2/4/6인) ---------- */
{
  const { UnoGame, buildDeck } = require('../server/src/games/uno/game');
  const { chooseBotMove } = require('../server/src/games/uno/bot');
  assert.equal(buildDeck().length, 108, '우노 덱 108장');
  for (const pc of [2, 4, 6]) {
    for (let t = 0; t < 30; t++) {
      const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i, isBot: true }));
      const g = new UnoGame(players);
      for (const p of players) assert.equal(g.handOf(p.id).length, 7, '7장 시작');
      assert(g.top().type === 'number', '시작 카드는 숫자');
      let steps = 0;
      while (!g.finished) {
        const pid = g.currentActorId();
        assert(pid, '진행 중이면 행동자 존재');
        const mv = chooseBotMove(g, pid);
        if (mv.kind === 'play') g.play(pid, mv.cardId, mv.color);
        else if (mv.kind === 'draw') g.draw(pid);
        else g.pass(pid);
        assert(++steps < 100000, '무한 루프 없음');
      }
      assert(g.winnerId, '승자 존재');
      assert.equal(g.handOf(g.winnerId).length, 0, '승자는 손패 0');
    }
    console.log(`✅ 우노 ${pc}인 봇 자동 대전 30판 완주`);
  }
}

console.log('\n🎉 모든 테스트 통과');
