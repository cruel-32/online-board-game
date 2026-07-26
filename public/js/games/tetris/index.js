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

  const HUD_HTML = `
    <div class="hud-left">
      <div class="tet-dpad">
        <button id="tet-rotL" class="btn hud-btn">⟲</button>
        <button id="tet-left" class="btn hud-btn">◀</button>
        <button id="tet-right" class="btn hud-btn">▶</button>
        <button id="tet-rotR" class="btn hud-btn">⟳</button>
      </div>
      <button id="tet-down" class="btn hud-btn-main pass">▼<br>소프트</button>
    </div>
    <div class="hud-right">
      <div class="hud-secondary">
        <button id="tet-hold" class="btn hud-btn">HOLD</button>
        <button id="tet-rules" class="btn hud-btn">게임룰</button>
      </div>
      <button id="tet-drop" class="btn hud-btn-main gold">하드<br>드롭</button>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>보드가 가득 차 조각을 더 놓을 수 없게 된 사람부터 탈락합니다. 최후까지 생존하면 승리합니다.</p>
    <div class="assist-group-title">조작</div>
    <ul>
      <li><strong>◀ ▶</strong> / 방향키: 좌우 이동</li>
      <li><strong>⟲ ⟳</strong> / ↑ · Z: 회전</li>
      <li><strong>▼ 소프트</strong> / ↓: 소프트 드롭(빠르게 낙하)</li>
      <li><strong>하드드롭</strong> / 스페이스: 즉시 바닥까지 낙하 + 고정</li>
      <li><strong>HOLD</strong> / C: 현재 조각 보관(고정되기 전까지 한 번만)</li>
    </ul>
    <div class="assist-group-title">공격(가비지)</div>
    <p>2줄 이상을 동시에 지우면 상대 중 한 명에게 방해줄(가비지)을 보냅니다.
    더블 1줄 · 트리플 2줄 · 테트리스(4줄) 4줄. 받은 가비지는 다음 조각을 고정하는 순간 내 보드 아래에 쌓입니다.</p>
    <div class="assist-group-title">모든 카드는 공개</div>
    <p>상대의 보드는 화면 오른쪽에서 실시간(조각을 고정할 때마다)으로 확인할 수 있습니다.</p>`;

  const POPUPS_HTML = `
    <div id="tet-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰 · 테트리스</h3><button class="popup-close" data-close="tet-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
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
    repeats: {}, // key -> { das, arr }
    keyHandlerDown: null,
    keyHandlerUp: null,

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

      UI.init(canvas, { onLock: (ev) => this._onLock(ev) });
      this._wire();
    },

    unmount() {
      this._clearAllRepeats();
      if (this.keyHandlerDown) window.removeEventListener('keydown', this.keyHandlerDown);
      if (this.keyHandlerUp) window.removeEventListener('keyup', this.keyHandlerUp);
      this.keyHandlerDown = null; this.keyHandlerUp = null;
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      UI.engine = null; UI.opponents = []; UI.finished = false;
      this.state = null; this.lastSeed = null;
    },

    topBarText(state) { return `${state.roomName} · 테트리스`; },

    setState(state) {
      this.state = state;
      if (state.seed !== this.lastSeed) {
        this.lastSeed = state.seed;
        UI.startLocal(state.seed);
      }
      for (const g of state.incomingGarbage || []) {
        if (UI.engine) UI.engine.queueGarbage(g.lines, g.holeCol);
      }
      UI.setOpponents((state.players || []).filter((p) => p.id !== state.you));
      UI.setMeta({ finished: state.finished, winnerName: state.winnerName });
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
        if (ev.topOut) window.Sound.pass();
        else if (ev.linesCleared >= 4) window.Sound.slam();
        else if (ev.linesCleared > 0) window.Sound.play();
      }
    },

    /* ---------- 입력: 키보드 + 터치 버튼(길게 누르면 DAS/ARR 반복) ---------- */
    _canAct() { return UI.engine && !UI.myTopOut && !UI.finished; },

    _stopRepeat(key) {
      const e = this.repeats[key];
      if (!e) return;
      clearTimeout(e.das); clearInterval(e.arr);
      delete this.repeats[key];
    },
    _clearAllRepeats() {
      for (const key of Object.keys(this.repeats)) this._stopRepeat(key);
    },

    _wire() {
      const act = (fn) => () => { if (this._canAct()) fn(); };

      const moveLeft = act(() => { if (UI.engine.moveLeft() && window.Sound) window.Sound.select(); });
      const moveRight = act(() => { if (UI.engine.moveRight() && window.Sound) window.Sound.select(); });
      const softDrop = act(() => UI.engine.softDrop());
      const rotCW = act(() => { if (UI.engine.rotateCW() && window.Sound) window.Sound.select(); });
      const rotCCW = act(() => { if (UI.engine.rotateCCW() && window.Sound) window.Sound.select(); });
      const hold = act(() => { if (UI.engine.hold() && window.Sound) window.Sound.select(); });
      const hardDrop = act(() => {
        const ev = UI.engine.hardDrop();
        // UI._reportLock이 myTopOut 갱신 + onLock 콜백(네트워킹) 호출을 함께 처리한다.
        // (중력에 의한 자연 고정도 같은 경로로 처리되므로, 하드드롭도 반드시 이 경로를 타야
        //  UI.myTopOut이 정확히 갱신된다.)
        if (ev.locked) UI._reportLock(ev);
      });

      // 터치 버튼: 이동/소프트드롭은 눌러서 반복, 회전/홀드/하드드롭은 1회성
      const touchRepeat = (id, key, fn, ms) => {
        const el = $(id);
        const start = (e) => { e.preventDefault(); this._startRepeatCustom(key, fn, ms); };
        const stop = () => this._stopRepeat(key);
        el.addEventListener('pointerdown', start);
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointerleave', stop);
        el.addEventListener('pointercancel', stop);
      };
      touchRepeat('tet-left', 'left', moveLeft, REPEAT_ARR_MS);
      touchRepeat('tet-right', 'right', moveRight, REPEAT_ARR_MS);
      touchRepeat('tet-down', 'down', softDrop, SOFT_DROP_MS);
      $('tet-rotL').addEventListener('click', rotCCW);
      $('tet-rotR').addEventListener('click', rotCW);
      $('tet-hold').addEventListener('click', hold);
      $('tet-drop').addEventListener('click', hardDrop);
      $('tet-rules').addEventListener('click', () => window.Modal.open('tet-rules-popup'));

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

      // 키보드
      const KEY_MAP = {
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
        ArrowDown: 'down', s: 'down', S: 'down',
      };
      const ONE_SHOT = {
        ArrowUp: rotCW, x: rotCW, X: rotCW,
        z: rotCCW, Z: rotCCW,
        c: hold, C: hold, Shift: hold,
        ' ': hardDrop,
      };
      this.keyHandlerDown = (e) => {
        if (e.repeat) return;
        if (KEY_MAP[e.key]) {
          e.preventDefault();
          const key = KEY_MAP[e.key];
          const fn = key === 'left' ? moveLeft : key === 'right' ? moveRight : softDrop;
          const ms = key === 'down' ? SOFT_DROP_MS : REPEAT_ARR_MS;
          this._startRepeatCustom(key, fn, ms);
        } else if (ONE_SHOT[e.key]) {
          e.preventDefault();
          ONE_SHOT[e.key]();
        }
      };
      this.keyHandlerUp = (e) => {
        if (KEY_MAP[e.key]) this._stopRepeat(KEY_MAP[e.key]);
      };
      window.addEventListener('keydown', this.keyHandlerDown);
      window.addEventListener('keyup', this.keyHandlerUp);
    },

    // ARR 간격을 액션마다 다르게(소프트드롭은 더 빠르게) 쓰기 위한 변형판
    _startRepeatCustom(key, action, arrMs) {
      if (this.repeats[key]) return;
      action();
      const entry = { das: null, arr: null };
      entry.das = setTimeout(() => { entry.arr = setInterval(action, arrMs); }, REPEAT_DAS_MS);
      this.repeats[key] = entry;
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
