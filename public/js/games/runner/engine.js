/**
 * 러너 1인용 러닝 시뮬레이션(순수 로직, DOM/캔버스 의존 없음).
 * - 테트리스(public/js/games/tetris/engine.js)와 같은 역할: 네트워킹 없이도 완결된 싱글플레이
 *   엔진으로 동작하며, 브라우저(클라이언트가 자기 캐릭터를 직접 시뮬레이션)와 Node(서버의 봇,
 *   test/simulate.js의 헤드리스 유닛 테스트) 양쪽에서 동일하게 동작한다.
 * - 서버는 사람 플레이어에 대해 이 엔진을 다시 돌리지 않는다. 클라이언트가 "충돌(죽음) + 버틴
 *   시간"만 1회 이벤트로 보고하면 서버는 그 값을 신뢰해 순위를 심판한다(테트리스와 동일한 신뢰 모델).
 *   다만 봇은 서버가 직접 이 엔진 인스턴스를 들고 매 틱 진행시킨다(엔진 재구현 없음).
 *
 * 내부 시뮬레이션은 원작 Chrome Dino와 동일하게 "60fps 가상 프레임" 단위로 양자화해 진행한다
 * (dtMs를 FRAME_MS 단위로 누적 소비) — 실제 화면 주사율과 무관하게 항상 같은 물리 감각을 낸다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunnerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const core = (typeof module === 'object' && module.exports) ? require('../../../shared/runner-core.js') : self.RunnerCore;
  const {
    WORLD_W, GROUND_Y, PLAYER_X, PLAYER_W, PLAYER_H, HITBOX_INSET,
    FRAME_MS, GRAVITY, JUMP_SPEED, INITIAL_SPAWN_DELAY_PX,
    mulberry32, pickObstacle, gapFor, speedForFrames,
  } = core;

  function createEngine(seed) {
    const rand = mulberry32(seed);

    const st = {
      frame: 0,
      elapsedMs: 0,
      frameAccum: 0,
      speed: speedForFrames(0),
      vy: 0,           // 위 방향 속도(양수=상승)
      airHeight: 0,     // 바닥 기준 높이(0=바닥)
      grounded: true,
      jumpsUsed: 0,
      obstacles: [],    // [{x, w, h, tall}] — x는 WORLD 좌표계(오른쪽에서 생성되어 왼쪽으로 흐름)
      spawnCountdown: INITIAL_SPAWN_DELAY_PX,
      dead: false,
    };

    function playerBox() {
      const top = GROUND_Y - PLAYER_H - st.airHeight + HITBOX_INSET;
      const bottom = GROUND_Y - st.airHeight - HITBOX_INSET;
      return { left: PLAYER_X + HITBOX_INSET, right: PLAYER_X + PLAYER_W - HITBOX_INSET, top, bottom };
    }
    function obstacleBox(o) {
      return {
        left: o.x + HITBOX_INSET, right: o.x + o.w - HITBOX_INSET,
        top: GROUND_Y - o.h, bottom: GROUND_Y,
      };
    }
    function boxesOverlap(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    function stepFrame() {
      if (st.dead) return;
      st.frame++;
      st.elapsedMs += FRAME_MS;
      st.speed = speedForFrames(st.frame);

      // 중력/점프
      if (!st.grounded) {
        st.vy -= GRAVITY;
        st.airHeight += st.vy;
        if (st.airHeight <= 0) {
          st.airHeight = 0;
          st.vy = 0;
          st.grounded = true;
          st.jumpsUsed = 0;
        }
      }

      // 장애물 이동 + 생성
      for (const o of st.obstacles) o.x -= st.speed;
      while (st.obstacles.length && st.obstacles[0].x + st.obstacles[0].w < 0) st.obstacles.shift();

      st.spawnCountdown -= st.speed;
      if (st.spawnCountdown <= 0) {
        const ob = pickObstacle(rand, st.speed);
        st.obstacles.push({ x: WORLD_W, w: ob.w, h: ob.h, tall: ob.tall });
        st.spawnCountdown = ob.w + gapFor(rand, st.speed);
      }

      // 충돌 판정
      const pBox = playerBox();
      for (const o of st.obstacles) {
        if (boxesOverlap(pBox, obstacleBox(o))) { st.dead = true; break; }
      }
    }

    return {
      jump() {
        if (st.dead || st.jumpsUsed >= 2) return false;
        st.vy = JUMP_SPEED;
        st.grounded = false;
        st.jumpsUsed += 1;
        return true;
      },

      // dtMs 경과만큼 가상 프레임 단위로 진행. 이번 호출에서 새로 죽었으면 { dead: true }.
      tick(dtMs) {
        const wasDead = st.dead;
        st.frameAccum += dtMs;
        while (st.frameAccum >= FRAME_MS && !st.dead) {
          st.frameAccum -= FRAME_MS;
          stepFrame();
        }
        return { dead: st.dead && !wasDead, elapsedMs: st.elapsedMs };
      },

      getState() { return st; },
    };
  }

  return { createEngine, SINGLE_JUMP_MAX_HEIGHT: core.SINGLE_JUMP_MAX_HEIGHT, DOUBLE_JUMP_MAX_HEIGHT: core.DOUBLE_JUMP_MAX_HEIGHT };
});
