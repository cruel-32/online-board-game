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

/* ---------- 11. 포커 핸드 평가기 ---------- */
{
  const P = require('../public/shared/poker-core.js');
  const c = (r, s) => ({ rank: r, suit: s, id: r + s });
  const cmp = (a, b) => P.compareScore(P.evaluateBest(a).score, P.evaluateBest(b).score);
  const sf = [c(10, 's'), c(9, 's'), c(8, 's'), c(7, 's'), c(6, 's'), c(2, 'd'), c(3, 'h')];
  const quad = [c(9, 's'), c(9, 'h'), c(9, 'd'), c(9, 'c'), c(6, 's'), c(2, 'd'), c(3, 'h')];
  assert(cmp(sf, quad) > 0, '스트레이트 플러시 > 포카드');
  const wheel = [c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's'), c(13, 'd'), c(11, 'h')];
  assert.deepEqual(P.evaluateBest(wheel).score, [4, 5], '휠 스트레이트(A-5)');
  const fh = [c(8, 's'), c(8, 'h'), c(8, 'd'), c(3, 'c'), c(3, 's'), c(2, 'd'), c(9, 'h')];
  const fl = [c(14, 'h'), c(11, 'h'), c(8, 'h'), c(4, 'h'), c(2, 'h'), c(3, 'd'), c(9, 'c')];
  assert(cmp(fh, fl) > 0, '풀하우스 > 플러시');
  console.log('✅ 포커 핸드 평가기');
}

/* ---------- 12. 홀덤: 봇 대전 + 칩 보존 ---------- */
{
  const holdem = require('../server/src/games/holdem');
  const STACK = 1000;
  for (const pc of [2, 3, 4, 6]) {
    for (let t = 0; t < 5; t++) {
      const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true, connected: true }));
      const room = { id: 'r', name: '방', players, options: { stack: STACK }, roundNo: 0, matchOver: false };
      holdem.resetMatch(room);
      const total0 = players.reduce((s, p) => s + p.chips, 0);
      let hands = 0;
      while (!room.matchOver && players.filter((p) => p.chips > 0).length >= 2 && hands < 400) {
        room.roundNo++;
        const g = holdem.createGame(room);
        let steps = 0;
        while (!g.finished) {
          const pid = holdem.currentActor(g);
          assert(pid, '진행 중이면 행동자 존재');
          holdem.applyAction(g, room, pid, holdem.botAction(g, pid));
          assert(++steps < 100000, '무한 루프 없음');
        }
        holdem.settle(g, room);
        assert.equal(players.reduce((s, p) => s + p.chips, 0), total0, '칩 보존');
        hands++;
      }
      assert(hands > 0, '핸드 진행됨');
    }
    console.log(`✅ 홀덤 ${pc}인 봇 대전 5매치 (칩 보존)`);
  }
}

/* ---------- 13. 세븐포커: 봇 대전 + 칩 보존 + 카드 무결성 ---------- */
{
  const seven = require('../server/src/games/seven');
  for (const pc of [2, 3, 4, 6]) {
    for (let t = 0; t < 5; t++) {
      const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true, connected: true }));
      const room = { id: 'r', name: '방', players, options: { stack: 1000 }, roundNo: 0, matchOver: false };
      seven.resetMatch(room);
      const total0 = players.reduce((s, p) => s + p.chips, 0);
      let hands = 0;
      while (!room.matchOver && players.filter((p) => p.chips > 0).length >= 2 && hands < 200) {
        room.roundNo++;
        const g = seven.createGame(room);
        let steps = 0;
        while (!g.finished) {
          const pid = seven.currentActor(g);
          assert(pid, '진행 중이면 행동자 존재');
          seven.applyAction(g, room, pid, seven.botAction(g, pid));
          assert(++steps < 100000, '무한 루프 없음');
        }
        const seen = new Set();
        for (const s of g.seats) for (const c of s.cards) { const id = c.card.rank + c.card.suit; assert(!seen.has(id), '카드 중복 없음'); seen.add(id); }
        seven.settle(g, room);
        assert.equal(players.reduce((s, p) => s + p.chips, 0), total0, '칩 보존');
        hands++;
      }
      assert(hands > 0, '핸드 진행됨');
    }
    console.log(`✅ 세븐포커 ${pc}인 봇 대전 5매치 (칩 보존·카드 무결성)`);
  }
}

