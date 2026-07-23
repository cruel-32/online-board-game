/**
 * 렉시오 게임 클라이언트 (플러그인).
 * 게임 화면 HUD·팝업(어시스트/게임룰/결과)·오토패스를 주입하고, 캔버스 렌더러(GameUI)를 구동한다.
 * shell(게임 독립 셸)이 mount/unmount/setState/onRoundOver/renderSetup 를 호출한다.
 */
(function () {
  'use strict';
  const core = window.LexioCore;
  const GameUI = window.GameUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const HUD_HTML = `
    <div class="hud-left">
      <button id="btn-autopass" class="hud-autopass" title="낼 수 있는 패가 없으면 자동으로 패스합니다">오토패스 OFF</button>
      <button id="btn-pass" class="btn hud-btn-main pass">패스</button>
    </div>
    <div class="hud-right">
      <div class="hud-secondary">
        <button id="btn-assist" class="btn hud-btn">조합<br>보기</button>
        <button id="btn-sort" class="btn hud-btn">정렬</button>
        <button id="btn-rules" class="btn hud-btn">게임룰</button>
      </div>
      <button id="btn-play" class="btn hud-btn-main gold" disabled>내기</button>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>자신의 타일을 가장 먼저 모두 내려놓으면 승리합니다.</p>
    <div class="assist-group-title">숫자·무늬 세기</div>
    <p>숫자는 3(가장 낮음) → 4 → … → 15 → 1 → 2(가장 높음) 순으로 강합니다.<br>
    같은 숫자라면 무늬로 비교합니다: 구름 &lt; 별 &lt; 달 &lt; 해.</p>
    <div class="assist-group-title">낼 수 있는 조합</div>
    <ul>
      <li>1장 : 싱글</li><li>2장 : 페어(숫자가 같은 2장)</li><li>3장 : 트리플(숫자가 같은 3장)</li>
      <li>4장은 낼 수 없습니다.</li>
      <li>5장 : 스트레이트 &lt; 플러쉬 &lt; 풀하우스 &lt; 포카드 &lt; 스트레이트플러쉬 순으로 강함</li>
    </ul>
    <div class="assist-group-title">진행 방법</div>
    <p>이전 사람이 낸 것과 <strong>같은 개수</strong>로 <strong>더 높은 조합</strong>만 낼 수 있습니다.
    낼 수 없으면 패스합니다. 모두 패스하면 마지막으로 낸 사람이 선(先)이 되어 원하는 조합을 자유롭게 낼 수 있습니다.</p>
    <div class="assist-group-title">조합별 비교 방법</div>
    <ul>
      <li>싱글·페어·트리플 : 숫자를 먼저 비교하고, 같으면 무늬로 비교</li>
      <li>스트레이트·스트레이트플러쉬 : 구성 숫자를 먼저 비교하고, 완전히 같으면 무늬로 비교</li>
      <li>플러쉬 : 5장의 숫자를 높은 순서대로 차례로 비교하고, 5장이 모두 같을 때만 무늬로 비교</li>
      <li>풀하우스·포카드 : 트리플/포카드를 이루는 숫자로 비교</li>
    </ul>
    <div class="assist-group-title">'2' 페널티</div>
    <p>게임이 끝났을 때 손에 '2'가 남아 있으면 남은 타일 개수를 2배로 계산합니다. (2×2장→4배, 3장→8배)</p>
    <div class="assist-group-title">칩 정산</div>
    <p>모든 플레이어 쌍마다 남은 타일 개수 차이만큼, 더 많이 남긴 쪽이 적게 남긴 쪽에게 칩을 지불합니다.</p>`;

  const POPUPS_HTML = `
    <div id="autopass-notice" class="autopass-notice"></div>
    <div id="assist-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>내 조합 어시스트</h3><button class="popup-close" data-close="assist-popup">✕</button></header>
        <div id="assist-body" class="assist-body"></div>
        <p class="muted small-text">조합을 누르면 해당 타일이 선택됩니다.</p>
      </div>
    </div>
    <div id="rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰</h3><button class="popup-close" data-close="rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="result-title">라운드 결과</h3></header>
        <div id="result-body"></div>
        <div class="popup-actions">
          <button id="btn-result-ready" class="btn gold">준비 완료</button>
          <button id="btn-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Lexio = {
    id: 'lexio',
    name: '렉시오',
    ctx: null,
    state: null,
    hudSlot: null,
    injected: [],
    autoPassEnabled: localStorage.getItem('lexio.autoPass') === '1',
    autoPassTimer: null,
    autoPassNoticeTimer: null,

    /* ---------- 대기실/로비 설정 UI (칩 개수) ---------- */
    renderSetup(container, room, { isHost, send }) {
      const chips = (room.options && room.options.chips) || 50;
      container.innerHTML = `
        <div class="field inline">
          <span>칩 개수</span>
          <div class="stepper">
            <button class="btn tiny" data-chips="-10"${isHost ? '' : ' disabled'}>−10</button>
            <span class="stepper-value">${chips}</span>
            <button class="btn tiny" data-chips="10"${isHost ? '' : ' disabled'}>+10</button>
          </div>
        </div>`;
      if (!isHost) return;
      container.querySelectorAll('[data-chips]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cur = (room.options && room.options.chips) || 50;
          const next = Math.max(50, cur + Number(btn.dataset.chips));
          send({ type: 'set_option', key: 'chips', value: next });
        });
      });
    },

    /* ---------- 마운트/언마운트 ---------- */
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
        GameUI.init(canvas, { onSelectionChange: () => this.updateHudButtons() });
      } else {
        GameUI.callbacks = { onSelectionChange: () => this.updateHudButtons() };
        GameUI.resize && GameUI.resize();
      }

      this._wire();
    },

    unmount() {
      clearTimeout(this.autoPassTimer);
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      GameUI.state = null;
      this.state = null;
    },

    topBarText(state) {
      return `${state.roomName} · ${state.roundNo}라운드`;
    },

    setState(state) {
      const prev = this.state;
      this.state = state;
      this._playDiffSounds(prev, state);
      GameUI.setState(state);
      this.updateHudButtons();
      this.maybeAutoPass();
    },

    bubbleAnchor(id) {
      return GameUI.bubbleAnchor(id);
    },

    /* ---------- 이벤트 배선 ---------- */
    _wire() {
      $('btn-play').addEventListener('click', () => {
        if (!GameUI.canPlaySelection()) return;
        this.ctx.send({ type: 'game_action', action: { kind: 'play', tileIds: [...GameUI.selected] } });
        GameUI.selected.clear();
      });
      $('btn-pass').addEventListener('click', () => {
        clearTimeout(this.autoPassTimer);
        this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
        GameUI.selected.clear();
      });
      $('btn-sort').addEventListener('click', () => GameUI.sortHand());
      $('btn-assist').addEventListener('click', () => { this.renderAssist(); window.Modal.open('assist-popup'); });
      $('btn-rules').addEventListener('click', () => window.Modal.open('rules-popup'));

      const apBtn = $('btn-autopass');
      const syncAutoPass = () => {
        apBtn.textContent = '오토패스 ' + (this.autoPassEnabled ? 'ON' : 'OFF');
        apBtn.classList.toggle('on', this.autoPassEnabled);
      };
      syncAutoPass();
      apBtn.addEventListener('click', () => {
        this.autoPassEnabled = !this.autoPassEnabled;
        localStorage.setItem('lexio.autoPass', this.autoPassEnabled ? '1' : '0');
        syncAutoPass();
        this.maybeAutoPass();
      });

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

    /* ---------- HUD ---------- */
    updateHudButtons() {
      if (!this.state) return;
      const s = this.state;
      const myTurn = s.turnId === s.you && !s.finished;
      const pass = $('btn-pass'), play = $('btn-play');
      if (pass) pass.disabled = !(myTurn && s.table);
      if (play) play.disabled = !GameUI.canPlaySelection();
    },

    /* ---------- 오토패스 ---------- */
    showAutoPassNotice(msg) {
      const el = $('autopass-notice');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.autoPassNoticeTimer);
      this.autoPassNoticeTimer = setTimeout(() => el.classList.remove('show'), 1200);
    },
    maybeAutoPass() {
      clearTimeout(this.autoPassTimer);
      const s = this.state;
      if (!this.autoPassEnabled || !s) return;
      const myTurn = s.turnId === s.you && !s.finished;
      if (!myTurn || !s.table) return;
      if (!GameUI.playable || GameUI.playable.size > 0) return;
      this.showAutoPassNotice('낼 수 있는 패가 없어 자동으로 패스합니다');
      this.autoPassTimer = setTimeout(() => {
        const st = this.state;
        const still = st && st.turnId === st.you && !st.finished;
        if (this.autoPassEnabled && still && st.table && GameUI.playable && GameUI.playable.size === 0) {
          this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
          GameUI.selected.clear();
        }
      }, 1000);
    },

    /* ---------- 어시스트 팝업 ---------- */
    _miniTileHtml(t) {
      const top = t.num === 2 ? ' mini-tile-top' : '';
      return `<span class="mini-tile ${t.suit}${top}">${t.num}<small>${core.SUIT_SYMBOL[t.suit]}</small></span>`;
    },
    renderAssist() {
      if (!this.state) return;
      const body = $('assist-body');
      body.innerHTML = '';
      const hand = this.state.hand;
      const maxN = this.state.maxN;
      const myTurn = GameUI.isMyTurn();
      const cur = GameUI.currentCombo();
      const groupsDef = [
        ['pair', '페어'], ['triple', '트리플'], ['straight', '스트레이트'], ['flush', '플러쉬'],
        ['fullhouse', '풀하우스'], ['four', '포카드'], ['straightflush', '스트레이트플러쉬'],
      ];
      let all = [];
      for (const c of [2, 3, 5]) all = all.concat(core.enumeratePlays(hand, c, maxN));
      let any = false;
      for (const [type, label] of groupsDef) {
        const combos = all.filter((c) => c.type === type);
        if (!combos.length) continue;
        any = true;
        combos.sort((a, b) => core.cmpRank(a.rank, b.rank));
        const title = document.createElement('div');
        title.className = 'assist-group-title';
        title.textContent = `${label} (${combos.length})`;
        body.appendChild(title);
        for (const c of combos.slice(0, 30)) {
          const row = document.createElement('div');
          const playable = !myTurn || !cur || (c.count === cur.count && core.beats(c, cur));
          row.className = 'assist-row' + (playable ? '' : ' assist-row-disabled');
          row.innerHTML = c.tiles.map((t) => this._miniTileHtml(t)).join('');
          row.addEventListener('click', () => {
            GameUI.selectTiles(c.tiles.map((t) => t.id));
            window.Modal.close('assist-popup');
            this.updateHudButtons();
          });
          body.appendChild(row);
        }
        if (combos.length > 30) {
          const more = document.createElement('div');
          more.className = 'assist-empty';
          more.textContent = `… 외 ${combos.length - 30}개`;
          body.appendChild(more);
        }
      }
      if (!any) body.innerHTML = '<div class="assist-empty">만들 수 있는 조합(2개 이상)이 없습니다. 싱글로 승부하세요!</div>';
    },

    /* ---------- 결과 팝업 ---------- */
    onRoundOver(result) {
      $('result-title').textContent = result.matchOver
        ? `🏁 매치 종료 (${result.roundNo}라운드)`
        : `${result.roundNo}라운드 결과`;
      const body = $('result-body');
      const rows = result.rows.map((r) => {
        const deltaCls = r.delta > 0 ? 'delta-plus' : r.delta < 0 ? 'delta-minus' : '';
        const deltaTxt = (r.delta > 0 ? '+' : '') + r.delta;
        const twoNote = r.twos ? ` (2×${r.twos} → ${r.eff}장 계산)` : '';
        return `<tr class="r${r.rank}"><td>${r.rank}등</td><td>${esc(r.name)}</td>
          <td>${r.remaining}장${twoNote}</td><td class="${deltaCls}">${deltaTxt}</td><td>${r.chips}</td></tr>`;
      }).join('');
      let extra = '';
      if (result.matchOver) {
        const champion = result.rows.slice().sort((a, b) => b.chips - a.chips)[0];
        extra = `<div class="result-busted">💥 칩 소진: ${result.bustedNames.map(esc).join(', ')}</div>
                 <div class="result-champion">🏆 최다 칩 보유: ${esc(champion.name)} (${champion.chips}점)</div>`;
      }
      body.innerHTML = `<table class="result-table">
        <tr><th>순위</th><th>이름</th><th>남은 타일</th><th>칩 변동</th><th>보유 칩</th></tr>${rows}</table>${extra}`;
      $('btn-result-ready').textContent = result.matchOver ? '다시 게임 준비' : '준비 완료';
      $('btn-result-ready').disabled = false;
      $('btn-result-room').style.display = result.matchOver ? 'block' : 'none';
      window.Modal.open('result-popup');
    },

    // shell이 새 게임 상태를 받으면 결과 팝업을 닫도록 함
    closeResult() { window.Modal.close('result-popup'); },
    isResultOpen() { return window.Modal.isOpen('result-popup'); },

    /* ---------- 효과음 ---------- */
    _playDiffSounds(prev, next) {
      const Sound = window.Sound;
      if (!Sound) return;
      const sameContext = prev && prev.roomId === next.roomId && prev.roundNo === next.roundNo;
      const myTurnNow = next.turnId === next.you && !next.finished;
      const myTurnBefore = sameContext && prev.turnId === prev.you && !prev.finished;
      if (myTurnNow && !myTurnBefore) Sound.myTurn();
      if (!sameContext) return;
      const nt = next.table, pt = prev.table;
      if (nt && (!pt || pt.byId !== nt.byId || pt.tiles.length !== nt.tiles.length ||
          pt.tiles.map((t) => t.id).join() !== nt.tiles.map((t) => t.id).join())) {
        Sound.play();
        return;
      }
      const prevPassed = new Map(prev.players.map((p) => [p.id, p.passed]));
      for (const p of next.players) {
        if (p.passed && !prevPassed.get(p.id)) { Sound.pass(); return; }
      }
    },
  };

  window.Games.register(Lexio);
})();
