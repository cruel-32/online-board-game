'use strict';
/**
 * 테트리스 봇 AI — 조각마다 가능한 모든 회전×가로위치 배치를 시뮬레이션해
 * 고전적인 휴리스틱(높이/구멍/굴곡/클리어 줄수)으로 최적의 배치를 고른다.
 * 실제 이동 경로(회전 킥, 장애물 통과)는 무시하는 단순화된 탐색이지만,
 * 자체 호스팅 캐주얼 앱에서 "적당히 잘 두는 상대"로는 충분하다.
 *
 * 순수 함수로만 구성되어 서버(game.js의 botEngines)에서 클라이언트와 동일한
 * public/js/games/tetris/engine.js 인스턴스에 그대로 적용한다(엔진 재구현 없음).
 */
const Engine = require('../../../../public/js/games/tetris/engine.js');
const core = require('../../../../public/shared/tetris-core.js');
const { COLS, ROWS } = core;

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// type/rot 모양이 x에서 더 이상 못 내려갈 때까지 떨어진 y(스폰조차 불가능하면 null).
function dropY(board, type, rot, x) {
  if (!Engine.canPlace(board, type, rot, x, 0)) return null;
  let y = 0;
  while (Engine.canPlace(board, type, rot, x, y + 1)) y++;
  return y;
}

function placeAndClear(board, type, rot, x, y) {
  const b = cloneBoard(board);
  for (const [cx, cy] of Engine.cellsFor(type, rot, x, y)) {
    if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) b[cy][cx] = type;
  }
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (b[r].every((c) => c)) {
      b.splice(r, 1);
      b.unshift(new Array(COLS).fill(null));
      cleared++;
      r++; // 위에서 내려온 같은 인덱스를 다시 검사
    }
  }
  return { board: b, cleared };
}

function evaluateBoard(board) {
  const heights = new Array(COLS).fill(0);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let seenBlock = false;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c]) {
        if (!seenBlock) { heights[c] = ROWS - r; seenBlock = true; }
      } else if (seenBlock) {
        holes++;
      }
    }
  }
  const aggHeight = heights.reduce((s, h) => s + h, 0);
  let bumpiness = 0;
  for (let c = 0; c < COLS - 1; c++) bumpiness += Math.abs(heights[c] - heights[c + 1]);
  return { aggHeight, holes, bumpiness };
}

// 고전적인 Pierre Dellacherie류 근사 가중치: 높이·구멍·굴곡은 감점, 클리어는 가점.
function scoreOf(metrics, cleared) {
  return -0.510066 * metrics.aggHeight + 0.760666 * cleared - 0.35663 * metrics.holes - 0.184483 * metrics.bumpiness;
}

/** 현재 보드/조각에서 최선의 배치({rot,x,score})를 고른다. 둘 곳이 전혀 없으면 null. */
function chooseBotMove(board, type) {
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLS + 2; x++) {
      const y = dropY(board, type, rot, x);
      if (y == null) continue;
      const { board: placed, cleared } = placeAndClear(board, type, rot, x, y);
      const metrics = evaluateBoard(placed);
      const score = scoreOf(metrics, cleared);
      if (!best || score > best.score) best = { rot, x, score };
    }
  }
  return best;
}

/** 선택된 배치를 실제 엔진 인스턴스에 회전/이동/하드드롭으로 실행해 lock 이벤트를 얻는다. */
function executeMove(engine, plan) {
  let st = engine.getState();
  let guard = 0;
  while (st.cur && st.cur.rot !== plan.rot && guard++ < 4) {
    engine.rotateCW();
    st = engine.getState();
  }
  guard = 0;
  while (st.cur && st.cur.x < plan.x && guard++ < COLS + 4) {
    if (!engine.moveRight()) break;
    st = engine.getState();
  }
  guard = 0;
  while (st.cur && st.cur.x > plan.x && guard++ < COLS + 4) {
    if (!engine.moveLeft()) break;
    st = engine.getState();
  }
  return engine.hardDrop();
}

/** 봇 한 수(조각 하나)를 통째로 진행: 최선의 배치를 찾아 실행하고 lock 이벤트를 반환. */
function playOneMove(engine) {
  const st = engine.getState();
  if (!st.cur || st.topOut) return { locked: false };
  const plan = chooseBotMove(st.board, st.cur.type);
  if (!plan) return engine.hardDrop(); // 둘 곳이 없으면(탑아웃 임박) 그냥 즉시 내려 topOut 처리를 앞당김
  return executeMove(engine, plan);
}

module.exports = { chooseBotMove, executeMove, playOneMove, evaluateBoard, scoreOf };
