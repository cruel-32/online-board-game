/**
 * 펠리시티 게임 클라이언트 (플러그인).
 * HUD(배치/입찰 컨트롤)·게임룰·최종 점수판을 주입하고 캔버스 렌더러(FelicityUI)를 구동한다.
 */
(function () {
  'use strict';
  const FelicityUI = window.FelicityUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const HUD_HTML = `
    <div class="hud-left">
      <div id="fel-controls-left" class="fel-controls-left"></div>
    </div>
    <div class="hud-right">
      <button id="fel-rules" class="btn hud-btn">게임룰</button>
      <div id="fel-controls" class="fel-controls"></div>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>9라운드 경매로 고양이 카드를 모아 가장 높은 점수를 얻으면 승리합니다.</p>
    <div class="assist-group-title">카드</div>
    <ul>
      <li>고양이: -8, -5, 3, 5, 8, 11, 15 (점수에 그대로 합산, 빨강 음수/노랑 양수)</li>
      <li>토끼: 0점</li>
      <li>개(큰 개/작은 개): 점수 없이 제거되며, 자루의 고양이를 쫓아냅니다.</li>
    </ul>
    <div class="assist-group-title">진행</div>
    <p>매 라운드 전원이 손패 1장을 뒷면으로 놓아 "자루"를 만들고, 시작 플레이어의 카드를 공개한 뒤 경매를 진행합니다.</p>
    <div class="assist-group-title">경매</div>
    <p>시작 플레이어부터 차례로 <strong>이전보다 높게 입찰</strong>하거나 <strong>패스</strong>합니다.
    패스하면 입찰 코인을 돌려받고, 동전이 남은 <strong>가장 낮은 숫자의 쥐 카드 코인</strong>을 가져오며, 자루 카드가 1장 공개됩니다.
    마지막 1인이 낙찰가를 은행에 내고 자루의 카드를 모두 가져갑니다.</p>
    <div class="assist-group-title">개 효과</div>
    <p>자루에 개가 1장이면 큰 개는 <strong>양수 고양이 중 최고값</strong>을, 작은 개는 <strong>음수 고양이 중 최저값</strong>을 개와 함께 제거합니다.
    개가 2장 이상이면 개들만 제거되고 고양이는 남습니다.</p>
    <div class="assist-group-title">점수</div>
    <p>모은 고양이 값의 합 + 남은 코인 수(1코인=1점). 가장 높은 사람이 승리하며, 동점이면 카드 포인트가 많은 사람이 이깁니다.</p>`;

  const POPUPS_HTML = `
    <div id="fel-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰 · 펠리시티</h3><button class="popup-close" data-close="fel-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="fel-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>🏁 게임 종료 · 최종 점수</h3></header>
        <div id="fel-result-body"></div>
        <div class="popup-actions">
          <button id="fel-result-ready" class="btn gold">다시 하기</button>
          <button id="fel-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Felicity = {
    id: 'felicity',
    name: '펠리시티',
    ctx: null,
    state: null,
    hudSlot: null,
    injected: [],
    bidAmount: 1,

    renderSetup(container, room, { isHost }) {
      container.innerHTML = `<p class="muted small-text">펠리시티는 4~5인 · 별도 설정이 없습니다.</p>`;
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
        onSelect: () => this.refreshControls(),
        onReady: () => this.ctx.send({ type: 'game_action', action: { kind: 'ready' } }),
      };
      if (!FelicityUI.canvas) FelicityUI.init(canvas, cbs);
      else { FelicityUI.callbacks = cbs; FelicityUI.resize && FelicityUI.resize(); }

      $('fel-rules').addEventListener('click', () => window.Modal.open('fel-rules-popup'));
      $('fel-result-ready').addEventListener('click', () => {
        this.ctx.send({ type: 'ready', ready: true });
        const b = $('fel-result-ready'); b.textContent = '대기 중…'; b.disabled = true;
        setTimeout(() => { const x = $('fel-result-ready'); if (x) x.disabled = false; }, 1500);
      });
      $('fel-result-room').addEventListener('click', () => { window.Modal.close('fel-result-popup'); this.ctx.showScreen('room'); });
    },

    unmount() {
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      FelicityUI.state = null;
      this.state = null;
    },

    topBarText(state) {
      return `${state.roomName} · ${state.round}/${state.totalRounds}라운드`;
    },

    setState(state) {
      const prev = this.state;
      this.state = state;
      // 내 차례 시작음
      if (window.Sound) {
        const myTurnNow = state.turnId === state.you && !state.finished;
        const myTurnBefore = prev && prev.turnId === prev.you && !prev.finished && prev.round === state.round && prev.phase === state.phase;
        if (myTurnNow && !myTurnBefore) window.Sound.myTurn();
      }
      FelicityUI.setState(state);
      this.refreshControls();
    },

    bubbleAnchor(id) { return FelicityUI.bubbleAnchor(id); },

    /* ---------- HUD 컨트롤(단계/차례에 따라 갱신) ---------- */
    refreshControls() {
      const el = $('fel-controls');
      const elL = $('fel-controls-left');
      if (!el || !this.state) return;
      if (elL) elL.innerHTML = ''; // 기본: 좌측 컨트롤 비움(패스는 경매 차례에만)
      const s = this.state;

      // 라운드 종료 → 준비완료 버튼은 결과창(캔버스 패널) 안에서 처리하므로 HUD 컨트롤은 비운다
      if (s.phase === 'roundover' && !s.finished) {
        el.innerHTML = '';
        return;
      }

      const myTurn = s.turnId === s.you && !s.finished;
      const me = (s.players || []).find((p) => p.id === s.you);

      if (!myTurn) {
        const who = (s.players || []).find((p) => p.id === s.turnId);
        el.innerHTML = `<div class="fel-hint">${s.phase === 'placing' ? '카드 배치 중' : '경매 진행 중'}<br>${who ? esc(who.name) + ' 차례' : ''}</div>`;
        return;
      }

      if (s.phase === 'placing') {
        const ready = !!FelicityUI.selected;
        el.innerHTML = `<button id="fel-place" class="btn hud-btn-main gold"${ready ? '' : ' disabled'}>카드<br>놓기</button>`;
        $('fel-place').addEventListener('click', () => {
          if (!FelicityUI.selected) return;
          this.ctx.send({ type: 'game_action', action: { kind: 'place', cardId: FelicityUI.selected } });
          FelicityUI.selected = null;
        });
      } else if (s.phase === 'bidding') {
        const min = s.highBid + 1;
        const max = me ? me.coins : min;
        if (this.bidAmount < min) this.bidAmount = min;
        if (this.bidAmount > max) this.bidAmount = max;
        const canBid = max >= min;
        // 입찰 컨트롤(우측): 금액 설정 박스(상하 화살표) + 입찰 버튼 — 박스 너비를 입찰 버튼과 동일하게
        el.innerHTML = `
          <div class="fel-bidbox">
            <button id="fel-bid-plus" class="fel-bid-arrow"${canBid ? '' : ' disabled'}>▲</button>
            <span id="fel-bid-amt" class="fel-bid-amt">${canBid ? this.bidAmount : '-'}</span>
            <button id="fel-bid-minus" class="fel-bid-arrow"${canBid ? '' : ' disabled'}>▼</button>
          </div>
          <div class="fel-bid-info">최고 ${s.highBid} · 내 ${me ? me.coins : '?'}</div>
          <button id="fel-bid" class="btn hud-btn-main gold"${canBid ? '' : ' disabled'}>입찰</button>`;
        // 패스 버튼(좌측 하단)
        if (elL) elL.innerHTML = `<button id="fel-pass" class="btn hud-btn-main pass">패스</button>`;
        if (canBid) {
          $('fel-bid-minus').addEventListener('click', () => { this.bidAmount = Math.max(min, this.bidAmount - 1); this.refreshControls(); });
          $('fel-bid-plus').addEventListener('click', () => { this.bidAmount = Math.min(max, this.bidAmount + 1); this.refreshControls(); });
          $('fel-bid').addEventListener('click', () => {
            this.ctx.send({ type: 'game_action', action: { kind: 'bid', amount: this.bidAmount } });
          });
        }
        const passBtn = $('fel-pass');
        if (passBtn) passBtn.addEventListener('click', () => {
          this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
        });
      }
    },

    /* ---------- 최종 점수판 ---------- */
    onRoundOver(result) {
      if (!result || !result.scores) return;
      const rows = result.scores.map((s) => {
        const cardCls = s.cardPts > 0 ? 'delta-plus' : s.cardPts < 0 ? 'delta-minus' : '';
        return `<tr class="r${s.rank}"><td>${s.rank}등</td><td>${esc(s.name)}</td>
          <td class="${cardCls}">${s.cardPts}</td><td>🪙${s.coins}</td><td><strong>${s.total}</strong></td></tr>`;
      }).join('');
      const champ = result.scores[0];
      const body = $('fel-result-body');
      body.innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>카드 점수</th><th>남은 코인</th><th>총점</th></tr>${rows}</table>
        <div class="result-champion">🏆 우승: ${esc(champ.name)} (${champ.total}점)</div>`;
      const b = $('fel-result-ready'); if (b) { b.textContent = '다시 하기'; b.disabled = false; }
      window.Modal.open('fel-result-popup');
    },

    closeResult() { window.Modal.close('fel-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('fel-result-popup'); },
  };

  window.Games.register(Felicity);
})();
