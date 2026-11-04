/**
 * 러너(점프 러너) 룰 엔진(공용 데이터) — 서버(Node)와 브라우저에서 공용으로 사용.
 *
 * Chrome Dino(T-Rex Runner)의 실제 공개 상수(GRAVITY=0.6, INITIAL_JUMP_VELOCITY=10,
 * SPEED 6→13, ACCELERATION=0.001, 전부 "60fps 가상 프레임" 단위)를 그대로 가져와
 * 중력/점프/가속 "감각"을 그 게임과 동일하게 재현한다. 다른 점은:
 * - 2단 점프(공중에서 한 번 더 점프 가능, 첫 점프 정점 근처에서 누르면 최대 높이)
 * - 장애물은 전부 "박스"이며, 일부(tall)는 1단 점프 최대 높이로는 넘을 수 없고
 *   2단 점프로만 넘을 수 있게 설계해 2단 점프를 실제로 써야 하는 상황을 만든다.
 *
 * 좌표계: 논리 해상도 WORLD_W x WORLD_H(렌더러가 화면 크기에 맞게 통째로 스케일).
 * 플레이어는 화면상 x가 고정(PLAYER_X)이고 장애물이 왼쪽으로 흘러온다(원작과 동일한 모델).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunnerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 논리 좌표계 ---------- */
  const WORLD_W = 600;
  const WORLD_H = 150;
  const GROUND_Y = 140; // 바닥 선(원작의 BOTTOM_PAD=10과 동일한 비율)

  const PLAYER_X = 50;
  const PLAYER_W = 44;
  const PLAYER_H = 47;
  const HITBOX_INSET = 6; // 판정을 살짝 봐준다(원작도 스프라이트보다 작은 충돌 박스를 씀)

  /* ---------- 물리(원작 수치 그대로, "60fps 가상 프레임" 단위) ---------- */
  const FRAME_MS = 1000 / 60;
  const GRAVITY = 0.6;          // px/frame^2
  const JUMP_SPEED = 10;        // px/frame (위 방향, 양수로 둠)
  const START_SPEED = 6;        // px/frame
  const MAX_SPEED = 13;         // px/frame
  const ACCELERATION = 0.001;   // px/frame, 프레임마다 가속(개인 성과 무관 — 경과 시간에만 비례)

  // 1단/2단 점프로 도달 가능한 최대 높이(파생값) — v^2/(2g). 타워형 장애물 높이를 여기 맞춰 정한다.
  const SINGLE_JUMP_MAX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY); // ≈ 83.3
  const DOUBLE_JUMP_MAX_HEIGHT = SINGLE_JUMP_MAX_HEIGHT * 2;                // ≈ 166.7(정점에서 다시 눌렀을 때)

  /* ---------- 장애물 치수 ---------- */
  const OBSTACLE_WIDTH_SINGLE = 18;
  const OBSTACLE_WIDTH_WIDE = 34;
  const HEIGHT_LOW = 32;
  const HEIGHT_MED = 50;
  const HEIGHT_HIGH = 68;
  // 1단 점프 최대 높이(≈83)로는 못 넘고, 2단 점프 최대 높이(≈167)로는 여유 있게 넘는 높이.
  const TOWER_WIDTH = 24;
  const TOWER_HEIGHT = 115;

  const INITIAL_SPAWN_DELAY_PX = 420; // 시작 직후 잠깐의 유예(원작의 인트로 구간과 동일한 역할)
  // 클라이언트의 3·2·1·GO 카운트다운 길이 — 서버가 "생존 시간"을 벽시계로 추정해야 할 때
  // (봇이 아닌, 끝까지 살아남은 사람의 최종 기록 등) 이 유예 시간만큼 빼서 사람/봇의 자체 보고
  // 시간(둘 다 카운트다운이 끝난 시점을 0으로 삼음)과 기준을 맞춘다.
  const COUNTDOWN_MS = 3400;
  const MIN_GAP_MS = 550;   // 장애물 "앞쪽 간격"의 최소/최대(시간 기준 — 속도가 빨라져도 반응시간은 비슷하게 유지됨)
  const MAX_GAP_MS = 1150;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- 시드 난수(테트리스와 동일한 mulberry32) ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  // 현재 속도 기준 난이도(0~1) — 장애물 종류 가중치에 사용(시간이 지날수록 어려운 장애물 비중 증가).
  function difficultyOf(speed) {
    return clamp((speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0, 1);
  }

  /** 다음 장애물 하나를 결정론적으로 뽑는다(시드 기반 rand 함수를 소비). */
  function pickObstacle(rand, speed) {
    const d = difficultyOf(speed);
    const towerChance = 0.06 + 0.12 * d;
    if (rand() < towerChance) {
      return { w: TOWER_WIDTH, h: TOWER_HEIGHT, tall: true };
    }
    const wide = rand() < 0.3;
    const heightRoll = rand();
    let h;
    if (heightRoll < 0.42 - 0.15 * d) h = HEIGHT_LOW;
    else if (heightRoll < 0.82) h = HEIGHT_MED;
    else h = HEIGHT_HIGH;
    return { w: wide ? OBSTACLE_WIDTH_WIDE : OBSTACLE_WIDTH_SINGLE, h, tall: false };
  }

  /** 장애물 "앞쪽 간격"(px) — 시간 기준 간격에 현재 속도를 곱해 속도가 빨라져도 반응시간이 비슷하게 유지됨. */
  function gapFor(rand, speed) {
    const gapMs = MIN_GAP_MS + rand() * (MAX_GAP_MS - MIN_GAP_MS);
    return gapMs * (speed / FRAME_MS);
  }

  // 경과 프레임 수 기준 속도(개인 성과와 무관, 매치 경과 시간에만 비례 — 테트리스의 gravityForElapsed와 같은 철학).
  function speedForFrames(frames) {
    return Math.min(MAX_SPEED, START_SPEED + ACCELERATION * frames);
  }

  return {
    WORLD_W, WORLD_H, GROUND_Y,
    PLAYER_X, PLAYER_W, PLAYER_H, HITBOX_INSET,
    FRAME_MS, GRAVITY, JUMP_SPEED, START_SPEED, MAX_SPEED, ACCELERATION,
    SINGLE_JUMP_MAX_HEIGHT, DOUBLE_JUMP_MAX_HEIGHT,
    OBSTACLE_WIDTH_SINGLE, OBSTACLE_WIDTH_WIDE, HEIGHT_LOW, HEIGHT_MED, HEIGHT_HIGH,
    TOWER_WIDTH, TOWER_HEIGHT, INITIAL_SPAWN_DELAY_PX, COUNTDOWN_MS,
    mulberry32, randomSeed, difficultyOf, pickObstacle, gapFor, speedForFrames,
  };
});
