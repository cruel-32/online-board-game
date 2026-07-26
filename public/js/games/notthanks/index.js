/**
 * 노땡스 게임 클라이언트 (플러그인).
 * 게임 화면 HUD·팝업(게임룰/결과)을 주입하고, 캔버스 렌더러(NoThanksUI)를 구동한다.
 * shell(게임 독립 셸)이 mount/unmount/setState/onRoundOver/renderSetup 를 호출한다.
 * 모은 카드는 노땡스 규칙상 전체공개 정보이므로, 캔버스에 모든 플레이어의 카드를 실제로 표시한다
 * (별도 "내 카드함" 팝업은 두지 않는다).
 */
(function () {
  'use strict';
  const GameUI = window.NoThanksUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const HUD_HTML = `
    <div class="hud-left">
      <button id="btn-pass" class="btn hud-btn-main pass">칩 걸기</button>
    </div>
    <div class="hud-right">
      <div class="hud-secondary">
        <button id="btn-rules" class="btn hud-btn">게임룰</button>
      </div>
      <button id="btn-take" class="btn hud-btn-main gold">가져<br>가기</button>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>게임이 끝났을 때 점수가 가장 낮은 사람이 승리합니다.</p>
    <div class="assist-group-title">준비</div>
    <p>3~35 숫자 카드 33장 중 9장을 보지 않고 제외한 24장으로 진행합니다. 각자 칩을 11개(5인 게임은 9개)씩 받습니다.</p>
    <div class="assist-group-title">진행 방법</div>
    <p>자기 차례에 다음 중 하나를 선택합니다.</p>
    <ul>
      <li><strong>칩 걸기</strong> : 칩을 1개 내고 카드를 다음 사람에게 넘깁니다. (칩이 없으면 선택할 수 없습니다)</li>
      <li><strong>카드 가져가기</strong> : 카드와 그 위에 쌓인 칩을 모두 가져옵니다. 그 후 덱에서 새 카드를 뒤집어 <strong>내가 다시</strong> 선택합니다.</li>
    </ul>
    <div class="assist-group-title">점수 계산</div>
    <p>모은 카드 숫자를 더하되, <strong>연속된 숫자는 가장 낮은 숫자만</strong> 계산합니다. (예: 5·6·7·8을 모두 모으면 5만 더함)<br>
    여기서 <strong>남은 칩 개수만큼 점수를 뺍니다.</strong> 칩은 1개당 1점을 깎아주므로 많이 남을수록 유리합니다.</p>
    <div class="assist-group-title">종료</div>
    <p>덱의 24장을 모두 가져가면 게임이 끝나고 곧바로 점수를 정산합니다.</p>`;

  const POPUPS_HTML = `
    <div id="rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰</h3><button class="popup-close" data-close="rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="result-title">게임 결과</h3></header>
        <div id="result-body"></div>
        <div class="popup-actions">
          <button id="btn-result-ready" class="btn gold">다시 게임 준비</button>
          <button id="btn-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const NotThanks = {
    id: 'notthanks',
    name: '노땡스',
    ctx: null,
    state: null,
    hudSlot: null,
    injected: [],

    renderSetup(container) {
      container.innerHTML = `<p class="muted small-text">노땡스는 3~5인 · 별도 설정이 없습니다(시작 칩은 인원수에 따라 자동 결정).</p>`;
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

      if (!GameUI.canvas) {
        GameUI.init(canvas, {});
      } else {
        GameUI.callbacks = {};
        GameUI.resize && GameUI.resize();
      }

      this._wire();
    },

    unmount() {
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      GameUI.state = null;
      this.state = null;
    },

    topBarText(state) {
      return `${state.roomName} · 노땡스`;
    },

    setState(state) {
      const prev = this.state;
      this.state = state;
      GameUI.setState(state);
      this._playDiffSounds(prev, state);
      this.updateHudButtons();
    },

    bubbleAnchor(id) {
      return GameUI.bubbleAnchor(id);
    },

    _wire() {
      $('btn-take').addEventListener('click', () => {
        if (!this.state || this.state.turnId !== this.state.you) return;
        this.ctx.send({ type: 'game_action', action: { kind: 'take' } });
      });
      $('btn-pass').addEventListener('click', () => {
        if (!this.state || this.state.turnId !== this.state.you) return;
        this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
      });
      $('btn-rules').addEventListener('click', () => window.Modal.open('rules-popup'));

      $('btn-result-ready').addEventListener('click', () => {
        this.ctx.send({ type: 'ready', ready: true });
        $('btn-result-ready').textContent = '다른 플레이어 대기 중…';
        $('btn-result-ready').disabled = true;
        setTimeout(() => { const b = $('btn-result-ready'); if (b) b.disabled = false; }, 1500);
      });
      $('btn-result-room').addEventListener('click', () => {
        window.Modal.close('result-popup');
        this.ctx.showScreen('room');
      });
    },

    updateHudButtons() {
      if (!this.state) return;
      const s = this.state;
      const me = s.players.find((p) => p.id === s.you);
      const myTurn = s.turnId === s.you && !s.finished;
      const pass = $('btn-pass'), take = $('btn-take');
      if (pass) pass.disabled = !(myTurn && me && me.chips > 0);
      if (take) take.disabled = !myTurn;
    },

    /* ---------- 결과 팝업 ---------- */
    onRoundOver(result) {
      $('result-title').textContent = `🏁 게임 결과`;
      const body = $('result-body');
      const rows = result.rows.map((r) => {
        const cardsTxt = r.cards.length ? r.cards.slice().sort((a, b) => a - b).join(', ') : '-';
        return `<tr class="r${r.rank}"><td>${r.rank}등</td><td>${esc(r.name)}</td>
          <td>${cardsTxt}</td><td>${r.cardSum}</td><td>${r.chips}</td><td>${r.score}</td></tr>`;
      }).join('');
      body.innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>모은 카드</th><th>카드합</th><th>칩</th><th>점수</th></tr>${rows}</table>
        <div class="result-champion">🏆 우승: ${esc(result.winnerName)}</div>`;
      $('btn-result-ready').disabled = false;
      $('btn-result-room').style.display = 'none';
      window.Modal.open('result-popup');
    },

    closeResult() { window.Modal.close('result-popup'); },
    isResultOpen() { return window.Modal.isOpen('result-popup'); },

    /* ---------- 효과음 & 애니메이션 ---------- */
    _playDiffSounds(prev, next) {
      const Sound = window.Sound;
      const sameContext = prev && prev.roomId === next.roomId && prev.roundNo === next.roundNo;
      const myTurnNow = next.turnId === next.you && !next.finished;
      const myTurnBefore = sameContext && prev.turnId === prev.you && !prev.finished;
      if (myTurnNow && !myTurnBefore && Sound) Sound.myTurn();
      if (!sameContext || !next.lastAction || prev.seq === next.seq) return;

      const la = next.lastAction;
      if (la.type === 'take') {
        GameUI.startTakeAnim(la.id, la.card, next.seq);
        if (Sound) {
          if (la.pot > 0) { Sound.slam(); Sound.chip(); }
          else Sound.play();
        }
      } else if (la.type === 'pass') {
        GameUI.startChipAnim(la.id, next.seq);
        if (Sound) Sound.chip();
      }
    },
  };

  window.Games.register(NotThanks);
})();
