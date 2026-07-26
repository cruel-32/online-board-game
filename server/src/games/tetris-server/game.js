'use strict';
const core = require('../../../../public/shared/tetris-core.js');
const Engine = require('../../../../public/js/games/tetris/engine.js');

/**
 * 테트리스(서버권위) 배틀로얄 매치 상태.
 *
 * public/js/games/tetris(클라이언트 권위 버전)와 정반대로, 여기서는 서버가 전원(사람+봇)의
 * 실제 TetrisEngine 인스턴스를 직접 들고 물리(중력·충돌·회전·락딜레이)를 전부 계산한다.
 * 클라이언트는 입력만 보내고, 서버가 매 틱 브로드캐스트하는 상태를 그대로 그리기만 한다
 * (로컬 시뮬레이션·예측 없음 — 두 아키텍처를 있는 그대로 비교하기 위한 의도적 설계).
 *
 * 가비지도 클라이언트 권위 버전처럼 "다음 setState에서 로컬 엔진에 반영"하는 중계 큐가 필요 없다 —
 * 서버가 대상 엔진 인스턴스를 직접 갖고 있으므로 queueGarbage()를 즉시 호출하면 그걸로 끝이다.
 * pendingAttacks/selfEvents는 오직 "연출(배너·사운드)을 위한 알림"일 뿐, 판정 자체와는 무관하다.
 */
class Game {
  constructor(players) {
    this.playerIds = players.map((p) => p.id);
    this.seed = core.randomSeed(); // 이번엔 클라이언트에 배포할 필요가 없다(서버만 조각 순서를 앎)
    this.alive = new Set(this.playerIds);
    this.engines = new Map(this.playerIds.map((id) => [id, Engine.createEngine(this.seed)]));
    this.stats = new Map(this.playerIds.map((id) => [id, {
      linesCleared: 0, garbageSent: 0, garbageReceived: 0,
    }]));
    // 연출 전용 알림 큐(serialize()가 뷰어별로 드레인). 판정에는 전혀 영향을 주지 않는다.
    this.pendingAttacks = new Map(this.playerIds.map((id) => [id, []])); // 내가 "받은" 공격
    this.selfEvents = new Map(this.playerIds.map((id) => [id, []]));    // 내가 "낸" 락 결과(콤보/백투백 등)
    this.eliminationOrder = [];
    this.finished = false;
    this.winnerId = null;
    // 눈에 보이는 상태가 바뀔 때마다 +1(락/가비지/탈락 = 여기서, 락 없는 이동/자연낙하 = index.js에서).
    // index.js가 이 값으로 "이번 틱에 브로드캐스트할 필요가 있는지"와 "직렬화 캐시가 아직 유효한지"를 판단한다.
    this.version = 0;
  }

  eliminate(pid) {
    if (!this.alive.has(pid) || this.finished) return;
    this.alive.delete(pid);
    this.eliminationOrder.push(pid);
    this.version++;
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
   * 조각이 고정되는 모든 경로(사람의 즉시 입력, 자연 중력 락, 봇의 결정)가 공통으로 거치는 지점.
   * ev: engine.tick()/hardDrop()이 반환하는 { locked, linesCleared, garbageSent, topOut, combo, b2b }
   */
  applyLockResult(pid, ev) {
    if (this.finished || !this.alive.has(pid) || !ev || !ev.locked) return;
    this.version++;
    const s = this.stats.get(pid);
    s.linesCleared += Math.max(0, ev.linesCleared || 0);
    this.selfEvents.get(pid).push({
      linesCleared: ev.linesCleared, garbageSent: ev.garbageSent, combo: ev.combo, b2b: ev.b2b, topOut: ev.topOut,
    });

    const garbageSent = Math.max(0, ev.garbageSent || 0);
    if (garbageSent > 0) {
      const targets = [...this.alive].filter((id) => id !== pid);
      if (targets.length) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        const holeCol = Math.floor(Math.random() * core.COLS);
        this.engines.get(target).queueGarbage(garbageSent, holeCol); // 대상 엔진에 즉시 반영(중계 불필요)
        s.garbageSent += garbageSent;
        this.stats.get(target).garbageReceived += garbageSent;
        this.pendingAttacks.get(target).push({ lines: garbageSent, fromId: pid });
      }
    }
    if (ev.topOut) this.eliminate(pid);
  }

  /** 결과 정산용: 탈락 순서를 뒤집어 순위를 매긴다(마지막까지 생존 = 1등). */
  results() {
    const order = [...this.eliminationOrder];
    const survivors = this.playerIds.filter((id) => this.alive.has(id));
    const rankedIds = [...survivors, ...order.slice().reverse()];
    return rankedIds.map((id, i) => {
      const s = this.stats.get(id);
      return {
        id, rank: i + 1,
        linesCleared: s.linesCleared, garbageSent: s.garbageSent, garbageReceived: s.garbageReceived,
        survived: this.alive.has(id),
      };
    });
  }
}

module.exports = { Game };
