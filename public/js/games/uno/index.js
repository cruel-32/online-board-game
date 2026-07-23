/**
 * 우노 게임 클라이언트 (플러그인).
 * HUD(뽑기/넘기기·게임룰)·게임룰/결과 팝업을 주입하고 캔버스 렌더러(UnoUI)를 구동한다.
 */
(function () {
  'use strict';
  const UnoUI = window.UnoUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const HUD_HTML = `
    <div class="hud-left"><div id="uno-controls-left"></div></div>
    <div class="hud-right">
      <button id="uno-rules" class="btn hud-btn">게임룰</button>
      <div id="uno-controls" class="fel-controls"></div>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>손패를 가장 먼저 모두 내면 승리합니다.</p>
    <div class="assist-group-title">카드 내기</div>
    <p>맨 위 버림패와 <strong>같은 색</strong> 또는 <strong>같은 숫자·기호</strong>인 카드를 낼 수 있습니다.
    <strong>와일드</strong>는 언제든 낼 수 있고 색을 바꿉니다.</p>
    <div class="assist-group-title">특수 카드</div>
    <ul>
      <li>스킵(⊘): 다음 사람 차례를 건너뜁니다.</li>
      <li>리버스(⇄): 진행 방향을 바꿉니다(2인전은 스킵과 동일).</li>
      <li>드로우2(+2): 다음 사람이 2장을 뽑고 차례를 잃습니다.</li>
      <li>와일드(★): 원하는 색으로 바꿉니다.</li>
      <li>와일드 드로우4(+4): 색을 바꾸고 다음 사람이 4장을 뽑고 차례를 잃습니다.</li>
    </ul>
    <div class="assist-group-title">뽑기</div>
    <p>낼 카드가 없으면 <strong>뽑기</strong>로 1장을 뽑습니다. 뽑은 카드가 낼 수 있으면 바로 내거나 <strong>넘기기</strong>를 누릅니다.</p>
    <div class="assist-group-title">점수(정산)</div>
    <p>승자를 제외한 나머지의 남은 카드 점수(숫자=액면가, 기호=20, 와일드=50)로 순위를 매깁니다.</p>`;

  const POPUPS_HTML = `
    <div id="uno-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰 · 우노</h3><button class="popup-close" data-close="uno-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="uno-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>🏁 게임 종료</h3></header>
        <div id="uno-result-body"></div>
        <div class="popup-actions">
          <button id="uno-result-ready" class="btn gold">다시 하기</button>
          <button id="uno-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Uno = {
    id: 'uno',
    name: '우노',
    ctx: null, state: null, hudSlot: null, injected: [],

    renderSetup(container) {
      container.innerHTML = `<p class="muted small-text">우노는 2~6인 · 별도 설정이 없습니다.</p>`;
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

      const cbs = {
        onPlay: (cardId, color) => ctx.send({ type: 'game_action', action: { kind: 'play', cardId, color } }),
        onDraw: () => ctx.send({ type: 'game_action', action: { kind: 'draw' } }),
      };
      if (!UnoUI.canvas) UnoUI.init(canvas, cbs);
      else { UnoUI.callbacks = cbs; UnoUI.resize && UnoUI.resize(); }

      $('uno-rules').addEventListener('click', () => window.Modal.open('uno-rules-popup'));
      $('uno-result-ready').addEventListener('click', () => {
        ctx.send({ type: 'ready', ready: true });
        const b = $('uno-result-ready'); b.textContent = '대기 중…'; b.disabled = true;
        setTimeout(() => { const x = $('uno-result-ready'); if (x) x.disabled = false; }, 1500);
      });
      $('uno-result-room').addEventListener('click', () => { window.Modal.close('uno-result-popup'); ctx.showScreen('room'); });
    },

    unmount() {
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      UnoUI.state = null; this.state = null;
    },

    topBarText(state) { return `${state.roomName} · 우노`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      if (window.Sound) {
        const myTurnNow = state.turnId === state.you && !state.finished;
        const myTurnBefore = prev && prev.turnId === prev.you && !prev.finished;
        if (myTurnNow && !myTurnBefore) window.Sound.myTurn();
      }
      UnoUI.setState(state);
      this.refreshControls();
    },

    bubbleAnchor(id) { return UnoUI.bubbleAnchor(id); },

    refreshControls() {
      const el = $('uno-controls'), elL = $('uno-controls-left');
      if (!el || !this.state) return;
      if (elL) elL.innerHTML = '';
      const s = this.state;
      const myTurn = s.turnId === s.you && !s.finished;
      if (!myTurn) {
        const who = (s.players || []).find((p) => p.id === s.turnId);
        el.innerHTML = `<div class="fel-hint">상대 차례${who ? '<br>' + esc(who.name) : ''}</div>`;
        return;
      }
      if (s.justDrewCardId) {
        // 뽑은 카드를 내거나(카드 탭) 넘기기
        el.innerHTML = `<button id="uno-pass" class="btn hud-btn-main pass">넘기기</button>`;
        $('uno-pass').addEventListener('click', () => this.ctx.send({ type: 'game_action', action: { kind: 'pass' } }));
      } else {
        el.innerHTML = `<button id="uno-draw" class="btn hud-btn-main gold">뽑기</button>`;
        $('uno-draw').addEventListener('click', () => this.ctx.send({ type: 'game_action', action: { kind: 'draw' } }));
      }
    },

    onRoundOver(result) {
      if (!result || !result.rows) return;
      const rows = result.rows.map((r) =>
        `<tr class="r${r.rank}"><td>${r.rank}등</td><td>${esc(r.name)}</td><td>${r.remaining}장</td><td><strong>${r.points}</strong></td></tr>`
      ).join('');
      $('uno-result-body').innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>남은 카드</th><th>벌점</th></tr>${rows}</table>
        <div class="result-champion">🏆 우승: ${esc(result.winnerName || '')}</div>`;
      const b = $('uno-result-ready'); if (b) { b.textContent = '다시 하기'; b.disabled = false; }
      window.Modal.open('uno-result-popup');
    },

    closeResult() { window.Modal.close('uno-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('uno-result-popup'); },
  };

  window.Games.register(Uno);
})();
