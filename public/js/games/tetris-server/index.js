/**
 * 테트리스(서버권위) 게임 클라이언트(플러그인) — public/js/games/tetris/index.js의 쌍둥이.
 * 로컬 엔진을 전혀 갖지 않는다: 키 입력을 즉시 game_action으로 서버에 보내고, 서버가 브로드캐스트한
 * 상태(내 보드·조각 위치 포함)를 그대로 받아 그릴 뿐이다 — 이 차이가 두 아키텍처 비교의 핵심이다.
 * HUD/키 바인딩 구조는 tetris와 동일한 id·CSS 클래스를 그대로 재사용한다(두 게임은 동시에 마운트되지
 * 않으므로 충돌 없음). localStorage 키 바인딩도 같은 키를 공유해 두 게임의 조작감을 통일한다.
 */
(function () {
  'use strict';
  const UI = window.TetrisServerUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------- 키 바인딩: tetris와 동일한 저장소 키를 공유(같은 조작감 유지) ---------- */
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
    <div class="hud-left tet-hud-left">
      <div class="tet-dpad">
        <button id="tet-drop2" class="btn hud-btn tet-dpad-up">▲</button>
        <button id="tet-left" class="btn hud-btn tet-dpad-left">◀</button>
        <button id="tet-down" class="btn hud-btn tet-dpad-down">▼</button>
        <button id="tet-right" class="btn hud-btn tet-dpad-right">▶</button>
      </div>
    </div>
    <div class="hud-right tet-hud-right">
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

  const TetrisServer = {
    id: 'tetris-server',
    name: '테트리스',
    ctx: null,
    state: null,
    lastRoundNo: null,
    hudSlot: null,
    injected: [],
    repeats: {},
    keyHandlerDown: null,
    keyHandlerUp: null,
    bindings: null,
    keyToAction: {},
    rebindListener: null,

    renderSetup(container) {
      container.innerHTML = `<p class="muted small-text">테트리스는 2~4인 · 실시간 배틀로얄(가비지 공격, 최후 생존) · 봇 추가 가능.</p>`;
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

      canvas.classList.add('tetris-viewport');

      this.bindings = loadBindings();
      UI.init(canvas, {});
      this._wire();
      this._rebuildKeyTables();
    },

    unmount() {
      this._clearAllRepeats();
      this._cancelRebind();
      if (this.keyHandlerDown) window.removeEventListener('keydown', this.keyHandlerDown);
      if (this.keyHandlerUp) window.removeEventListener('keyup', this.keyHandlerUp);
      this.keyHandlerDown = null; this.keyHandlerUp = null;
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.classList.remove('tetris-viewport');
        canvas.style.width = ''; canvas.style.height = '';
        canvas.style.left = ''; canvas.style.top = '';
      }
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      UI.myState = null; UI.opponents = []; UI.finished = false; UI.started = false;
      UI.paused = false; UI.countdownStart = null; UI._lastCountdownLabel = null;
      this.state = null; this.lastRoundNo = null;
    },

    topBarText(state) { return `${state.roomName} · 테트리스`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      if (state.roundNo !== this.lastRoundNo) {
        this.lastRoundNo = state.roundNo;
        UI.startCountdown();
      }
      const me = (state.players || []).find((p) => p.id === state.you) || null;
      UI.setMyState(me);
      UI.setOpponents((state.players || []).filter((p) => p.id !== state.you));
      UI.setMeta({ finished: state.finished, winnerName: state.winnerName });

      // 서버가 이미 판정을 끝낸 뒤 "알림"만 보내주는 큐 — 배너/사운드 연출만 여기서 재생한다.
      const incoming = state.incomingAttacks || [];
      if (incoming.length) {
        const totalLines = incoming.reduce((s, a) => s + a.lines, 0);
        const fromName = incoming[incoming.length - 1].fromName || '상대';
        UI.notifyAttackReceived(totalLines, fromName);
      }
      for (const ev of (state.selfEvents || [])) UI.reportSelfEvent(ev);

      if (state.finished && !(prev && prev.finished) && window.Sound) {
        if (me && me.alive) window.Sound.victory();
      }
    },

    bubbleAnchor() { return null; },

    /* ---------- 입력: 로컬 엔진 없이 즉시 서버로 전송(사운드는 낙관적으로 즉시 재생) ---------- */
    _canAct() {
      return UI.myState && UI.myState.alive !== false && !UI.finished && !UI.paused &&
        !(window.Modal && window.Modal.isOpen('tet-keybind-popup'));
    },

    _send(kind) { this.ctx.send({ type: 'game_action', action: { kind } }); },

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

      // 서버 응답을 기다리지 않고 입력 즉시 사운드를 낙관적으로 재생한다(실제 이동 성공 여부는
      // 다음 서버 브로드캐스트로만 확인 가능 — 이 지연 자체가 이 아키텍처의 특징이다).
      this._actions = {
        moveLeft: act(() => { this._send('moveLeft'); if (window.Sound) window.Sound.select(); }),
        moveRight: act(() => { this._send('moveRight'); if (window.Sound) window.Sound.select(); }),
        softDrop: act(() => this._send('softDrop')),
        rotateCW: act(() => { this._send('rotateCW'); if (window.Sound) window.Sound.select(); }),
        rotateCCW: act(() => { this._send('rotateCCW'); if (window.Sound) window.Sound.select(); }),
        hold: act(() => { this._send('hold'); if (window.Sound) window.Sound.select(); }),
        hardDrop: act(() => this._send('hardDrop')),
      };
      const { moveLeft, moveRight, softDrop, rotateCW, rotateCCW, hold, hardDrop } = this._actions;

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
      $('tet-drop2').addEventListener('click', hardDrop);
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

    _startRepeatCustom(action, fn, arrMs) {
      if (this.repeats[action]) return;
      fn();
      const entry = { das: null, arr: null };
      entry.das = setTimeout(() => { entry.arr = setInterval(fn, arrMs); }, REPEAT_DAS_MS);
      this.repeats[action] = entry;
    },

    /* ---------- 버튼 설정(키 바인딩) 팝업 — tetris/index.js와 동일 ---------- */
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

    _startRebind(btn) {
      if (this.rebindListener) {
        window.removeEventListener('keydown', this.rebindListener, true);
        this.rebindListener = null;
        if (this.waitingBtn) this._restoreCellLabel(this.waitingBtn);
      }
      this.waitingBtn = btn;
      btn.classList.add('waiting');
      btn.textContent = '키를 누르세요…';
      const onKey = (e) => {
        if (!window.Modal.isOpen('tet-keybind-popup')) { this._cancelRebind(); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { this._cancelRebind(); return; }
        this._applyBinding(btn.dataset.action, btn.dataset.slot, e.key);
        this._cancelRebind();
      };
      this.rebindListener = onKey;
      window.addEventListener('keydown', onKey, true);
    },
    _restoreCellLabel(btn) {
      btn.classList.remove('waiting');
      btn.textContent = keyLabel(this.bindings[btn.dataset.action][btn.dataset.slot]);
    },
    _cancelRebind() {
      if (!this.rebindListener) return;
      window.removeEventListener('keydown', this.rebindListener, true);
      this.rebindListener = null;
      this.renderKeybindGrid();
    },
    _applyBinding(action, slot, key) {
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

  window.Games.register(TetrisServer);
})();
