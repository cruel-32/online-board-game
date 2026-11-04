'use strict';
const core = require('../../../../public/shared/runner-core.js');

/**
 * 점프러너 배틀로얄 매치 상태.
 *
 * 테트리스(클라이언트 권위 버전, server/src/games/tetris/game.js)와 같은 신뢰 모델이다 —
 * 사람 플레이어는 자기 캐릭터를 로컬에서 직접 시뮬레이션하고, 충돌로 죽었을 때 "버틴 시간"만
 * 1회 보고한다. 서버는 그 보고를 받아 탈락 순서를 매길 뿐 물리를 다시 계산하지 않는다
 * (자체 호스팅 캐주얼 앱 규모에서는 클라이언트를 신뢰하는 편이 충분히 안전하고 훨씬 단순하다).
 * 봇만 예외로, 서버가 public/js/games/runner/engine.js 인스턴스를 직접 들고 진행시킨다.
 *
 * 매치는 "전원이 죽어야" 끝난다(상대가 한 명만 남아도 끝내지 않음) — 마지막까지 남은 사람도
 * 자기 자신의 최고 기록(생존 시간)에 계속 도전할 수 있도록, 혼자 남은 뒤에도 직접 충돌할 때까지
 * 계속 플레이한다. startedAt 기준 벽시계 추정이 필요한 경우는 연결이 끊겨 스스로 보고할 수
 * 없는 handleDisconnect뿐이다.
 *
 * 순위는 "탈락한(=eliminate가 불린) 순서"가 아니라 각자 보고한 survivedMs 값으로 매긴다.
 * 사람은 네트워크를 거쳐 죽음을 보고하므로, 실제로는 더 오래 버텼는데도 그 보고가 늦게
 * 도착해 eliminate() 호출 자체는 먼저 일어날 수 있다(봇은 서버가 직접 틱을 돌려 지연이 없음).
 * 호출 순서로 순위를 매기면 이런 경우 실제 생존 시간과 거꾸로 된 순위가 나올 수 있어,
 * 신뢰하는 값(survivedMs) 자체를 기준으로 정렬한다.
 *
 * 다른 플레이어의 "실제 진행 상황"을 보여주기 위한 점프 이벤트 중계: 장애물은 시드+경과시간만
 * 으로 100% 결정론적이라(createEngine 참고), 각 클라이언트가 상대방과 "언제 점프했는지"만
 * 알면 똑같은 시드로 상대의 로컬 엔진을 그대로 재현("고스트")해 그릴 수 있다. pendingJumps는
 * 그 점프 알림을 뷰어별로 쌓아뒀다가 serialize()가 드레인하는 큐다(가비지 공격 큐와 같은 패턴).
 */
class Game {
  constructor(players, lives) {
    this.playerIds = players.map((p) => p.id);
    this.seed = core.randomSeed(); // 모두 같은 장애물 순서를 받는다(공정한 동시 진행)
    this.lives = core.clampLives(lives); // 방 옵션 "생명력"(1~3) — 봇 엔진 생성 시 그대로 전달
    this.startedAt = Date.now();   // 연결 끊김 등으로 자체 보고를 못 받을 때의 벽시계 추정에 사용
    this.alive = new Set(this.playerIds);
    this.survivedMs = new Map(this.playerIds.map((id) => [id, 0]));
    this.botEngines = new Map(); // botId -> RunnerEngine 인스턴스(서버가 직접 시뮬레이션)
    this.pendingJumps = new Map(this.playerIds.map((id) => [id, []])); // 뷰어별 "아직 못 받은 남의 점프 알림" 큐
    this.finished = false;
    this.winnerId = null;
  }

  eliminate(pid, survivedMs) {
    if (!this.alive.has(pid) || this.finished) return;
    this.survivedMs.set(pid, Math.max(0, Math.round(survivedMs || 0)));
    this.alive.delete(pid);
    this.checkEnd();
  }

  // fromId가 점프했음을 본인을 제외한 모두에게 알린다(고스트 재현용). 판정에는 영향 없는
  // 순수 연출 이벤트라, 유실돼도(예: 그 사이 라운드가 끝남) 게임 결과엔 아무 지장이 없다.
  recordJump(fromId) {
    if (!this.alive.has(fromId) || this.finished) return;
    for (const pid of this.playerIds) {
      if (pid === fromId) continue;
      this.pendingJumps.get(pid).push(fromId);
    }
  }

  checkEnd() {
    if (this.finished) return;
    if (this.alive.size === 0) {
      this.finished = true;
      let best = null;
      for (const id of this.playerIds) {
        const ms = this.survivedMs.get(id) || 0;
        if (!best || ms > best.ms) best = { id, ms };
      }
      this.winnerId = best ? best.id : null;
    }
  }

  /** 결과 정산용: survivedMs 내림차순으로 순위를 매긴다(가장 오래 버틴 사람 = 1등). */
  results() {
    const rows = this.playerIds.map((id) => ({ id, survivedMs: this.survivedMs.get(id) || 0 }));
    rows.sort((a, b) => b.survivedMs - a.survivedMs);
    return rows.map((r, i) => ({ id: r.id, rank: i + 1, survivedMs: r.survivedMs }));
  }
}

module.exports = { Game };