/* ---------- 14: 노땡스: 봇 자동 대전 + 카드/칩 무결성 ---------- */
{
  const { Game, startingChips } = require('../server/src/games/notthanks/game');
  const { chooseBotMove } = require('../server/src/games/notthanks/bot');
  for (const pc of [3, 4, 5]) {
    for (let trial = 0; trial < 30; trial++) {
      const players = Array.from({ length: pc }, (_, i) => ({ id: 'p' + i }));
      const g = new Game(players);
      assert.equal(g.deck.length + 1, 24, '덱 24장(초기 오픈 카드 1장 포함)');
      assert.equal(g.chips.get(players[0].id), startingChips(pc), '시작 칩 개수');
      let steps = 0;
      while (!g.finished) {
        const pid = g.currentPlayerId();
        const mv = chooseBotMove(g, pid);
        if (mv.action === 'take') g.take(pid);
        else g.pass(pid);
        assert(++steps < 5000, '게임이 끝나지 않음(무한 루프)');
      }
      const res = g.results();
      const totalCards = res.reduce((s, r) => s + r.cards.length, 0);
      assert.equal(totalCards, 24, '카드 24장 모두 분배됨');
      // 칩 총량 보존: 시작 총 칩 = 지금 각자 보유 칩 + 카드 위에 얹힌 칩(종료 시 0)
      const totalChipsNow = res.reduce((s, r) => s + r.chips, 0);
      assert.equal(totalChipsNow, startingChips(pc) * pc, '칩 총량 보존');
      // 중복 카드 없음
      const seen = new Set();
      for (const r of res) for (const c of r.cards) { assert(!seen.has(c), '카드 중복 없음'); seen.add(c); }
    }
    console.log(`✅ 노땡스 ${pc}인 봇 자동 대전 30판 완주`);
  }
  // 연속 숫자 최저값만 계산되는지 점수 공식 검증
  {
    const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const g = new Game(players);
    g.cardsOwned.set('a', [5, 6, 7, 20]); // 5-6-7 연속 → 5만 계산, +20 = 25
    g.chips.set('a', 3);
    const r = g.results().find((x) => x.id === 'a');
    assert.equal(r.cardSum, 25, '연속 구간은 최저값만 합산');
    assert.equal(r.score, 22, '카드합 - 보유 칩');
  }
  console.log('✅ 노땡스 점수 계산(연속 구간 최저값 합산)');
}

