/**
 * 테트리스 게임 클라이언트(플러그인) — 배틀로얄(가비지 공격, 최후 생존).
 * 키보드/터치 입력으로 로컬 엔진(TetrisEngine)을 직접 조작하고, 조각이 고정될 때만
 * 서버에 결과를 보고한다(매 프레임 네트워킹하지 않음 — 입력 반응은 항상 로컬 즉시 처리).
 * shell(게임 독립 셸)이 mount/unmount/setState/onRoundOver/renderSetup 를 호출한다.
 */
(function () {
  'use strict';
  const UI = window.TetrisUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function flattenBoard(board2d) {
    const flat = [];
    for (const row of board2d) for (const cell of row) flat.push(cell);
    return flat;
  }

  /* ---------- 키 바인딩: 액션당 KEY1/KEY2 두 개, localStorage에 저장 ---------- */
  const BINDINGS_KEY = 'tetris.keybinds';
  const ACTION_LABELS = [
    ['hardDrop', '하드드롭'],
    ['softDrop', '소프트드롭'],
    ['moveLeft', '좌로이동'],
    ['moveRight', '우로이동'],
    ['rotateCCW', '반시계회전'],
    ['rotateCW', '시계회전'],
    ['hold', '홀드'],
  ];
  const REPEATABLE = new Set(['moveLeft', 'moveRight', 'softDrop']);
  function defaultBindings() {
    return {
      hardDrop: { key1: 'ArrowUp', key2: 'w' },
      softDrop: { key1: 'ArrowDown', key2: 's' },
      moveLeft: { key1: 'ArrowLeft', key2: 'a' },
      moveRight: { key1: 'ArrowRight', key2: 'd' },
      rotateCCW: { key1: 'j', key2: 'z' },
      rotateCW: { key1: 'k', key2: 'x' },
      hold: { key1: 'l', key2: 'c' },
    };
  }
  function loadBindings() {
    const bindings = defaultBindings();
    try {
      const saved = JSON.parse(localStorage.getItem(BINDINGS_KEY) || 'null');
      if (saved) {
        for (const action of Object.keys(bindings)) {
          if (saved[action]) bindings[action] = { key1: saved[action].key1 || '', key2: saved[action].key2 || '' };
        }
      }
    } catch (_) { /* 무시 */ }
    return bindings;
  }
  const KEY_LABELS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space' };
  function keyLabel(key) {
    if (!key) return '—';
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    return key.length === 1 ? key.toUpperCase() : key;
  }

  const HUD_HTML = `
    <div class="hud-left">
      <div class="tet-dpad">
        <button id="tet-drop2" class="btn hud-btn tet-dpad-up">▲</button>
        <button id="tet-left" class="btn hud-btn tet-dpad-left">◀</button>
        <button id="tet-down" class="btn hud-btn tet-dpad-down">▼</button>
        <button id="tet-right" class="btn hud-btn tet-dpad-right">▶</button>
      </div>
    </div>
    <div class="hud-right">
      <div class="hud-secondary">
        ${window.Platform && window.Platform.isKeyboardPlatform() ? '<button id="tet-keybind" class="btn hud-btn">버튼설정</button>' : ''}
      </div>
      <div class="tet-rot-row">
        <button id="tet-rotL" class="btn hud-btn">⟲</button>
        <button id="tet-rotR" class="btn hud-btn">⟳</button>
        <button id="tet-hold" class="btn hud-btn">HOLD</button>
      </div>
    </div>`;

  const POPUPS_HTML = `
    <div id="tet-keybind-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>버튼 설정</h3><button class="popup-close" data-close="tet-keybind-popup">✕</button></header>
        <div id="tet-keybind-grid" class="tet-keybind-grid"></div>
        <p class="muted small-text">칸을 누른 뒤 원하는 키를 누르면 바인딩됩니다. 이미 사용 중인 키는 자동으로 해제됩니다.</p>
      </div>
    </div>
    <div id="tet-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="tet-result-title">게임 결과</h3></header>
        <div id="tet-result-body"></div>
        <div class="popup-actions">
          <button id="tet-result-ready" class="btn gold">다시 게임 준비</button>
          <button id="tet-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const REPEAT_DAS_MS = 150;
  const REPEAT_ARR_MS = 45;
  const SOFT_DROP_MS = 40;

  const Tetris = {
    id: 'tetris',
    name: '테트리스',
    ctx: null,
    state: null,
    lastSeed: null,
    hudSlot: null,
    injected: [],
    repeats: {}, // actionName -> { das, arr }
    keyHandlerDown: null,
    keyHandlerUp: null,
    bindings: null,
    keyToAction: {},
    rebindListener: null,

    renderSetup(container) {
      container.innerHTML = `<p class="muted small-text">테트리스는 2~4인 · 실시간 배틀로얄(가비지 공격, 최후 생존) · 봇은 지원하지 않습니다.</p>`;
    },

    mount({ canvas, hudSlot, ctx }) {
      this.ctx = ctx;
      this.hudSlot = hudSlot;
      hudSlot.innerHTML = HUD_HTML;
      const screen = document.getElementById('screen-game');
      const holder = document.createElement('div');
      holder.innerHTML = POPUPS_HTML;
      this.injected = Array.from(holder.children);
      this.injected.forEach((el) => screen.appendChild(el));

      this.bindings = loadBindings();
      UI.init(canvas, { onLock: (ev) => this._onLock(ev) });
      this._wire();
      this._rebuildKeyTables();
    },

    unmount() {
      this._clearAllRepeats();
      this._cancelRebind();
      if (this.keyHandlerDown) window.removeEventListener('keydown', this.keyHandlerDown);
      if (this.keyHandlerUp) window.removeEventListener('keyup', this.keyHandlerUp);
      this.keyHandlerDown = null; this.keyHandlerUp = null;
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      UI.engine = null; UI.opponents = []; UI.finished = false;
      UI.paused = false; UI.countdownStart = null; UI._lastCountdownLabel = null;
      this.state = null; this.lastSeed = null;
    },

    topBarText(state) { return `${state.roomName} · 테트리스`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      if (state.seed !== this.lastSeed) {
        this.lastSeed = state.seed;
        UI.startLocal(state.seed);
      }
      const newGarbage = state.incomingGarbage || [];
      for (const g of newGarbage) {
        if (UI.engine) UI.engine.queueGarbage(g.lines, g.holeCol);
      }
      if (newGarbage.length && window.Sound) window.Sound.garbageWarning();
      UI.setOpponents((state.players || []).filter((p) => p.id !== state.you));
      UI.setMeta({ finished: state.finished, winnerName: state.winnerName });
      if (state.finished && !(prev && prev.finished) && window.Sound) {
        const me = (state.players || []).find((p) => p.id === state.you);
        if (me && me.alive) window.Sound.victory();
      }
    },

    bubbleAnchor() { return null; }, // 테트리스는 좌석 배치가 없어 말풍선 앵커를 지원하지 않음

    _onLock(ev) {
      if (!UI.engine) return;
      const st = UI.engine.getState();
      this.ctx.send({
        type: 'game_action',
        action: {
          kind: 'lock',
          linesCleared: ev.linesCleared,
          garbageSent: ev.garbageSent,
          topOut: ev.topOut,
          board: flattenBoard(st.board),
          holdType: st.hold,
          nextTypes: st.queue.slice(0, 5),
        },
      });
      if (window.Sound) {
        if (ev.topOut) window.Sound.eliminated();
        else if (ev.linesCleared >= 4) window.Sound.slam();
        else if (ev.linesCleared > 0) window.Sound.play();
      }
    },

    /* ---------- 입력: 키보드(재배정 가능) + 터치 버튼(길게 누르면 DAS/ARR 반복) ---------- */
    // 카운트다운(paused) 중이거나 버튼 설정 팝업이 열려 있을 때는 게임 입력을 막는다.
    _canAct() {
      return UI.engine && !UI.myTopOut && !UI.finished && !UI.paused &&
        !(window.Modal && window.Modal.isOpen('tet-keybind-popup'));
    },

    _stopRepeat(action) {
      const e = this.repeats[action];
      if (!e) return;
      clearTimeout(e.das); clearInterval(e.arr);
      delete this.repeats[action];
    },
    _clearAllRepeats() {
      for (const action of Object.keys(this.repeats)) this._stopRepeat(action);
    },

    _wire() {
      const act = (fn) => () => { if (this._canAct()) fn(); };

      this._actions = {
        moveLeft: act(() => { if (UI.engine.moveLeft() && window.Sound) window.Sound.select(); }),
        moveRight: act(() => { if (UI.engine.moveRight() && window.Sound) window.Sound.select(); }),
        softDrop: act(() => UI.engine.softDrop()),
        rotateCW: act(() => { if (UI.engine.rotateCW() && window.Sound) window.Sound.select(); }),
        rotateCCW: act(() => { if (UI.engine.rotateCCW() && window.Sound) window.Sound.select(); }),
        hold: act(() => { if (UI.engine.hold() && window.Sound) window.Sound.select(); }),
        hardDrop: act(() => {
          const ev = UI.engine.hardDrop();
          // UI._reportLock이 myTopOut 갱신 + onLock 콜백(네트워킹) 호출을 함께 처리한다.
          // (중력에 의한 자연 고정도 같은 경로로 처리되므로, 하드드롭도 반드시 이 경로를 타야
          //  UI.myTopOut이 정확히 갱신된다.)
          if (ev.locked) UI._reportLock(ev);
        }),
      };
      const { moveLeft, moveRight, softDrop, rotateCW, rotateCCW, hold, hardDrop } = this._actions;

      // 터치 버튼: 이동/소프트드롭은 눌러서 반복, 회전/홀드/하드드롭은 1회성.
      // (터치 버튼은 키 재배정과 무관하게 항상 고정되어 있다)
      const touchRepeat = (id, action, fn, ms) => {
        const el = $(id);
        const start = (e) => { e.preventDefault(); this._startRepeatCustom(action, fn, ms); };
        const stop = () => this._stopRepeat(action);
        el.addEventListener('pointerdown', start);
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointerleave', stop);
        el.addEventListener('pointercancel', stop);
      };
      touchRepeat('tet-left', 'moveLeft', moveLeft, REPEAT_ARR_MS);
      touchRepeat('tet-right', 'moveRight', moveRight, REPEAT_ARR_MS);
      touchRepeat('tet-down', 'softDrop', softDrop, SOFT_DROP_MS);
      $('tet-rotL').addEventListener('click', rotateCCW);
      $('tet-rotR').addEventListener('click', rotateCW);
      $('tet-drop2').addEventListener('click', hardDrop); // 방향키 배열의 ↑ 자리 — W와 동일하게 하드드롭
      $('tet-hold').addEventListener('click', hold);
      if ($('tet-keybind')) $('tet-keybind').addEventListener('click', () => {
        this.renderKeybindGrid();
        window.Modal.open('tet-keybind-popup');
      });

      $('tet-result-ready').addEventListener('click', () => {
        this.ctx.send({ type: 'ready', ready: true });
        $('tet-result-ready').textContent = '다른 플레이어 대기 중…';
        $('tet-result-ready').disabled = true;
        setTimeout(() => { const b = $('tet-result-ready'); if (b) b.disabled = false; }, 1500);
      });
      $('tet-result-room').addEventListener('click', () => {
        window.Modal.close('tet-result-popup');
        this.ctx.showScreen('room');
      });

      // 키보드: 어떤 키가 어떤 액션인지는 this.keyToAction(재배정 가능)을 그때그때 조회한다.
      this.keyHandlerDown = (e) => {
        if (e.repeat) return;
        const action = this.keyToAction[e.key];
        if (!action) return;
        e.preventDefault();
        const fn = this._actions[action];
        if (REPEATABLE.has(action)) {
          this._startRepeatCustom(action, fn, action === 'softDrop' ? SOFT_DROP_MS : REPEAT_ARR_MS);
        } else {
          fn();
        }
      };
      this.keyHandlerUp = (e) => {
        const action = this.keyToAction[e.key];
        if (action && REPEATABLE.has(action)) this._stopRepeat(action);
      };
      window.addEventListener('keydown', this.keyHandlerDown);
      window.addEventListener('keyup', this.keyHandlerUp);
    },

    // ARR 간격을 액션마다 다르게(소프트드롭은 더 빠르게) 쓰기 위한 변형판
    _startRepeatCustom(action, fn, arrMs) {
      if (this.repeats[action]) return;
      fn();
      const entry = { das: null, arr: null };
      entry.das = setTimeout(() => { entry.arr = setInterval(fn, arrMs); }, REPEAT_DAS_MS);
      this.repeats[action] = entry;
    },

    /* ---------- 버튼 설정(키 바인딩) 팝업 ---------- */
    _rebuildKeyTables() {
      this.keyToAction = {};
      for (const [action, b] of Object.entries(this.bindings)) {
        if (b.key1) this.keyToAction[b.key1] = action;
        if (b.key2) this.keyToAction[b.key2] = action;
      }
    },
    _saveBindings() {
      try { localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings)); } catch (_) { /* 무시 */ }
    },

    // 팝업을 열 때(또는 바인딩이 실제로 바뀐 뒤) 그리드를 통째로 새로 그린다.
    // 대기 중이던 칸이 있었다면 먼저 정리한다(리스너만 해제 — 전체 재렌더는 이 함수가 어차피 할 것이므로).
    renderKeybindGrid() {
      if (this.rebindListener) { window.removeEventListener('keydown', this.rebindListener, true); this.rebindListener = null; }
      this.waitingBtn = null;
      const grid = $('tet-keybind-grid');
      if (!grid) return;
      const head = `<div class="tet-kb-row tet-kb-head"><div></div><div>KEY1</div><div>KEY2</div></div>`;
      const rows = ACTION_LABELS.map(([action, label]) => {
        const b = this.bindings[action];
        return `<div class="tet-kb-row">
          <div class="tet-kb-label">${esc(label)}</div>
          <button type="button" class="tet-kb-cell" data-action="${action}" data-slot="key1">${esc(keyLabel(b.key1))}</button>
          <button type="button" class="tet-kb-cell" data-action="${action}" data-slot="key2">${esc(keyLabel(b.key2))}</button>
        </div>`;
      }).join('');
      grid.innerHTML = head + rows;
      grid.querySelectorAll('.tet-kb-cell').forEach((btn) => {
        btn.addEventListener('click', () => this._startRebind(btn));
      });
    },

    // 칸 하나를 "키를 누르세요" 대기 상태로 바꾼다. 그리드를 통째로 다시 그리지 않고
    // 그 칸의 DOM만 직접 바꿔서, 클릭한 바로 그 버튼이 계속 화면에 남아 있게 한다.
    _startRebind(btn) {
      if (this.rebindListener) {
        window.removeEventListener('keydown', this.rebindListener, true);
        this.rebindListener = null;
        if (this.waitingBtn) this._restoreCellLabel(this.waitingBtn); // 이전에 대기 중이던 칸은 원래 표시로 되돌림
      }
      this.waitingBtn = btn;
      btn.classList.add('waiting');
      btn.textContent = '키를 누르세요…';
      const onKey = (e) => {
        // 팝업이 그 사이 닫혔다면(배경 클릭 등) 안전하게 리스너만 정리하고 무시한다.
        if (!window.Modal.isOpen('tet-keybind-popup')) { this._cancelRebind(); return; }
        e.preventDefault();
        e.stopImmediatePropagation(); // 이 키 입력이 게임 조작으로 새어나가지 않게 한다
        if (e.key === 'Escape') { this._cancelRebind(); return; }
        this._applyBinding(btn.dataset.action, btn.dataset.slot, e.key);
        this._cancelRebind();
      };
      this.rebindListener = onKey;
      window.addEventListener('keydown', onKey, true); // capture 단계에서 가로챈다
    },
    _restoreCellLabel(btn) {
      btn.classList.remove('waiting');
      btn.textContent = keyLabel(this.bindings[btn.dataset.action][btn.dataset.slot]);
    },
    // 대기를 취소하고, 바인딩이 바뀌었을 수 있으니 그리드를 최신 상태로 다시 그린다.
    _cancelRebind() {
      if (!this.rebindListener) return;
      window.removeEventListener('keydown', this.rebindListener, true);
      this.rebindListener = null;
      this.renderKeybindGrid();
    },
    _applyBinding(action, slot, key) {
      // 이미 다른 곳(다른 액션의 어느 칸이든)에 같은 키가 있다면 그 칸을 비운다(중복 금지).
      for (const b of Object.values(this.bindings)) {
        if (b.key1 === key) b.key1 = '';
        if (b.key2 === key) b.key2 = '';
      }
      this.bindings[action][slot] = key;
      this._saveBindings();
      this._rebuildKeyTables();
    },

    /* ---------- 결과 팝업 ---------- */
    onRoundOver(result) {
      $('tet-result-title').textContent = '🏁 게임 결과';
      const rows = (result.rows || []).map((r) => `<tr class="r${r.rank}"><td>${r.rank}등</td><td>${esc(r.name)}</td>
        <td>${r.linesCleared}</td><td>${r.garbageSent}</td><td>${r.garbageReceived}</td></tr>`).join('');
      $('tet-result-body').innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>지운 줄</th><th>보낸 공격</th><th>받은 공격</th></tr>${rows}</table>
        <div class="result-champion">🏆 우승: ${esc(result.winnerName || '')}</div>`;
      $('tet-result-ready').disabled = false;
      $('tet-result-room').style.display = 'none';
      window.Modal.open('tet-result-popup');
    },

    closeResult() { window.Modal.close('tet-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('tet-result-popup'); },
  };

  window.Games.register(Tetris);
})();
