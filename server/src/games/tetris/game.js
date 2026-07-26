'use strict';
const core = require('../../../../public/shared/tetris-core.js');

/**
 * 테트리스 배틀로얄 매치 상태.
 *
 * 이 게임은 다른 게임들과 달리 "차례"가 없다 — 4명이 각자 실시간으로 자기 보드를 플레이한다.
 * 서버는 물리 엔진(중력·충돌·회전)을 다시 구현하지 않는다. 각 클라이언트가 자신의 보드를
 * public/js/games/tetris/engine.js로 직접 시뮬레이션하고, 조각이 바닥에 고정될 때마다
 * "지운 줄 수 + 보낼 가비지 수 + 보드 스냅샷"만 이벤트로 보고한다. 서버는 그 보고를 받아
 * 가비지를 상대에게 배분하고 탈락(보드가 가득 차 topOut)을 심판하는 역할만 한다.
 * (자체 호스팅 친구 모임용 앱 규모에서는, 서버가 매 프레임 보드를 재검증하는 것보다
 * 클라이언트 보고를 신뢰하는 편이 훨씬 단순하고 실질적으로 충분히 안전하다.)
 */
class Game {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.seed = core.randomSeed(); // 매치 전체가 공유하는 7-bag 시드 — 모두 같은 조각 순서를 받는다
    this.alive = new Set(this.playerIds);
    this.boards = new Map(this.playerIds.map((id) => [id, {
      lastBoard: null, holdType: null, nextTypes: [],
      linesCleared: 0, garbageSent: 0, garbageReceived: 0, topOut: false,
    }]));
    // 각 플레이어에게 아직 전달하지 않은 가비지 공격. serialize()가 브로드캐스트에 실어보낸 뒤 비운다.
    this.pendingGarbage = new Map(this.playerIds.map((id) => [id, []]));
    this.botEngines = new Map(); // botId -> TetrisEngine 인스턴스(서버가 대신 시뮬레이션, index.js의 startBots가 채움)
    this.eliminationOrder = []; // 탈락한 순서대로 쌓임(먼저 탈락 = 낮은 순위)
    this.finished = false;
    this.winnerId = null;
    this.seq = 0;
  }

  eliminate(pid) {
    if (!this.alive.has(pid) || this.finished) return;
    this.alive.delete(pid);
    this.boards.get(pid).topOut = true;
    this.eliminationOrder.push(pid);
    this.checkEnd();
  }

  checkEnd() {
    if (this.finished) return;
    if (this.alive.size <= 1) {
      this.finished = true;
      this.winnerId = this.alive.size === 1 ? [...this.alive][0] : (this.eliminationOrder[this.eliminationOrder.length - 1] || null);
    }
  }

  /**
   * 클라이언트가 보고한 락(조각 고정) 이벤트를 반영한다.
   * payload: { linesCleared, garbageSent, topOut, board, holdType, nextTypes }
   */
  applyLock(pid, payload) {
    if (this.finished || !this.alive.has(pid)) return;
    const b = this.boards.get(pid);
    b.lastBoard = Array.isArray(payload.board) ? payload.board : b.lastBoard;
    b.holdType = payload.holdType || null;
    b.nextTypes = Array.isArray(payload.nextTypes) ? payload.nextTypes.slice(0, 5) : b.nextTypes;
    b.linesCleared += Math.max(0, payload.linesCleared || 0);
    this.seq++;

    const garbageSent = Math.max(0, payload.garbageSent || 0);
    if (garbageSent > 0) {
      const targets = [...this.alive].filter((id) => id !== pid);
      if (targets.length) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        const holeCol = Math.floor(Math.random() * core.COLS);
        this.pendingGarbage.get(target).push({ seq: this.seq, lines: garbageSent, holeCol, fromId: pid });
        b.garbageSent += garbageSent;
        this.boards.get(target).garbageReceived += garbageSent;
      }
    }
    if (payload.topOut) this.eliminate(pid);
  }

  /** 결과 정산용: 탈락 순서를 뒤집어 순위를 매긴다(마지막까지 생존 = 1등). */
  results() {
    const order = [...this.eliminationOrder]; // 먼저 탈락한 사람이 앞쪽
    const survivors = this.playerIds.filter((id) => this.alive.has(id));
    const rankedIds = [...survivors, ...order.slice().reverse()]; // 생존자 먼저(공동 1등 취급), 그다음 늦게 탈락한 순
    const rows = rankedIds.map((id, i) => {
      const b = this.boards.get(id);
      return {
        id, rank: i + 1,
        linesCleared: b.linesCleared, garbageSent: b.garbageSent, garbageReceived: b.garbageReceived,
        survived: this.alive.has(id),
      };
    });
    return rows;
  }
}

module.exports = { Game };