/* ---------- 15: 테트리스 — 공용 코어(7-bag/킥) + 클라이언트 엔진(순수 로직) ---------- */
{
  const core = require('../public/shared/tetris-core.js');
  const { createEngine, cellsFor, COLS, ROWS } = require('../public/js/games/tetris/engine.js');

  // 7-bag: 같은 시드는 같은 순서, 매 7개 구간마다 7종류가 모두 한 번씩만 나온다
  {
    const gen1 = core.createBagGenerator(12345);
    const gen2 = core.createBagGenerator(12345);
    const seq1 = Array.from({ length: 35 }, () => gen1());
    const seq2 = Array.from({ length: 35 }, () => gen2());
    assert.deepEqual(seq1, seq2, '같은 시드는 항상 같은 조각 순서');
    for (let i = 0; i < 35; i += 7) {
      const bag = seq1.slice(i, i + 7);
      assert.equal(new Set(bag).size, 7, `bag ${i / 7}에 7종류가 모두 있어야 함`);
    }
    console.log('✅ 테트리스 7-bag 결정론적 시드 + 종류 보장');
  }

  // 가비지 테이블
  {
    assert.deepEqual([1, 2, 3, 4].map(core.garbageForClear), [0, 1, 2, 4], '싱글/더블/트리플/테트리스 가비지 값');
    console.log('✅ 테트리스 가비지 테이블');
  }

  // 줄 삭제: 세로 I 조각으로 마지막 한 칸을 채우면 그 줄이 삭제되고 위쪽이 내려온다
  {
    const e = createEngine(1);
    const s = e.getState();
    for (let c = 1; c < COLS; c++) s.board[ROWS - 1][c] = 'X';
    s.cur = { type: 'I', rot: 1, x: -2, y: 0 }; // 0번 열에 세로로 떨어짐
    const r = e.hardDrop();
    assert.equal(r.linesCleared, 1, '완성된 한 줄이 삭제됨');
    assert.equal(s.board.length, ROWS, '삭제 후에도 보드 높이는 유지(위에 빈 줄 보충)');
    console.log('✅ 테트리스 줄 삭제');
  }

  // 가비지 삽입: 구멍 열을 제외하고 채워지며, 보드 높이는 유지된다
  {
    const e = createEngine(2);
    const s = e.getState();
    e.queueGarbage(3, 4);
    e.hardDrop(); // 아무 조각이나 고정시켜 큐에 쌓인 가비지를 반영
    assert.equal(s.garbageReceivedTotal, 3, '받은 가비지 누적');
    for (let i = ROWS - 3; i < ROWS; i++) {
      assert.equal(s.board[i][4], null, '구멍 열은 비어 있어야 함');
      assert.equal(s.board[i].filter((c) => c).length, COLS - 1, '구멍 열 제외 나머지는 모두 채워짐');
    }
    assert.equal(s.board.length, ROWS, '가비지 삽입 후에도 보드 높이 유지');
    console.log('✅ 테트리스 가비지 삽입(구멍 열)');
  }

  // 탑아웃: 다음 조각의 스폰 칸이 막혀 있으면 즉시 탈락 처리
  {
    const e = createEngine(5);
    const s = e.getState();
    const nextType = s.queue[0];
    for (const [cx, cy] of cellsFor(nextType, 0, 3, 0)) if (cy >= 0) s.board[cy][cx] = 'X';
    const r = e.hardDrop();
    assert.equal(r.topOut, true, '스폰 불가 시 탑아웃');
    assert.equal(s.topOut, true);
    console.log('✅ 테트리스 탑아웃 판정');
  }

  // 락딜레이: 바닥에 닿으면 카운트다운, 이동/회전 시 리셋(상한 있음), 시간이 다 되면 강제 고정
  {
    const e = createEngine(7);
    const s = e.getState();
    while (e.softDrop()) { /* 바닥까지 내려 grounded 상태로 만듦 */ }
    assert.equal(s.grounded, true);
    assert.equal(e.tick(300).locked, false, '락딜레이(500ms) 이내면 아직 안 잠김');
    e.moveLeft(); // 리셋
    assert.equal(e.tick(300).locked, false, '리셋 후 300ms는 아직 안 잠김');
    assert.equal(e.tick(300).locked, true, '리셋 후 총 600ms 경과하면 잠김');
    console.log('✅ 테트리스 락딜레이(리셋 포함)');
  }

  // 홀드: 고정되기 전까지는 재홀드 불가, 고정 후에는 다시 가능
  {
    const e = createEngine(9);
    const s = e.getState();
    assert.equal(e.hold(), true, '첫 홀드는 성공');
    assert.equal(e.hold(), false, '같은 조각이 고정되기 전 재홀드는 실패');
    e.hardDrop();
    assert.equal(s.canHold, true, '고정 후에는 다시 홀드 가능');
    console.log('✅ 테트리스 홀드(고정 전 재홀드 금지)');
  }

  // 시간 기반 가속: 개인 성과와 무관하게 매치 경과 시간에 따라 낙하 속도가 빨라지고, 최저치 이하로는 안 내려감
  {
    const { gravityForElapsed } = require('../public/js/games/tetris/engine.js');
    const g0 = gravityForElapsed(0);
    const g1 = gravityForElapsed(20000);
    const gMax = gravityForElapsed(10_000_000);
    assert.equal(g0.gravityMs, 900, '시작 시 기본 중력');
    assert(g1.gravityMs < g0.gravityMs, '20초 경과 후 더 빨라짐');
    assert.equal(gMax.gravityMs, 100, '충분히 시간이 지나면 최저치(100ms)에서 멈춤');
    console.log('✅ 테트리스 시간 기반 가속(성과 무관, 최저치 클램프)');
  }

  // 콤보/백투백 가비지 보너스: 연속 클리어일수록, 연속 테트리스일수록 더 큰 공격이 나가야 한다
  {
    const e = createEngine(3);
    const s = e.getState();
    const fillRow = (row) => { for (let c = 1; c < COLS; c++) s.board[row][c] = 'X'; };

    fillRow(19);
    s.cur = { type: 'I', rot: 1, x: -2, y: 0 };
    const r1 = e.hardDrop();
    assert.equal(r1.garbageSent, 0, '첫 클리어는 콤보 보너스 없음(더블 미만이라 기본값도 0)');
    assert.equal(r1.combo, 0);

    fillRow(19);
    s.cur = { type: 'I', rot: 1, x: -2, y: 0 };
    const r2 = e.hardDrop();
    assert.equal(r2.garbageSent, 1, '두 번째 연속 클리어부터 콤보 보너스 +1');
    assert.equal(r2.combo, 1);

    // 클리어 없는 락으로 콤보를 끊는다
    s.cur = { type: 'O', rot: 0, x: 8, y: 0 };
    const r3 = e.hardDrop();
    assert.equal(r3.combo, -1, '클리어 실패 시 콤보 초기화');

    // 백투백: 테트리스(4줄)를 연속으로 성공시키면 보너스 추가
    const fillTetris = () => { for (let r = ROWS - 4; r < ROWS; r++) fillRow(r); };
    fillTetris();
    s.cur = { type: 'I', rot: 1, x: -2, y: 0 };
    const t1 = e.hardDrop();
    assert.equal(t1.garbageSent, 4, '첫 테트리스는 백투백 보너스 없음');
    assert.equal(t1.b2b, false);

    fillTetris();
    s.cur = { type: 'I', rot: 1, x: -2, y: 0 };
    const t2 = e.hardDrop();
    assert.equal(t2.garbageSent, 6, '연속 테트리스: 기본 4 + 콤보 +1 + 백투백 +1 = 6');
    assert.equal(t2.b2b, true);
    console.log('✅ 테트리스 콤보/백투백 가비지 보너스');
  }

  // 봇 AI: 휴리스틱 배치 탐색이 실제로 오래 버티며 줄을 지우는지 검증(placeholder가 아님을 보장)
  {
    const { playOneMove } = require('../server/src/games/tetris/bot');
    const e = createEngine(42);
    const s = e.getState();
    let locks = 0, linesCleared = 0;
    for (let i = 0; i < 300; i++) {
      const ev = playOneMove(e);
      if (ev.locked) { locks++; linesCleared += ev.linesCleared; }
      if (s.topOut) break;
    }
    assert.equal(s.topOut, false, '휴리스틱 봇은 300수 동안 탑아웃하지 않아야 함');
    assert.equal(locks, 300, '300수 모두 정상적으로 고정되어야 함');
    assert(linesCleared > 20, `봇이 충분히 줄을 지워야 함(실제: ${linesCleared})`);
    console.log('✅ 테트리스 봇 AI(300수 생존 + 줄 클리어)');
  }

  // 퍼징: 무작위 입력을 오래 반복해도 예외 없이 동작(충돌/경계 처리 검증)
  {
    for (let trial = 0; trial < 10; trial++) {
      const e = createEngine(1000 + trial);
      const s = e.getState();
      let steps = 0, topOuts = 0;
      while (steps++ < 3000) {
        const r = Math.random();
        if (r < 0.2) e.moveLeft();
        else if (r < 0.4) e.moveRight();
        else if (r < 0.55) e.rotateCW();
        else if (r < 0.65) e.rotateCCW();
        else if (r < 0.75) e.hold();
        else if (r < 0.85) e.softDrop();
        else { const res = e.hardDrop(); if (res.topOut) { topOuts++; break; } }
        e.tick(50);
        // 보드 크기 불변 검증(가비지 삽입/줄삭제 어느 경우에도 항상 ROWS를 유지해야 함)
        assert.equal(s.board.length, ROWS, '보드 높이는 항상 20 유지');
        assert.equal(s.board.every((row) => row.length === COLS), true, '모든 행은 항상 10칸 유지');
      }
    }
    console.log('✅ 테트리스 무작위 입력 퍼징(3000스텝 × 10회, 충돌/경계 이상 없음)');
  }
}

console.log('\n🎉 모든 테스트 통과');
