/**
 * 홀덤 게임 클라이언트 (플러그인).
 * 베팅 HUD(폴드/체크·콜/레이즈·올인)·게임룰/결과 팝업을 주입하고 캔버스 렌더러(HoldemUI)를 구동한다.
 */
(function () {
  'use strict';
  const HoldemUI = window.HoldemUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const BB = 20;

  const HUD_HTML = `
    <div class="hud-left"><div id="hold-controls-left"></div></div>
    <div class="hud-right">
      <button id="hold-rules" class="btn hud-btn">게임룰</button>
      <div id="hold-controls" class="fel-controls"></div>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>2장의 홀 카드와 5장의 공유 카드(보드) 중 최고의 5장 포커 핸드를 만들어 팟을 차지합니다.</p>
    <div class="assist-group-title">진행</div>
    <p>스몰/빅 블라인드를 낸 뒤 <strong>프리플롭 → 플롭(3장) → 턴(1장) → 리버(1장)</strong> 순으로
    각 라운드마다 베팅합니다.</p>
    <div class="assist-group-title">베팅</div>
    <ul>
      <li><strong>체크</strong>: 낼 것이 없을 때 그냥 넘김</li>
      <li><strong>콜</strong>: 앞사람 벳에 맞춰 냄</li>
      <li><strong>레이즈</strong>: 벳을 올림(최소 = 직전 레이즈 크기)</li>
      <li><strong>폴드</strong>: 포기(그때까지 낸 칩은 잃음)</li>
      <li><strong>올인</strong>: 남은 칩 전부 — 부족분은 사이드 팟으로 처리</li>
    </ul>
    <div class="assist-group-title">핸드 순위(강→약)</div>
    <p>스트레이트 플러시 &gt; 포카드 &gt; 풀하우스 &gt; 플러시 &gt; 스트레이트 &gt; 트리플 &gt; 투페어 &gt; 원페어 &gt; 하이카드</p>
    <div class="assist-group-title">매치</div>
    <p>매 핸드마다 딜러 버튼이 돌고, 한 명만 칩이 남으면 매치가 끝납니다.</p>`;

  const POPUPS_HTML = `
    <div id="hold-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰 · 홀덤</h3><button class="popup-close" data-close="hold-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="hold-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="hold-result-title">핸드 결과</h3></header>
        <div id="hold-result-body"></div>
        <div class="popup-actions">
          <button id="hold-result-ready" class="btn gold">다음 핸드</button>
          <button id="hold-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Holdem = {
    id: 'holdem',
    name: '홀덤',
    ctx: null, state: null, hudSlot: null, injected: [], raiseTo: 0,

    renderSetup(container, room, { isHost, send }) {
      const cur = (room.options && room.options.stack) || 1000;
      const opts = [500, 1000, 2000, 5000].map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}칩</option>`).join('');
      container.innerHTML = `<label class="setup-row">시작 칩 <select id="hold-stack"${isHost ? '' : ' disabled'}>${opts}</select></label>`;
      if (isHost) { const el = $('hold-stack'); if (el) el.addEventListener('change', () => send({ type: 'set_option', key: 'stack', value: +el.value })); }
    },

    mount({ canvas, hudSlot, ctx }) {
      this.ctx = ctx; this.hudSlot = hudSlot;
      hudSlot.innerHTML = HUD_HTML;
      const screen = document.getElementById('screen-game');
      const holder = document.createElement('div');
      holder.innerHTML = POPUPS_HTML;
      this.injected = Array.from(holder.children);
      this.injected.forEach((el) => screen.appendChild(el));

      if (!HoldemUI.canvas) HoldemUI.init(canvas, {});
      else HoldemUI.resize && HoldemUI.resize();

      $('hold-rules').addEventListener('click', () => window.Modal.open('hold-rules-popup'));
      $('hold-result-ready').addEventListener('click', () => {
        ctx.send({ type: 'ready', ready: true });
        const b = $('hold-result-ready'); b.textContent = '대기 중…'; b.disabled = true;
        setTimeout(() => { const x = $('hold-result-ready'); if (x) x.disabled = false; }, 1500);
      });
      $('hold-result-room').addEventListener('click', () => { window.Modal.close('hold-result-popup'); ctx.showScreen('room'); });
    },

    unmount() {
      this.injected.forEach((el) => el.remove()); this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      HoldemUI.state = null; this.state = null;
    },

    topBarText(state) { return `${state.roomName} · 홀덤`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      if (window.Sound) {
        const now = state.turnId === state.you && !state.finished;
        const before = prev && prev.turnId === prev.you && !prev.finished;
        if (now && !before) window.Sound.myTurn();
      }
      HoldemUI.setState(state);
      this.refreshControls();
    },

    bubbleAnchor(id) { return HoldemUI.bubbleAnchor(id); },

    refreshControls() {
      const el = $('hold-controls'), elL = $('hold-controls-left');
      if (!el || !this.state) return;
      if (elL) elL.innerHTML = '';
      const s = this.state;
      const myTurn = s.turnId === s.you && !s.finished;
      const o = s.options;
      if (!myTurn || !o) {
        const who = (s.players || []).find((p) => p.id === s.turnId);
        el.innerHTML = s.finished ? '' : `<div class="fel-hint">상대 차례${who ? '<br>' + esc(who.name) : ''}</div>`;
        return;
      }
      // 레이즈 금액 클램프
      if (this.raiseTo < o.minRaiseTo) this.raiseTo = o.minRaiseTo;
      if (this.raiseTo > o.maxRaiseTo) this.raiseTo = o.maxRaiseTo;

      // 좌측: 폴드
      if (elL) {
        elL.innerHTML = `<button id="hold-fold" class="btn hud-btn-main pass">폴드</button>`;
        $('hold-fold').addEventListener('click', () => this.send({ kind: 'fold' }));
      }
      // 우측: 체크/콜 + 레이즈 박스 + 올인
      const callBtn = o.canCheck
        ? `<button id="hold-call" class="btn hud-btn-main gold">체크</button>`
        : `<button id="hold-call" class="btn hud-btn-main gold">콜<br>${o.toCall}</button>`;
      let raiseBox = '';
      if (o.canRaise && o.maxRaiseTo > o.minRaiseTo) {
        raiseBox = `
          <div class="fel-bidbox">
            <button id="hold-r-plus" class="fel-bid-arrow">▲</button>
            <span class="fel-bid-amt">${this.raiseTo}</span>
            <button id="hold-r-minus" class="fel-bid-arrow">▼</button>
          </div>
          <button id="hold-raise" class="btn hud-btn-main gold">레이즈</button>`;
      } else if (o.canRaise) {
        raiseBox = `<button id="hold-raise" class="btn hud-btn-main gold">올인</button>`;
      }
      el.innerHTML = raiseBox + callBtn;
      $('hold-call').addEventListener('click', () => this.send({ kind: o.canCheck ? 'check' : 'call' }));
      if ($('hold-raise')) $('hold-raise').addEventListener('click', () => this.send({ kind: 'raise', amount: this.raiseTo }));
      if ($('hold-r-plus')) $('hold-r-plus').addEventListener('click', () => { this.raiseTo = Math.min(o.maxRaiseTo, this.raiseTo + BB); this.refreshControls(); });
      if ($('hold-r-minus')) $('hold-r-minus').addEventListener('click', () => { this.raiseTo = Math.max(o.minRaiseTo, this.raiseTo - BB); this.refreshControls(); });
    },

    send(action) { this.ctx.send({ type: 'game_action', action }); },

    onRoundOver(result) {
      if (!result) return;
      const boardTxt = (result.board || []).map((c) => (window.PokerCore ? window.PokerCore.rankLabel(c.rank) + window.PokerCore.SUIT_SYMBOL[c.suit] : '')).join(' ');
      const rows = (result.rows || []).map((r) => {
        const state = r.folded ? '폴드' : (r.hand || '-');
        const won = r.won > 0 ? `<span class="delta-plus">+${r.won}</span>` : '-';
        return `<tr><td>${esc(r.name)}</td><td>${esc(state)}</td><td>🪙${r.stack}</td><td>${won}</td></tr>`;
      }).join('');
      $('hold-result-title').textContent = result.matchOver ? '🏆 매치 종료' : '핸드 결과';
      $('hold-result-body').innerHTML =
        `${boardTxt ? `<p class="muted small-text">보드: ${esc(boardTxt)}</p>` : ''}
        <table class="result-table"><tr><th>이름</th><th>핸드</th><th>칩</th><th>이번 획득</th></tr>${rows}</table>
        ${result.matchOver ? `<div class="result-champion">🏆 우승: ${esc(result.championName || '')}</div>` : ''}`;
      const b = $('hold-result-ready');
      if (b) { b.textContent = result.matchOver ? '다시 하기' : '다음 핸드'; b.disabled = false; }
      window.Modal.open('hold-result-popup');
    },

    closeResult() { window.Modal.close('hold-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('hold-result-popup'); },
  };

  window.Games.register(Holdem);
})();
