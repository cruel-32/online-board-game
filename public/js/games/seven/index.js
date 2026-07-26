/**
 * 세븐포커 게임 클라이언트 (플러그인).
 * 베팅 HUD(다이/체크·콜/벳·레이즈)·게임룰/결과 팝업을 주입하고 캔버스 렌더러(SevenUI)를 구동한다.
 */
(function () {
  'use strict';
  const SevenUI = window.SevenUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const UNIT = 20;

  const HUD_HTML = `
    <div class="hud-left"><div id="sev-controls-left"></div></div>
    <div class="hud-right">
      <button id="sev-rules" class="btn hud-btn">게임룰</button>
      <div id="sev-controls" class="fel-controls"></div>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>받은 7장 중 최고의 5장 포커 핸드를 만들어 팟을 차지합니다.</p>
    <div class="assist-group-title">진행</div>
    <p>전원 앤티를 낸 뒤 <strong>3rd 스트리트</strong>(비공개 2장+공개 1장)로 시작해
    <strong>4th·5th·6th</strong>(공개 1장씩), <strong>7th</strong>(비공개 1장)까지 받으며 각 단계마다 베팅합니다.</p>
    <div class="assist-group-title">선(先)</div>
    <p>3rd에는 가장 낮은 공개 카드가, 이후에는 공개된 카드로 만든 <strong>가장 높은 족보</strong>가 먼저 행동합니다.</p>
    <div class="assist-group-title">베팅</div>
    <ul>
      <li><strong>체크/벳</strong>: 낼 것이 없으면 체크, 있으면 벳</li>
      <li><strong>콜</strong>: 앞사람 벳에 맞춰 냄</li>
      <li><strong>레이즈</strong>: 벳을 올림</li>
      <li><strong>다이</strong>: 포기</li>
    </ul>
    <div class="assist-group-title">핸드 순위(강→약)</div>
    <p>스트레이트 플러시 &gt; 포카드 &gt; 풀하우스 &gt; 플러시 &gt; 스트레이트 &gt; 트리플 &gt; 투페어 &gt; 원페어 &gt; 하이카드</p>`;

  const POPUPS_HTML = `
    <div id="sev-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰 · 세븐포커</h3><button class="popup-close" data-close="sev-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="sev-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="sev-result-title">핸드 결과</h3></header>
        <div id="sev-result-body"></div>
        <div class="popup-actions">
          <button id="sev-result-ready" class="btn gold">다음 핸드</button>
          <button id="sev-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>
    <div id="sev-player-cards-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3 id="sev-player-cards-title">카드</h3><button class="popup-close" data-close="sev-player-cards-popup">✕</button></header>
        <div id="sev-player-cards-body" class="assist-body"></div>
      </div>
    </div>`;

  const Seven = {
    id: 'seven',
    name: '세븐포커',
    ctx: null, state: null, hudSlot: null, injected: [], raiseTo: 0,

    renderSetup(container, room, { isHost, send }) {
      const cur = (room.options && room.options.stack) || 1000;
      const opts = [500, 1000, 2000, 5000].map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}칩</option>`).join('');
      container.innerHTML = `<label class="setup-row">시작 칩 <select id="sev-stack"${isHost ? '' : ' disabled'}>${opts}</select></label>`;
      if (isHost) { const el = $('sev-stack'); if (el) el.addEventListener('change', () => send({ type: 'set_option', key: 'stack', value: +el.value })); }
    },

    mount({ canvas, hudSlot, ctx }) {
      this.ctx = ctx; this.hudSlot = hudSlot;
      hudSlot.innerHTML = HUD_HTML;
      const screen = document.getElementById('screen-game');
      const holder = document.createElement('div');
      holder.innerHTML = POPUPS_HTML;
      this.injected = Array.from(holder.children);
      this.injected.forEach((el) => screen.appendChild(el));

      const callbacks = { onSeatClick: (id) => this.openPlayerCards(id) };
      if (!SevenUI.canvas) SevenUI.init(canvas, callbacks);
      else { SevenUI.callbacks = callbacks; SevenUI.resize && SevenUI.resize(); }

      $('sev-rules').addEventListener('click', () => window.Modal.open('sev-rules-popup'));
      $('sev-result-ready').addEventListener('click', () => {
        ctx.send({ type: 'ready', ready: true });
        const b = $('sev-result-ready'); b.textContent = '대기 중…'; b.disabled = true;
        setTimeout(() => { const x = $('sev-result-ready'); if (x) x.disabled = false; }, 1500);
      });
      $('sev-result-room').addEventListener('click', () => { window.Modal.close('sev-result-popup'); ctx.showScreen('room'); });
    },

    unmount() {
      this.injected.forEach((el) => el.remove()); this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      SevenUI.state = null; this.state = null;
    },

    topBarText(state) { return `${state.roomName} · 세븐포커`; },

    setState(state) {
      const prev = this.state;
      this.state = state;
      if (window.Sound) {
        const now = state.turnId === state.you && !state.finished;
        const before = prev && prev.turnId === prev.you && !prev.finished;
        if (now && !before) window.Sound.myTurn();
      }
      SevenUI.setState(state);
      this.refreshControls();
    },

    bubbleAnchor(id) { return SevenUI.bubbleAnchor(id); },

    refreshControls() {
      const el = $('sev-controls'), elL = $('sev-controls-left');
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
      if (this.raiseTo < o.minRaiseTo) this.raiseTo = o.minRaiseTo;
      if (this.raiseTo > o.maxRaiseTo) this.raiseTo = o.maxRaiseTo;

      if (elL) {
        elL.innerHTML = `<button id="sev-fold" class="btn hud-btn-main pass">다이</button>`;
        $('sev-fold').addEventListener('click', () => this.send({ kind: 'fold' }));
      }
      const callBtn = o.canCheck
        ? `<button id="sev-call" class="btn hud-btn-main gold">체크</button>`
        : `<button id="sev-call" class="btn hud-btn-main gold">콜<br>${o.toCall}</button>`;
      let raiseBox = '';
      const raiseLabel = o.canCheck ? '벳' : '레이즈';
      if (o.canRaise && o.maxRaiseTo > o.minRaiseTo) {
        raiseBox = `
          <div class="fel-bidbox">
            <button id="sev-r-plus" class="fel-bid-arrow">▲</button>
            <span class="fel-bid-amt">${this.raiseTo}</span>
            <button id="sev-r-minus" class="fel-bid-arrow">▼</button>
          </div>
          <button id="sev-raise" class="btn hud-btn-main gold">${raiseLabel}</button>`;
      } else if (o.canRaise) {
        raiseBox = `<button id="sev-raise" class="btn hud-btn-main gold">올인</button>`;
      }
      el.innerHTML = raiseBox + callBtn;
      $('sev-call').addEventListener('click', () => this.send({ kind: o.canCheck ? 'check' : 'call' }));
      if ($('sev-raise')) $('sev-raise').addEventListener('click', () => this.send({ kind: 'raise', amount: this.raiseTo }));
      if ($('sev-r-plus')) $('sev-r-plus').addEventListener('click', () => { this.raiseTo = Math.min(o.maxRaiseTo, this.raiseTo + UNIT); this.refreshControls(); });
      if ($('sev-r-minus')) $('sev-r-minus').addEventListener('click', () => { this.raiseTo = Math.max(o.minRaiseTo, this.raiseTo - UNIT); this.refreshControls(); });
    },

    send(action) { this.ctx.send({ type: 'game_action', action }); },

    /* ---------- 좌석 클릭: 그 플레이어의 카드를 크게 보기(비공개 카드는 뒷면으로 표시) ---------- */
    openPlayerCards(id) {
      if (!this.state) return;
      const player = this.state.players.find((p) => p.id === id);
      if (!player) return;
      $('sev-player-cards-title').textContent = `${esc(player.name)}님의 카드`;
      const body = $('sev-player-cards-body');
      if (player.out) {
        body.innerHTML = '<div class="assist-empty">탈락한 플레이어입니다.</div>';
      } else if (player.folded) {
        body.innerHTML = '<div class="assist-empty">다이(폴드)한 핸드입니다.</div>';
      } else if (!player.cards || !player.cards.length) {
        body.innerHTML = '<div class="assist-empty">아직 받은 카드가 없습니다.</div>';
      } else {
        const poker = window.PokerCore;
        const cardsHtml = player.cards.map((c) => {
          if (c.hidden || c.rank == null) return `<span class="pcard back"></span>`;
          const red = c.suit === 'h' || c.suit === 'd';
          const rl = poker ? poker.rankLabel(c.rank) : String(c.rank);
          const sym = poker ? poker.SUIT_SYMBOL[c.suit] : c.suit;
          return `<span class="pcard ${red ? 'red' : 'black'}">${rl}${sym}</span>`;
        }).join('');
        const hiddenCount = player.cards.filter((c) => c.hidden || c.rank == null).length;
        const note = hiddenCount
          ? `<p class="muted small-text">비공개 카드 ${hiddenCount}장은 쇼다운 전까지 볼 수 없습니다.</p>` : '';
        body.innerHTML = `<div class="assist-row">${cardsHtml}</div>${note}`;
      }
      window.Modal.open('sev-player-cards-popup');
    },

    onRoundOver(result) {
      if (!result) return;
      const rows = (result.rows || []).map((r) => {
        const state = r.folded ? '다이' : (r.hand || '-');
        const won = r.won > 0 ? `<span class="delta-plus">+${r.won}</span>` : '-';
        return `<tr><td>${esc(r.name)}</td><td>${esc(state)}</td><td>🪙${r.stack}</td><td>${won}</td></tr>`;
      }).join('');
      $('sev-result-title').textContent = result.matchOver ? '🏆 매치 종료' : '핸드 결과';
      $('sev-result-body').innerHTML =
        `<table class="result-table"><tr><th>이름</th><th>핸드</th><th>칩</th><th>이번 획득</th></tr>${rows}</table>
        ${result.matchOver ? `<div class="result-champion">🏆 우승: ${esc(result.championName || '')}</div>` : ''}`;
      const b = $('sev-result-ready');
      if (b) { b.textContent = result.matchOver ? '다시 하기' : '다음 핸드'; b.disabled = false; }
      window.Modal.open('sev-result-popup');
    },

    closeResult() { window.Modal.close('sev-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('sev-result-popup'); },
  };

  window.Games.register(Seven);
})();
