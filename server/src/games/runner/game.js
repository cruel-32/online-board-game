'use strict';
const core = require('../../../../public/shared/runner-core.js');

/**
 * 러너 배틀로얄 매치 상태.
 *
 * 테트리스(클라이언트 권위 버전, server/src/games/tetris/game.js)와 같은 신뢰 모델이다 —
 * 사람 플레이어는 자기 캐릭터를 로컬에서 직접 시뮬레이션하고, 충돌로 죽었을 때 "버틴 시간"만
 * 1회 보고한다. 서버는 그 보고를 받아 탈락 순서를 매길 뿐 물리를 다시 계산하지 않는다
 * (자체 호스팅 캐주얼 앱 규모에서는 클라이언트를 신뢰하는 편이 충분히 안전하고 훨씬 단순하다).
 * 봇만 예외로, 서버가 public/js/games/runner/engine.js 인스턴스를 직접 들고 진행시킨다.
 */
class Game {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.seed = core.randomSeed(); // 모두 같은 장애물 순서를 받는다(공정한 동시 진행)
    this.startedAt = Date.now();   // 아직 죽지 않은 생존자의 "버틴 시간" 추정에 사용
    this.alive = new Set(this.playerIds);
    this.survivedMs = new Map(this.playerIds.map((id) => [id, 0]));
    this.botEngines = new Map(); // botId -> RunnerEngine 인스턴스(서버가 직접 시뮬레이션)
    this.eliminationOrder = []; // 먼저 탈락한 순서대로 쌓임
    this.finished = false;
    this.winnerId = null;
  }

  eliminate(pid, survivedMs) {
    if (!this.alive.has(pid) || this.finished) return;
    this.survivedMs.set(pid, Math.max(0, Math.round(survivedMs || 0)));
    this.alive.delete(pid);
    this.eliminationOrder.push(pid);
    this.checkEnd();
  }

  checkEnd() {
    if (this.finished) return;
    if (this.alive.size <= 1) {
      this.finished = true;
      this.winnerId = this.alive.size === 1 ? [...this.alive][0] : (this.eliminationOrder[this.eliminationOrder.length - 1] || null);
      // 끝까지 살아남은 사람은 스스로 "죽음"을 보고하지 않으므로, 매치 종료 시점까지의 벽시계 경과로
      // 버틴 시간을 매긴다(사람/봇의 자체 보고 시간과 기준을 맞추기 위해 카운트다운 유예를 뺀다).
      if (this.winnerId) this.survivedMs.set(this.winnerId, Math.max(0, Date.now() - this.startedAt - core.COUNTDOWN_MS));
    }
  }

  /** 결과 정산용: 탈락 순서를 뒤집어 순위를 매긴다(마지막까지 생존 = 1등). */
  results() {
    const order = [...this.eliminationOrder];
    const survivors = this.playerIds.filter((id) => this.alive.has(id));
    const rankedIds = [...survivors, ...order.slice().reverse()];
    return rankedIds.map((id, i) => ({
      id, rank: i + 1,
      survivedMs: this.survivedMs.get(id) || 0,
      survived: this.alive.has(id),
    }));
  }
}

module.exports = { Game };
