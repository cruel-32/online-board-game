/**
 * 러너 게임 클라이언트(플러그인) — Chrome Dino 느낌의 실시간 배틀로얄(최후 생존).
 * 점프 키 하나로 로컬 엔진(RunnerEngine)을 직접 조작하고(입력은 항상 로컬 즉시 처리 —
 * Chrome Dino와 같은 감각의 핵심), 충돌로 죽었을 때만 서버에 "버틴 시간"을 1회 보고한다.
 * shell(게임 독립 셸)이 mount/unmount/setState/onRoundOver/renderSetup 를 호출한다.
 */
(function () {
  'use strict';
  const UI = window.RunnerUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtTime = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;

  /* ---------- 키 바인딩: 점프 하나(KEY1/KEY2), localStorage에 저장 ---------- */
  const BINDINGS_KEY = 'runner.keybinds';
  function defaultBindings() { return { jump: { key1: ' ', key2: 'ArrowUp' } }; }
  function loadBindings() {
    const bindings = defaultBindings();
    try {
      const saved = JSON.parse(localStorage.getItem(BINDINGS_KEY) || 'null');
      if (saved && saved.jump) bindings.jump = { key1: saved.jump.key1 || '', key2: saved.jump.key2 || '' };
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
    <div class="hud-left"></div>
    <div class="hud-right">
      <div class="hud-secondary">
        ${window.Platform && window.Platform.isKeyboardPlatform() ? '<button id="run-keybind" class="btn hud-btn">버튼설정</button>' : ''}
      </div>
      <button id="run-jump" class="btn gold run-jump-btn">점프</button>
    </div>`;

  const POPUPS_HTML = `
    <div id="run-keybind-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>버튼 설정</h3><button class="popup-close" data-close="run-keybind-popup">✕</button></header>
        <div id="run-keybind-grid" class="tet-keybind-grid"></div>
        <p class="muted small-text">칸을 누른 뒤 원하는 키를 누르면 바인딩됩니다. 이미 사용 중인 키는 자동으로 해제됩니다.</p>
      </div>
    </div>
    <div id="run-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>🏁 게임 결과</h3></header>
        <div id="run-result-body"></div>
        <div class="popup-actions">
          <button id="run-result-ready" class="btn gold">다시 게임 준비</button>
          <button id="run-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Runner = {
    id: 'runner',
    name: '점프러너',
    ctx: null,
    state: null,
    lastSeed: null,
    hudSlot: null,
    injected: [],
    keyHandlerDown: null,
    keyHandlerUp: null,
    bindings: null,
    keyToAction: {},
    rebindListener: null,
    reported: false,

    renderSetup(container) {
      container.innerHTML = `<p class="muted small-text">점프러너는 2~4인 · 점프(+2단 점프)로 장애물을 피하는 실시간 배틀로얄 · 최후 생존 · 봇 추가 가능.</p>`;
    },

    mount({ canvas, hudSlot, ctx }) {
      this.ctx = ctx;
      this.hudSlot = hudSlot;
      this.reported = false;
      hudSlot.innerHTML = HUD_HTML;
      const screen = document.getElementById('screen-game');
      const holder = document.createElement('div');
      holder.innerHTML = POPUPS_HTML;
      this.injected = Array.from(holder.children);
      this.injected.forEach((el) => screen.appendChild(el));

      canvas.classList.add('runner-viewport'); // 레터박스 캔버스 표시용 마커(별도 스타일 없음)

      this.bindings = loadBindings();
      UI.init(canvas, { onDead: (elapsedMs) => this._onDead(elapsedMs) });
      this._wire();
      this._rebuildKeyTables();
    },

    unmount() {
      this._cancelRebind();
      if (this.keyHandlerDown) window.removeEventListener('keydown', this.keyHandlerDown);
      if (this.keyHandlerUp) window.removeEventListener('keyup', this.keyHandlerUp);
      this.keyHandlerDown = null; this.keyHandlerUp = null;
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.classList.remove('runner-viewport');
        canvas.style.width = ''; canvas.style.height = '';
        canvas.style.left = ''; canvas.style.top = '';
      }
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      UI.engine = null; UI.opponents = []; UI.finished = false; UI.myDead = false;
      UI.paused = false; UI.countdownStart = null; UI._lastCountdownLabel = null;
      this.state = null; this.lastSeed = null;
    },

    topBarText(state) { return `${state.roomName} · 점프러너`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      // roundNo가 아니라 seed로 새 매치를 감지한다 — 이 게임은 매치 하나 = 라운드 하나라 settle()이
      // 항상 matchOver를 세우고, 다음 startGame()은 그 때문에 roundNo를 0으로 되돌렸다가 다시 1로
      // 올려 매번 roundNo가 1에 고정된다(테트리스 클라이언트 권위 버전과 동일한 이유로 seed를 씀).
      if (state.seed !== this.lastSeed) {
        this.lastSeed = state.seed;
        this.reported = false;
        UI.startLocal(state.seed);
      }
      UI.setOpponents((state.players || []).filter((p) => p.id !== state.you));
      UI.setMeta({ finished: state.finished, winnerName: state.winnerName });

      // 상대가 방금 탈락했으면(이전 상태에서는 alive였는데 지금은 아님) 눈에 띄는 알림을 띄운다.
      // 같은 매치 안에서만 비교해야 한다 — 새 매치로 넘어간 첫 호출에서는 prev가 "지난 매치의
      // 끝난 상태"라 모두 죽어 있으므로, seed가 같을 때만 비교해 오탐을 막는다.
      if (prev && prev.seed === state.seed) {
        const prevAlive = new Map((prev.players || []).map((p) => [p.id, p.alive]));
        for (const p of (state.players || [])) {
          if (p.id === state.you) continue;
          if (prevAlive.get(p.id) === true && p.alive === false) UI.notifyOpponentDown(p.name);
        }
      }
    },

    bubbleAnchor() { return null; }, // 러너는 좌석 배치가 없어 말풍선 앵커를 지원하지 않음

    _onDead(elapsedMs) {
      if (this.reported) return; // 네트워크 재시도 등으로 중복 보고되지 않도록(1회 보장)
      this.reported = true;
      this.ctx.send({ type: 'game_action', action: { kind: 'dead', elapsedMs } });
    },

    /* ---------- 입력: 키보드(재배정 가능) + 터치 버튼 ---------- */
    _canAct() {
      return UI.engine && !UI.myDead && !UI.finished && !UI.paused &&
        !(window.Modal && window.Modal.isOpen('run-keybind-popup'));
    },

    _wire() {
      const jump = () => { if (this._canAct()) UI.jump(); };

      $('run-jump').addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
      if ($('run-keybind')) $('run-keybind').addEventListener('click', () => {
        this.renderKeybindGrid();
        window.Modal.open('run-keybind-popup');
      });

      $('run-result-ready').addEventListener('click', () => {
        this.ctx.send({ type: 'ready', ready: true });
        $('run-result-ready').textContent = '다른 플레이어 대기 중…';
        $('run-result-ready').disabled = true;
        setTimeout(() => { const b = $('run-result-ready'); if (b) b.disabled = false; }, 1500);
      });
      $('run-result-room').addEventListener('click', () => {
        window.Modal.close('run-result-popup');
        this.ctx.showScreen('room');
      });

      this.keyHandlerDown = (e) => {
        if (e.repeat) return;
        if (this.keyToAction[e.key] !== 'jump') return;
        e.preventDefault();
        jump();
      };
      window.addEventListener('keydown', this.keyHandlerDown);
    },

    /* ---------- 버튼 설정(키 바인딩) 팝업 — tetris/index.js와 동일한 구조(액션 1개) ---------- */
    _rebuildKeyTables() {
      this.keyToAction = {};
      const b = this.bindings.jump;
      if (b.key1) this.keyToAction[b.key1] = 'jump';
      if (b.key2) this.keyToAction[b.key2] = 'jump';
    },
    _saveBindings() {
      try { localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings)); } catch (_) { /* 무시 */ }
    },

    renderKeybindGrid() {
      if (this.rebindListener) { window.removeEventListener('keydown', this.rebindListener, true); this.rebindListener = null; }
      this.waitingBtn = null;
      const grid = $('run-keybind-grid');
      if (!grid) return;
      const b = this.bindings.jump;
      grid.innerHTML = `
        <div class="tet-kb-row tet-kb-head"><div></div><div>KEY1</div><div>KEY2</div></div>
        <div class="tet-kb-row">
          <div class="tet-kb-label">점프</div>
          <button type="button" class="tet-kb-cell" data-slot="key1">${esc(keyLabel(b.key1))}</button>
          <button type="button" class="tet-kb-cell" data-slot="key2">${esc(keyLabel(b.key2))}</button>
        </div>`;
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
        if (!window.Modal.isOpen('run-keybind-popup')) { this._cancelRebind(); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { this._cancelRebind(); return; }
        this._applyBinding(btn.dataset.slot, e.key);
        this._cancelRebind();
      };
      this.rebindListener = onKey;
      window.addEventListener('keydown', onKey, true);
    },
    _restoreCellLabel(btn) {
      btn.classList.remove('waiting');
      btn.textContent = keyLabel(this.bindings.jump[btn.dataset.slot]);
    },
    _cancelRebind() {
      if (!this.rebindListener) return;
      window.removeEventListener('keydown', this.rebindListener, true);
      this.rebindListener = null;
      this.renderKeybindGrid();
    },
    _applyBinding(slot, key) {
      const b = this.bindings.jump;
      if (b.key1 === key) b.key1 = '';
      if (b.key2 === key) b.key2 = '';
      b[slot] = key;
      this._saveBindings();
      this._rebuildKeyTables();
    },

    /* ---------- 결과 팝업 ---------- */
    onRoundOver(result) {
      const rows = (result.rows || []).map((r) => `<tr class="r${r.rank}"><td>${r.rank}등</td><td>${esc(r.name)}</td>
        <td>${fmtTime(r.survivedMs)}</td></tr>`).join('');
      $('run-result-body').innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>버틴 시간</th></tr>${rows}</table>
        <div class="result-champion">🏆 우승: ${esc(result.winnerName || '')}</div>`;
      $('run-result-ready').disabled = false;
      $('run-result-ready').textContent = '다시 게임 준비';
      $('run-result-room').style.display = 'none';
      window.Modal.open('run-result-popup');

      // 이제 매치는 전원이 죽어야 끝나므로(혼자 남아도 계속 플레이), 결과가 뜬 시점엔 상태상
      // "살아있는 사람"이 없다 — 승리 여부는 결과 테이블의 내 순위로 판단해야 한다.
      const myRow = (result.rows || []).find((r) => r.id === this.ctx.myId);
      if (myRow && myRow.rank === 1 && window.Sound) window.Sound.victory();
    },

    closeResult() { window.Modal.close('run-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('run-result-popup'); },
  };

  window.Games.register(Runner);
})();
