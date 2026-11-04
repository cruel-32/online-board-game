'use strict';
/**
 * 러너 봇 AI — 가장 가까운 장애물까지의 거리를 속도 기준 "반응 시간"으로 환산해 점프 타이밍을
 * 잡는 단순 휴리스틱. 타워형(tall) 장애물은 1단 점프로 못 넘으므로, 점프 후 정점 근처에서
 * 자동으로 2단 점프를 예약해 넘는다. 테트리스 봇(server/src/games/tetris/bot.js)처럼 완벽하진
 * 않지만(반응시간에 무작위 편차를 둬서 실수도 함) 자체 호스팅 캐주얼 앱의 상대로는 충분하다.
 */
const core = require('../../../../public/shared/runner-core.js');
const { PLAYER_X, PLAYER_W, FRAME_MS } = core;

const PLAYER_FRONT = PLAYER_X + PLAYER_W;
const REACTION_MS_MIN = 170;
const REACTION_MS_JITTER = 90;
const SECOND_JUMP_DELAY_MS = 230; // 1단 점프 정점(≈278ms) 근처에서 2단 점프를 눌러 최대 높이를 얻음
const SECOND_JUMP_JITTER = 40;

/** 봇 한 개체의 상태(2단 점프 예약 타이머)를 들고 있는 컨트롤러를 만든다. */
function createBot() {
  let pendingSecondJumpAt = null;

  return {
    // engine: RunnerEngine 인스턴스. 매 서버 틱마다 호출.
    step(engine) {
      const st = engine.getState();
      if (st.dead) return;

      if (pendingSecondJumpAt != null) {
        if (st.elapsedMs >= pendingSecondJumpAt) {
          engine.jump();
          pendingSecondJumpAt = null;
        }
        return;
      }

      if (!st.grounded) return; // 이미 점프 중(타워가 아니면 추가 입력 없음)
      const upcoming = st.obstacles.find((o) => o.x + o.w > PLAYER_FRONT);
      if (!upcoming) return;

      const dist = upcoming.x - PLAYER_FRONT;
      const reactionMs = REACTION_MS_MIN + Math.random() * REACTION_MS_JITTER;
      const reactionPx = reactionMs * (st.speed / FRAME_MS);
      if (dist > reactionPx) return;

      engine.jump();
      if (upcoming.tall) {
        pendingSecondJumpAt = st.elapsedMs + SECOND_JUMP_DELAY_MS + Math.random() * SECOND_JUMP_JITTER;
      }
    },
  };
}

module.exports = { createBot };
