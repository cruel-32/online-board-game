/**
 * 티츄 게임 클라이언트 (플러그인).
 * 게임 화면 HUD·팝업(그랜드티츄/카드나눔/소원/드래곤증정/게임룰/결과)을 주입하고,
 * 캔버스 렌더러(TichuUI)를 구동한다. shell(게임 독립 셸)이 mount/unmount/setState/onRoundOver 를 호출한다.
 */
(function () {
  'use strict';
  const core = window.TichuCore;
  const TichuUI = window.TichuUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const HUD_HTML = `
    <div class="hud-left">
      <button id="tichu-btn-autopass" class="hud-autopass" title="낼 수 있는 패가 없으면 자동으로 패스합니다">오토패스<br><span class="ap-state">OFF</span></button>
      <button id="tichu-btn-pass" class="btn hud-btn-main pass">패스</button>
    </div>
    <div class="hud-right">
      <div class="hud-secondary">
        <button id="tichu-btn-assist" class="btn hud-btn">조합<br>보기</button>
        <button id="tichu-btn-rules" class="btn hud-btn">게임룰</button>
      </div>
      <button id="tichu-btn-play" class="btn hud-btn-main gold" disabled>내기</button>
    </div>
    <div id="tichu-my-actions" class="hud-my-actions">
      <button id="tichu-btn-sort" class="btn tiny">정렬</button>
      <button id="tichu-btn-deselect" class="btn tiny" disabled>선택해제</button>
      <button id="tichu-btn-tichu" class="btn tiny gold" disabled>티츄!</button>
    </div>`;

  const RULES_HTML = `
    <div class="assist-group-title">목표</div>
    <p>4인 2팀(맞은편 파트너)으로 진행합니다. 손에 든 카드를 가장 먼저 모두 내려놓으세요.</p>
    <div class="assist-group-title">그랜드 티츄 / 티츄</div>
    <p>처음 8장만 보고 <b>그랜드 티츄</b>(성공 +200 / 실패 -200)를 선언할 수 있습니다.
    나머지 6장을 받은 뒤에도 자신의 첫 카드를 내기 전까지 <b>티츄</b>(성공 +100 / 실패 -100)를 선언할 수 있습니다.</p>
    <div class="assist-group-title">카드 나눔</div>
    <p>14장을 받으면 왼쪽·오른쪽·파트너에게 한 장씩(총 3장) 나눠주고, 동시에 받습니다.</p>
    <div class="assist-group-title">조합</div>
    <ul>
      <li>싱글 / 페어 / 트리플 / 풀하우스(트리플+페어)</li>
      <li>스트레이트(5장 이상 연속) / 계단(연속 페어, 4장 이상 짝수)</li>
      <li>봄(폭탄): 같은 숫자 4장, 또는 같은 무늬 연속 5장 이상 — 무엇이든 이깁니다</li>
    </ul>
    <div class="assist-group-title">특수 카드</div>
    <ul>
      <li><b>마작</b>(1): 가장 먼저 리드하며, 낼 때 원하는 숫자를 소원으로 걸 수 있습니다.</li>
      <li><b>불사조</b>: 조합에서 와일드카드로 사용되며, 싱글로 낼 땐 직전 카드보다 0.5 높게 이깁니다.</li>
      <li><b>드래곤</b>: 가장 강한 싱글. 이 카드로 트릭을 이기면 그 트릭을 상대팀에게 반드시 줘야 합니다.</li>
      <li><b>개</b>: 리드로만 낼 수 있고, 점수 없이 파트너에게 턴을 즉시 넘깁니다.</li>
    </ul>
    <div class="assist-group-title">점수</div>
    <p>5=5점, 10·K=10점, 드래곤=+25점, 불사조=-25점. 한 팀의 두 명이 1·2등을 하면 <b>더블윈</b>(+200점, 카드 점수 무시).
    아니면 마지막 남은 사람의 손패 점수는 상대팀에게, 그가 모은 트릭 점수는 1등에게 돌아갑니다.</p>`;

  const POPUPS_HTML = `
    <div id="tichu-autopass-notice" class="autopass-notice"></div>
    <div id="tichu-grand-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>그랜드 티츄?</h3></header>
        <p class="muted small-text">처음 8장만 보고 결정합니다. 성공하면 <b>+200점</b>, 실패하면 <b>-200점</b>.</p>
        <div id="tichu-grand-cards" class="tichu-card-row"></div>
        <div class="popup-actions">
          <button id="tichu-grand-yes" class="btn gold">그랜드 티츄!</button>
          <button id="tichu-grand-no" class="btn">그냥 진행</button>
        </div>
      </div>
    </div>
    <div id="tichu-exchange-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>카드 나눔</h3><button id="tichu-exchange-assist-btn" class="btn tiny">조합보기</button></header>
        <p class="muted small-text">대상을 먼저 누르고, 줄 카드를 눌러 배정하세요. 배정된 카드를 다시 누르면 취소됩니다.</p>
        <div class="tichu-exchange-targets">
          <button class="tichu-target" data-target="left"><span class="tichu-target-label">왼쪽</span><span id="tichu-slot-left" class="tichu-slot">?</span></button>
          <button class="tichu-target" data-target="partner"><span class="tichu-target-label">파트너</span><span id="tichu-slot-partner" class="tichu-slot">?</span></button>
          <button class="tichu-target" data-target="right"><span class="tichu-target-label">오른쪽</span><span id="tichu-slot-right" class="tichu-slot">?</span></button>
        </div>
        <div id="tichu-exchange-cards" class="tichu-card-row"></div>
        <div class="popup-actions">
          <button id="tichu-exchange-submit" class="btn gold" disabled>제출</button>
        </div>
      </div>
    </div>
    <div id="tichu-wish-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>마작 소원</h3></header>
        <p class="muted small-text">다음에 낼 수 있는 사람은 이 숫자가 포함된 패를 우선 내야 합니다.</p>
        <div id="tichu-wish-grid" class="tichu-wish-grid"></div>
        <div class="popup-actions">
          <button id="tichu-wish-none" class="btn">소원 없음</button>
        </div>
      </div>
    </div>
    <div id="tichu-dragon-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3>드래곤 증정</h3></header>
        <p class="muted small-text">드래곤으로 이긴 트릭은 상대팀에게 반드시 넘겨야 합니다.</p>
        <div id="tichu-dragon-options" class="popup-actions"></div>
      </div>
    </div>
    <div id="tichu-assist-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>내 조합 어시스트</h3><button class="popup-close" data-close="tichu-assist-popup">✕</button></header>
        <div id="tichu-assist-body" class="assist-body"></div>
        <p class="muted small-text">조합을 누르면 해당 카드가 선택됩니다.</p>
      </div>
    </div>
    <div id="tichu-rules-popup" class="popup dismissable hidden">
      <div class="popup-inner panel">
        <header><h3>게임룰</h3><button class="popup-close" data-close="tichu-rules-popup">✕</button></header>
        <div class="assist-body rules-body">${RULES_HTML}</div>
      </div>
    </div>
    <div id="tichu-result-popup" class="popup hidden">
      <div class="popup-inner panel">
        <header><h3 id="tichu-result-title">핸드 결과</h3></header>
        <div id="tichu-result-body"></div>
        <div class="popup-actions">
          <button id="tichu-result-ready" class="btn gold">준비 완료</button>
          <button id="tichu-result-room" class="btn">대기실로</button>
        </div>
      </div>
    </div>`;

  const Tichu = {
    id: 'tichu',
    name: '티츄',
    ctx: null,
    state: null,
    hudSlot: null,
    injected: [],
    _exchange: { activeTarget: 'left', assign: { left: null, right: null, partner: null } },
    autoPassEnabled: localStorage.getItem('tichu.autoPass') === '1',
    autoPassTimer: null,
    autoPassNoticeTimer: null,

    /* ---------- 대기실 설정 UI (목표 점수 + 팀 배정) ---------- */
    renderSetup(container, room, { isHost, send }) {
      const target = (room.options && room.options.targetScore) || 1000;
      const canControl = (p) => p.id === room.you || isHost;
      const countOf = (team) => room.players.filter((p) => p.team === team).length;

      const teamColHtml = (team) => {
        const members = room.players.filter((p) => p.team === team);
        const rows = members.map((p) => `
          <div class="tichu-team-member">
            <span>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</span>
            ${canControl(p) ? `<button class="btn tiny" data-leave-team="${p.id}">빼기</button>` : ''}
          </div>`).join('') || '<div class="muted small-text">비어있음</div>';
        return `<div class="tichu-team-col">
          <div class="tichu-team-title">${team}팀 (${members.length}/2)</div>
          ${rows}
        </div>`;
      };

      const unassigned = room.players.filter((p) => !p.team);
      const unassignedHtml = unassigned.map((p) => {
        const row = [`<span>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</span>`];
        if (canControl(p)) {
          row.push(`<button class="btn tiny" data-join-team="A:${p.id}"${countOf('A') >= 2 ? ' disabled' : ''}>A팀</button>`);
          row.push(`<button class="btn tiny" data-join-team="B:${p.id}"${countOf('B') >= 2 ? ' disabled' : ''}>B팀</button>`);
        }
        return `<div class="tichu-unassigned-row">${row.join('')}</div>`;
      }).join('');

      container.innerHTML = `
        <div class="field inline">
          <span>목표 점수</span>
          <div class="stepper">
            <button class="btn tiny" data-score="-100"${isHost ? '' : ' disabled'}>−100</button>
            <span class="stepper-value">${target}</span>
            <button class="btn tiny" data-score="100"${isHost ? '' : ' disabled'}>+100</button>
          </div>
        </div>
        <div class="tichu-teams">${teamColHtml('A')}${teamColHtml('B')}</div>
        ${unassigned.length ? `<div class="tichu-unassigned"><div class="tichu-team-title">미배정</div>${unassignedHtml}</div>` : ''}`;

      container.querySelectorAll('[data-score]').forEach((btn) => {
        btn.addEventListener('click', () => {
          send({ type: 'set_option', key: 'targetScore', value: Math.max(100, target + Number(btn.dataset.score)) });
        });
      });
      container.querySelectorAll('[data-join-team]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [team, playerId] = btn.dataset.joinTeam.split(':');
          send({ type: 'set_team', team, playerId });
        });
      });
      container.querySelectorAll('[data-leave-team]').forEach((btn) => {
        btn.addEventListener('click', () => send({ type: 'set_team', team: null, playerId: btn.dataset.leaveTeam }));
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

      const callbacks = {
        onSelectionChange: () => this.updateHudButtons(),
        onLayout: () => this.repositionMyActions(),
      };
      if (!TichuUI.canvas) TichuUI.init(canvas, callbacks);
      else { TichuUI.callbacks = callbacks; TichuUI.resize && TichuUI.resize(); }

      this._wire();
      this.repositionMyActions();
    },

    unmount() {
      clearTimeout(this.autoPassTimer);
      this.injected.forEach((el) => el.remove());
      this.injected = [];
      if (this.hudSlot) this.hudSlot.innerHTML = '';
      TichuUI.state = null;
      this.state = null;
    },

    topBarText(state) {
      return `${state.roomName} · ${state.roundNo}핸드`;
    },

    bubbleAnchor(id) {
      return TichuUI.bubbleAnchor(id);
    },

    repositionMyActions() {
      const el = $('tichu-my-actions');
      if (!el) return;
      const a = TichuUI.myInfoAnchor();
      if (!a) return;
      el.style.left = `${a.x}px`;
      el.style.top = `${a.y}px`;
    },

    setState(state) {
      const prev = this.state;
      this.state = state;
      TichuUI.setState(state);
      this._playDiffSounds(prev, state);
      this.updateHudButtons();
      this.repositionMyActions();

      this._syncPopup('tichu-grand-popup', !!state.grandPending, () => this.openGrandPopup(state.hand));
      this._syncPopup('tichu-exchange-popup', !!state.exchangeNeeded, () => this.openExchangePopup(state.hand));
      this._syncPopup('tichu-wish-popup', state.pendingWish === state.you, () => this.openWishPopup());
      this._syncPopup('tichu-dragon-popup', state.pendingDragonGive === state.you, () => this.openDragonPopup(state.dragonGiveOptions || []));
      this.maybeAutoPass();
    },

    _syncPopup(id, shouldBeOpen, openFn) {
      const isOpen = window.Modal.isOpen(id);
      if (shouldBeOpen && !isOpen) openFn();
      else if (!shouldBeOpen && isOpen) window.Modal.close(id);
    },

    /* ---------- 이벤트 배선 ---------- */
    _wire() {
      $('tichu-btn-play').addEventListener('click', () => {
        if (!TichuUI.canPlaySelection()) return;
        this.ctx.send({ type: 'game_action', action: { kind: 'play', cardIds: [...TichuUI.selected] } });
        TichuUI.selected.clear();
      });
      $('tichu-btn-pass').addEventListener('click', () => {
        clearTimeout(this.autoPassTimer);
        this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
      });
      $('tichu-btn-deselect').addEventListener('click', () => TichuUI.clearSelection());
      $('tichu-btn-sort').addEventListener('click', () => TichuUI.sortHand());
      $('tichu-btn-tichu').addEventListener('click', () => {
        this.ctx.send({ type: 'game_action', action: { kind: 'tichu' } });
      });
      $('tichu-btn-rules').addEventListener('click', () => window.Modal.open('tichu-rules-popup'));

      const apBtn = $('tichu-btn-autopass');
      const syncAutoPass = () => {
        apBtn.innerHTML = '오토패스<br><span class="ap-state">' + (this.autoPassEnabled ? 'ON' : 'OFF') + '</span>';
        apBtn.classList.toggle('on', this.autoPassEnabled);
      };
      syncAutoPass();
      apBtn.addEventListener('click', () => {
        this.autoPassEnabled = !this.autoPassEnabled;
        localStorage.setItem('tichu.autoPass', this.autoPassEnabled ? '1' : '0');
        syncAutoPass();
        this.maybeAutoPass();
      });
      $('tichu-btn-assist').addEventListener('click', () => { this.renderAssist(); window.Modal.open('tichu-assist-popup'); });

      $('tichu-grand-yes').addEventListener('click', () => {
        this.ctx.send({ type: 'game_action', action: { kind: 'grand_tichu', declare: true } });
        window.Modal.close('tichu-grand-popup');
      });
      $('tichu-grand-no').addEventListener('click', () => {
        this.ctx.send({ type: 'game_action', action: { kind: 'grand_tichu', declare: false } });
        window.Modal.close('tichu-grand-popup');
      });

      $('tichu-exchange-popup').querySelectorAll('.tichu-target').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._exchange.activeTarget = btn.dataset.target;
          this._renderExchangePopup();
        });
      });
      // 카드 나눔 중에도 내 손패로 만들 수 있는 조합을 미리 볼 수 있게(어떤 카드를 남길지 판단에 도움).
      // 어시스트 팝업이 카드 나눔 팝업 "위에" 뜨고, 닫으면 나눔 화면이 그대로 남아 있다.
      $('tichu-exchange-assist-btn').addEventListener('click', () => {
        this.renderAssist();
        window.Modal.open('tichu-assist-popup');
      });
      $('tichu-exchange-submit').addEventListener('click', () => {
        const { assign } = this._exchange;
        this.ctx.send({ type: 'game_action', action: { kind: 'exchange', gives: { left: assign.left, right: assign.right, partner: assign.partner } } });
        window.Modal.close('tichu-exchange-popup');
      });

      $('tichu-wish-none').addEventListener('click', () => {
        this.ctx.send({ type: 'game_action', action: { kind: 'wish', rank: null } });
        window.Modal.close('tichu-wish-popup');
      });

      $('tichu-result-ready').addEventListener('click', () => {
        this.ctx.send({ type: 'ready', ready: true });
        $('tichu-result-ready').textContent = '다른 플레이어 대기 중…';
        $('tichu-result-ready').disabled = true;
        setTimeout(() => { const b = $('tichu-result-ready'); if (b) b.disabled = false; }, 1500);
      });
      $('tichu-result-room').addEventListener('click', () => {
        window.Modal.close('tichu-result-popup');
        this.ctx.showScreen('room');
      });
    },

    /* ---------- HUD ---------- */
    updateHudButtons() {
      if (!this.state) return;
      const s = this.state;
      const myTurn = s.turnId === s.you && !s.finished && s.phase === 'trick' && !s.pendingWish && !s.pendingDragonGive;
      const pass = $('tichu-btn-pass'), play = $('tichu-btn-play');
      const deselect = $('tichu-btn-deselect'), tichuBtn = $('tichu-btn-tichu');
      if (pass) pass.disabled = !(myTurn && s.table);
      if (play) play.disabled = !TichuUI.canPlaySelection();
      if (deselect) deselect.disabled = TichuUI.selected.size === 0;
      if (tichuBtn) tichuBtn.disabled = !s.canDeclareTichu;
    },

    /* ---------- 오토패스 ---------- */
    showAutoPassNotice(msg) {
      const el = $('tichu-autopass-notice');
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
      const myTurn = s.turnId === s.you && !s.finished && s.phase === 'trick';
      if (!myTurn || !s.table) return;
      if (!TichuUI.playable || TichuUI.playable.size > 0) return;
      this.showAutoPassNotice('낼 수 있는 패가 없어 자동으로 패스합니다');
      this.autoPassTimer = setTimeout(() => {
        const st = this.state;
        const still = st && st.turnId === st.you && !st.finished && st.phase === 'trick';
        if (this.autoPassEnabled && still && st.table && TichuUI.playable && TichuUI.playable.size === 0) {
          this.ctx.send({ type: 'game_action', action: { kind: 'pass' } });
        }
      }, 1000);
    },

    /* ---------- 미니 카드 표시 ---------- */
    _miniCardHtml(c) {
      if (!c) return '';
      if (c.special) {
        const glyph = { dog: '🐶', mahjong: '㊀', phoenix: '🔥', dragon: '🐉' }[c.special];
        return `<span class="mini-tile plain">${glyph}</span>`;
      }
      return `<span class="mini-tile ${c.suit}">${core.rankLabel(c.rank)}<small>${core.SUIT_SYMBOL[c.suit]}</small></span>`;
    },

    /* ---------- 조합보기(어시스트) 팝업 ---------- */
    renderAssist() {
      if (!this.state) return;
      const body = $('tichu-assist-body');
      body.innerHTML = '';
      const hand = this.state.hand;
      const myTurn = TichuUI.isMyTurn() && this.state.phase === 'trick' &&
        !this.state.pendingWish && !this.state.pendingDragonGive;
      const cur = this.state.table
        ? { type: this.state.table.type, length: this.state.table.length, isBomb: this.state.table.isBomb, rank: this.state.table.rank }
        : null;
      const groupTypes = ['pair', 'triple', 'fullhouse', 'straight', 'stairs', 'bomb4', 'bombflush'];
      const all = core.enumerateAllCombos(hand).filter((c) => c.type !== 'single');
      let any = false;
      for (const type of groupTypes) {
        const combos = all.filter((c) => c.type === type);
        if (!combos.length) continue;
        any = true;
        combos.sort((a, b) => a.rank - b.rank);
        const title = document.createElement('div');
        title.className = 'assist-group-title';
        title.textContent = `${core.TYPE_LABEL[type]} (${combos.length})`;
        body.appendChild(title);
        for (const c of combos.slice(0, 30)) {
          const row = document.createElement('div');
          const playable = !myTurn || core.beats(c, cur);
          row.className = 'assist-row' + (playable ? '' : ' assist-row-disabled');
          row.innerHTML = c.cards.map((card) => this._miniCardHtml(card)).join('');
          row.addEventListener('click', () => {
            TichuUI.selectCards(c.cards.map((card) => card.id));
            window.Modal.close('tichu-assist-popup');
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
      if (!any) body.innerHTML = '<div class="assist-empty">만들 수 있는 조합(2장 이상)이 없습니다. 싱글로 승부하세요!</div>';
    },

    /* ---------- 그랜드 티츄 팝업 ---------- */
    openGrandPopup(hand) {
      $('tichu-grand-cards').innerHTML = hand.map((c) => this._miniCardHtml(c)).join('');
      window.Modal.open('tichu-grand-popup');
    },

    /* ---------- 카드 나눔 팝업 ---------- */
    openExchangePopup(hand) {
      this._exchange = { activeTarget: 'left', assign: { left: null, right: null, partner: null } };
      this._renderExchangePopup();
      window.Modal.open('tichu-exchange-popup');
    },

    _renderExchangePopup() {
      const hand = this.state.hand;
      const st = this._exchange;
      for (const t of ['left', 'partner', 'right']) {
        const slot = $('tichu-slot-' + t);
        const cardId = st.assign[t];
        slot.innerHTML = cardId ? this._miniCardHtml(hand.find((c) => c.id === cardId)) : '?';
        $('tichu-exchange-popup').querySelector(`[data-target="${t}"]`).classList.toggle('active', st.activeTarget === t);
      }
      const assignedIds = new Set(Object.values(st.assign).filter(Boolean));
      const cardsEl = $('tichu-exchange-cards');
      cardsEl.innerHTML = '';
      for (const c of hand) {
        const el = document.createElement('button');
        el.className = 'tichu-card-btn' + (assignedIds.has(c.id) ? ' picked' : '');
        el.innerHTML = this._miniCardHtml(c);
        el.addEventListener('click', () => this._onExchangeCardClick(c.id));
        cardsEl.appendChild(el);
      }
      const vals = [st.assign.left, st.assign.right, st.assign.partner];
      const allSet = vals.every(Boolean) && new Set(vals).size === 3;
      $('tichu-exchange-submit').disabled = !allSet;
    },

    _onExchangeCardClick(cardId) {
      const st = this._exchange;
      for (const t of ['left', 'partner', 'right']) {
        if (st.assign[t] === cardId) { st.assign[t] = null; this._renderExchangePopup(); return; }
      }
      if (!st.activeTarget) return;
      st.assign[st.activeTarget] = cardId;
      const next = ['left', 'partner', 'right'].find((t) => !st.assign[t]);
      if (next) st.activeTarget = next;
      this._renderExchangePopup();
    },

    /* ---------- 마작 소원 팝업 ---------- */
    openWishPopup() {
      const grid = $('tichu-wish-grid');
      grid.innerHTML = '';
      for (let r = 2; r <= 14; r++) {
        const btn = document.createElement('button');
        btn.className = 'btn tiny';
        btn.textContent = core.rankLabel(r);
        btn.addEventListener('click', () => {
          this.ctx.send({ type: 'game_action', action: { kind: 'wish', rank: r } });
          window.Modal.close('tichu-wish-popup');
        });
        grid.appendChild(btn);
      }
      window.Modal.open('tichu-wish-popup');
    },

    /* ---------- 드래곤 증정 팝업 ---------- */
    openDragonPopup(options) {
      const el = $('tichu-dragon-options');
      el.innerHTML = '';
      for (const id of options) {
        const p = this.state.players.find((x) => x.id === id);
        const btn = document.createElement('button');
        btn.className = 'btn gold';
        btn.textContent = p ? p.name : id;
        btn.addEventListener('click', () => {
          this.ctx.send({ type: 'game_action', action: { kind: 'give_dragon', toPlayerId: id } });
          window.Modal.close('tichu-dragon-popup');
        });
        el.appendChild(btn);
      }
      window.Modal.open('tichu-dragon-popup');
    },

    /* ---------- 결과 팝업 ---------- */
    onRoundOver(result) {
      $('tichu-result-title').textContent = result.matchOver ? '🏁 매치 종료' : `${result.roundNo}핸드 결과`;
      const body = $('tichu-result-body');
      const deltaCls = (v) => (v > 0 ? 'delta-plus' : v < 0 ? 'delta-minus' : '');
      const deltaTxt = (v) => (v > 0 ? `+${v}` : `${v}`);
      let html = '';

      if (result.endReason === 'doubleWin') {
        html += `<div class="result-champion">🎉 ${result.doubleWinTeam}팀 더블윈!</div>`;
      }

      // 이번 핸드에 각 팀이 얻은 점수 — 가장 궁금한 정보이므로 맨 위에 크고 명확하게.
      html += `<div class="tichu-hand-delta">
        <div class="tichu-delta-col teamA">
          <span class="tichu-delta-label">A팀 이번 핸드</span>
          <span class="tichu-delta-value ${deltaCls(result.teamHand.A)}">${deltaTxt(result.teamHand.A)}</span>
        </div>
        <div class="tichu-delta-col teamB">
          <span class="tichu-delta-label">B팀 이번 핸드</span>
          <span class="tichu-delta-value ${deltaCls(result.teamHand.B)}">${deltaTxt(result.teamHand.B)}</span>
        </div>
      </div>`;

      // 티츄/그랜드티츄 선언 성공·실패로 인한 가감점을 개별적으로 보여준다.
      if (result.bonusRows && result.bonusRows.length) {
        const bonusHtml = result.bonusRows.map((b) => {
          const p = result.rows.find((r) => r.id === b.id);
          const label = b.kind === 'grand' ? '그랜드티츄' : '티츄';
          return `<div class="tichu-bonus-row">
            <span>${esc(p ? p.name : '?')} · ${label} ${b.success ? '성공' : '실패'}</span>
            <span class="${deltaCls(b.delta)}">${deltaTxt(b.delta)}</span>
          </div>`;
        }).join('');
        html += `<div class="tichu-bonus-list">${bonusHtml}</div>`;
      }

      const rows = result.rows.map((r) => {
        const badge = r.grandTichu ? '그랜드티츄' : r.tichu ? '티츄' : '';
        return `<tr><td>${r.finishRank || '-'}</td><td>${esc(r.name)}</td><td>${r.team}팀</td>
          <td>${r.handPoints}</td><td>${r.collectedPoints}</td><td>${badge}</td></tr>`;
      }).join('');
      html += `<table class="result-table">
        <tr><th>등수</th><th>이름</th><th>팀</th><th>손패점수</th><th>획득점수</th><th>선언</th></tr>${rows}</table>`;

      // 목표 점수 대비 누적 진행도를 막대로 한눈에.
      const pct = (v) => Math.max(0, Math.min(100, (v / result.targetScore) * 100));
      html += `<div class="tichu-team-scores">
        <div class="tichu-score-row"><span>A팀 누적</span><b>${result.teamScores.A}</b><span class="muted small-text">/ ${result.targetScore}</span></div>
        <div class="tichu-score-bar"><div class="tichu-score-fill teamA" style="width:${pct(result.teamScores.A)}%"></div></div>
        <div class="tichu-score-row"><span>B팀 누적</span><b>${result.teamScores.B}</b><span class="muted small-text">/ ${result.targetScore}</span></div>
        <div class="tichu-score-bar"><div class="tichu-score-fill teamB" style="width:${pct(result.teamScores.B)}%"></div></div>
      </div>`;

      if (result.matchOver) html += `<div class="result-champion">🏆 ${result.winningTeam}팀 승리!</div>`;
      body.innerHTML = html;
      $('tichu-result-ready').textContent = result.matchOver ? '다시 게임 준비' : '준비 완료';
      $('tichu-result-ready').disabled = false;
      $('tichu-result-room').style.display = result.matchOver ? 'block' : 'none';
      window.Modal.open('tichu-result-popup');
    },

    closeResult() { window.Modal.close('tichu-result-popup'); },
    isResultOpen() { return window.Modal.isOpen('tichu-result-popup'); },

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
      if (nt && (!pt || pt.byId !== nt.byId || pt.cards.length !== nt.cards.length ||
          pt.cards.map((c) => c.id).join() !== nt.cards.map((c) => c.id).join())) {
        // 카드가 테이블로 날아오는 애니메이션 시작 + 조합 크기에 따라 효과음 선택(페어 이상=강력한 "쾅")
        if (TichuUI.startPlayAnim) TichuUI.startPlayAnim(nt);
        if (nt.cards.length >= 2) Sound.slam(); else Sound.play();
        return;
      }
      const prevPassed = new Map(prev.players.map((p) => [p.id, p.passed]));
      for (const p of next.players) {
        if (p.passed && !prevPassed.get(p.id)) { Sound.pass(); return; }
      }
    },
  };

  window.Games.register(Tichu);
})();
