'use strict';
const core = require('../../public/shared/lexio-core.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 한 라운드의 게임 상태. 좌석 순서 = players 배열 순서.
 * 한 명이 손패를 모두 털면 라운드 종료.
 */
class Game {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.maxN = core.maxNumberFor(players.length);
    const per = players.length === 4 ? 13 : 12;
    const deck = shuffle(core.buildDeck(this.maxN));
    this.hands = new Map();
    players.forEach((p, i) => {
      this.hands.set(p.id, core.sortTiles(deck.slice(i * per, (i + 1) * per), this.maxN));
    });

    // 구름 3 소유자가 선
    let starter = 0;
    players.forEach((p, i) => {
      if (this.hands.get(p.id).some((t) => t.suit === 'cloud' && t.num === 3)) starter = i;
    });
    this.turnIdx = starter;
    this.leaderId = this.playerIds[starter];
    this.current = null; // { combo, byId }
    this.lastPlayerId = null;
    this.passed = new Set();
    this.finished = false;
    this.winnerId = null;
  }

  currentPlayerId() {
    return this.playerIds[this.turnIdx];
  }

  play(pid, tileIds) {
    if (this.finished) throw new Error('이미 종료된 라운드입니다.');
    if (pid !== this.currentPlayerId()) throw new Error('당신의 차례가 아닙니다.');
    if (!Array.isArray(tileIds) || new Set(tileIds).size !== tileIds.length)
      throw new Error('잘못된 타일 선택입니다.');
    const hand = this.hands.get(pid);
    const tiles = tileIds.map((id) => hand.find((t) => t.id === id));
    if (tiles.some((t) => !t)) throw new Error('가지고 있지 않은 타일입니다.');
    const combo = core.analyze(tiles, this.maxN);
    if (!combo) throw new Error('유효한 조합이 아닙니다. (1·2·3·5개만 가능)');
    if (this.current) {
      if (combo.count !== this.current.combo.count)
        throw new Error('앞 사람과 같은 개수로 내야 합니다.');
      if (!core.beats(combo, this.current.combo))
        throw new Error('앞 사람보다 더 높은 조합을 내야 합니다.');
    }
    this.hands.set(pid, hand.filter((t) => !tileIds.includes(t.id)));
    this.current = { combo, byId: pid };
    this.lastPlayerId = pid;
    this.passed = new Set();
    if (this.hands.get(pid).length === 0) {
      this.finished = true;
      this.winnerId = pid;
      return { finished: true };
    }
    this.advance();
    return { finished: false };
  }

  pass(pid) {
    if (this.finished) throw new Error('이미 종료된 라운드입니다.');
    if (pid !== this.currentPlayerId()) throw new Error('당신의 차례가 아닙니다.');
    if (!this.current) throw new Error('선(先)은 반드시 타일을 내야 합니다.');
    this.passed.add(pid);
    this.advance();
    if (this.currentPlayerId() === this.lastPlayerId) {
      // 전원 패스 → 마지막으로 낸 사람이 새로운 선
      this.current = null;
      this.passed = new Set();
      this.leaderId = this.lastPlayerId;
    }
  }

  advance() {
    this.turnIdx = (this.turnIdx + 1) % this.playerIds.length;
  }

  /** 라운드 종료 시 남은 타일/2배 계산 결과 */
  results() {
    return this.playerIds.map((id) => {
      const hand = this.hands.get(id);
      const twos = hand.filter((t) => t.num === 2).length;
      return {
        id,
        remaining: hand.length,
        twos,
        eff: hand.length * Math.pow(2, twos),
        tiles: hand,
      };
    });
  }
}

module.exports = { Game, shuffle };
