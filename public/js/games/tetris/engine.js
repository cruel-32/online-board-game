/**
 * 테트리스 1인용 보드 시뮬레이션(순수 로직, DOM/캔버스 의존 없음).
 * - 네트워킹 없이도 완결된 싱글플레이 엔진으로 동작하며, 브라우저(클라이언트가 자기 보드를
 *   직접 시뮬레이션)와 Node(test/simulate.js의 헤드리스 유닛 테스트) 양쪽에서 동일하게 동작한다.
 * - 서버는 이 엔진을 다시 구현하지 않는다. 클라이언트가 "조각이 고정됨 + 지운 줄 수 + 보드 스냅샷"만
 *   이벤트로 보고하면, 서버는 그 값을 가지고 가비지 전송/탈락 판정만 심판한다(작은 자작 앱 규모에서는
 *   클라이언트를 신뢰하는 편이 서버에 물리 엔진을 통째로 복제하는 것보다 훨씬 단순하고 충분히 안전하다).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TetrisEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const core = (typeof module === 'object' && module.exports) ? require('../../../shared/tetris-core.js') : self.TetrisCore;
  const { COLS, ROWS, SHAPES, kicksFor, garbageForClear, createBagGenerator } = core;

  const LOCK_DELAY_MS = 500;
  const LOCK_RESET_CAP = 15;
  const NEXT_QUEUE_SIZE = 5;
  const BASE_GRAVITY_MS = 900;
  const MIN_GRAVITY_MS = 100;
  const LINES_PER_LEVEL = 10; // 이 줄 수만큼 지울 때마다 중력이 조금씩 빨라짐(전투 위주 모드라 완만하게)

  function emptyBoard() {
    const b = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) b[r] = new Array(COLS).fill(null);
    return b;
  }

  function cellsFor(type, rot, x, y) {
    return SHAPES[type][rot].map(([dx, dy]) => [x + dx, y + dy]);
  }

  function canPlace(board, type, rot, x, y) {
    for (const [cx, cy] of cellsFor(type, rot, x, y)) {
      if (cx < 0 || cx >= COLS || cy >= ROWS) return false;
      if (cy < 0) continue; // 보드 위쪽(스폰 영역)은 충돌 검사 제외
      if (board[cy][cx]) return false;
    }
    return true;
  }

  function createEngine(seed) {
    const nextType = createBagGenerator(seed);
    const queue = [];
    for (let i = 0; i < NEXT_QUEUE_SIZE; i++) queue.push(nextType());

    function pullNext() {
      const t = queue.shift();
      queue.push(nextType());
      return t;
    }

    const st = {
      board: emptyBoard(),
      cur: null,          // { type, rot, x, y }
      hold: null,
      canHold: true,
      queue,
      incomingGarbage: [], // [{ lines, holeCol }]
      dropAccum: 0,
      gravityMs: BASE_GRAVITY_MS,
      grounded: false,
      lockTimer: LOCK_DELAY_MS,
      lockResets: 0,
      topOut: false,
      linesClearedTotal: 0,
      garbageSentTotal: 0,
      garbageReceivedTotal: 0,
    };

    // canHold은 여기서 건드리지 않는다 — hold()가 스왑 후 다시 spawnPiece를 호출하므로,
    // 여기서 매번 true로 되돌리면 "고정되기 전 재홀드 금지" 규칙이 깨진다(canHold은 lockPiece에서만 리셋).
    function spawnPiece(type) {
      const rot = 0;
      const x = 3, y = 0;
      st.cur = { type, rot, x, y };
      st.grounded = false;
      st.lockTimer = LOCK_DELAY_MS;
      st.lockResets = 0;
      st.dropAccum = 0;
      if (!canPlace(st.board, type, rot, x, y)) {
        st.topOut = true;
      }
    }
    spawnPiece(pullNext());

    function updateGrounded() {
      const c = st.cur;
      st.grounded = c ? !canPlace(st.board, c.type, c.rot, c.x, c.y + 1) : false;
    }
    updateGrounded();

    function applyIncomingGarbage() {
      if (!st.incomingGarbage.length || st.topOut) return;
      for (const g of st.incomingGarbage) {
        for (let i = 0; i < g.lines; i++) {
          st.board.shift();
          const row = new Array(COLS).fill('G');
          row[g.holeCol] = null;
          st.board.push(row);
        }
      }
      st.garbageReceivedTotal += st.incomingGarbage.reduce((s, g) => s + g.lines, 0);
      st.incomingGarbage = [];
      // 쌓인 줄이 위쪽 스폰 영역까지 밀고 올라오면 탈락
      if (st.board[0].some((c) => c)) st.topOut = true;
    }

    function clearLines() {
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (st.board[r].every((c) => c)) {
          st.board.splice(r, 1);
          st.board.unshift(new Array(COLS).fill(null));
          cleared++;
          r++; // 같은 인덱스를 다시 검사(위에서 내려온 줄)
        }
      }
      return cleared;
    }

    function lockPiece() {
      const c = st.cur;
      for (const [cx, cy] of cellsFor(c.type, c.rot, c.x, c.y)) {
        if (cy >= 0) st.board[cy][cx] = c.type;
      }
      st.cur = null;
      const cleared = clearLines();
      st.linesClearedTotal += cleared;
      const garbageSent = garbageForClear(cleared);
      st.garbageSentTotal += garbageSent;

      applyIncomingGarbage();
      if (!st.topOut) {
        spawnPiece(pullNext());
        st.canHold = true; // 고정을 마쳤으니 다음 조각에서 다시 홀드 가능
        updateGrounded();
        // 레벨업(가벼운 가속) — 전투 모드라 완만하게만 적용
        const level = Math.floor(st.linesClearedTotal / LINES_PER_LEVEL);
        st.gravityMs = Math.max(MIN_GRAVITY_MS, BASE_GRAVITY_MS - level * 60);
      }
      return { locked: true, linesCleared: cleared, garbageSent, topOut: st.topOut };
    }

    function moveBy(dx, dy) {
      if (!st.cur || st.topOut) return false;
      const c = st.cur;
      if (!canPlace(st.board, c.type, c.rot, c.x + dx, c.y + dy)) return false;
      c.x += dx; c.y += dy;
      onSuccessfulMove();
      return true;
    }

    function onSuccessfulMove() {
      updateGrounded();
      if (st.grounded && st.lockResets < LOCK_RESET_CAP) {
        st.lockTimer = LOCK_DELAY_MS;
        st.lockResets++;
      }
    }

    function rotate(dir) {
      if (!st.cur || st.topOut) return false;
      const c = st.cur;
      const newRot = (c.rot + dir + 4) % 4;
      const key = `${c.rot}>${newRot}`;
      const kicks = kicksFor(c.type)[key] || [[0, 0]];
      for (const [dx, dy] of kicks) {
        if (canPlace(st.board, c.type, newRot, c.x + dx, c.y + dy)) {
          c.rot = newRot; c.x += dx; c.y += dy;
          onSuccessfulMove();
          return true;
        }
      }
      return false;
    }

    function hold() {
      if (!st.cur || !st.canHold || st.topOut) return false;
      const curType = st.cur.type;
      const swap = st.hold;
      st.hold = curType;
      st.canHold = false;
      spawnPiece(swap || pullNext());
      return true;
    }

    function ghostY() {
      if (!st.cur) return 0;
      const c = st.cur;
      let y = c.y;
      while (canPlace(st.board, c.type, c.rot, c.x, y + 1)) y++;
      return y;
    }

    return {
      moveLeft: () => moveBy(-1, 0),
      moveRight: () => moveBy(1, 0),
      softDrop: () => moveBy(0, 1),
      rotateCW: () => rotate(1),
      rotateCCW: () => rotate(-1),
      hold,
      ghostY,

      hardDrop() {
        if (!st.cur || st.topOut) return { locked: false };
        while (moveBy(0, 1)) { /* 바닥까지 즉시 낙하 */ }
        return lockPiece();
      },

      // dtMs 경과에 따른 중력/락딜레이 진행. 조각이 고정되면 이벤트를 반환.
      tick(dtMs) {
        if (!st.cur || st.topOut) return { locked: false };
        if (!st.grounded) {
          st.dropAccum += dtMs;
          while (st.dropAccum >= st.gravityMs) {
            st.dropAccum -= st.gravityMs;
            if (!moveBy(0, 1)) break; // moveBy가 grounded 갱신까지 처리
          }
          return { locked: false };
        }
        st.lockTimer -= dtMs;
        if (st.lockTimer <= 0) return lockPiece();
        return { locked: false };
      },

      // 상대의 공격으로 받은 가비지를 큐에 쌓는다(다음 고정 시점에 일괄 반영).
      queueGarbage(lines, holeCol) {
        if (lines > 0) st.incomingGarbage.push({ lines, holeCol });
      },

      getState() {
        return st;
      },
    };
  }

  return { createEngine, canPlace, cellsFor, emptyBoard, COLS, ROWS };
});
