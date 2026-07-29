/**
 * 티츄 게임 화면 캔버스 렌더러 + 입력 처리.
 * 렉시오(GameUI)와 같은 스타일(입체 카드, 캔버스 좌석 배치)을 재사용하되, 티츄는 항상
 * 정확히 4인·2팀 고정 좌석(나=하단, 파트너=상단, 좌우=상대팀)이라 훨씬 단순하다.
 * 그랜드 티츄/카드 나눔/마작 소원/드래곤 증정처럼 "결정이 필요한" 단계는 캔버스가 아니라
 * index.js가 주입하는 DOM 팝업으로 처리하고, 캔버스는 좌석·손패·트릭 표시 + 손패 선택만 담당한다.
 */
(function () {
  'use strict';
  const core = window.TichuCore;

  const SUIT_COLOR = { jade: '#52d273', sword: '#9fb3c8', star: '#ffd23e', pagoda: '#ff6b57' };
  const SPECIAL_COLOR = { dog: '#c9b28a', mahjong: '#9fe8ff', phoenix: '#ff9f5a', dragon: '#ffd76e' };
  const SPECIAL_GLYPH = { dog: '🐶', mahjong: '㊀', phoenix: '🔥', dragon: '🐉' };

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  const TichuUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null,
    handOrder: [],       // 카드 id 배열(표시 순서). 라운드 중 길이 고정, 낸 카드 자리는 null 유지.
    selected: new Set(), // 선택된 카드 id(트릭 제출용)
    playable: null,      // Set<id> | null(계산 불필요/내 차례 아님)
    MY_ACTIONS_GAP: 34,  // 내 정보칸과 손패 사이, HUD 버튼(정렬/선택해제/티츄)을 위해 비워두는 세로 공간(px)
    // HTML 버튼(hud-my-actions)은 캔버스 카드보다 DOM상 나중에 그려져 항상 위에 겹치므로,
    // 선택 시 카드가 12px 떠오르는 것까지 감안해 손패-버튼 간격을 넉넉히 둬서 겹치지 않게 한다
    // (카드가 버튼에 가려지지 않아야 한다는 요구사항 — 버튼 위로 카드가 아예 넘어오지 않게 함).
    HAND_TOP_GAP: 24,
    // 드래그 상태
    pointer: null, // {id, startX, startY, x, y, dragging, tileIdx}
    dragInsert: -1,
    turnFlashUntil: 0, // 내 차례가 막 시작됐을 때 강조 배너를 잠시 띄우기 위한 타임스탬프
    playAnim: null,      // 트릭 제출(나→테이블) 비행 애니메이션
    exchangeAnim: null,  // 카드 나눔(나↔좌/파트너/우) 비행 애니메이션
    anim: 0,
    callbacks: {},

    init(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.callbacks = callbacks || {};
      const resize = () => {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = canvas.clientWidth;
        this.H = canvas.clientHeight;
        canvas.width = Math.round(this.W * this.dpr);
        canvas.height = Math.round(this.H * this.dpr);
        if (this.callbacks.onLayout) this.callbacks.onLayout();
      };
      this.resize = resize;
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 250));
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
      resize();

      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onUp(e));

      const loop = () => {
        this.anim = performance.now();
        if (this.state) this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    /* ---------- 상태 갱신 ---------- */
    setState(state) {
      const prev = this.state;
      const wasMyTurn = !!(prev && prev.turnId === prev.you && !prev.finished);
      const isMyTurnNow = state.turnId === state.you && !state.finished;
      if (isMyTurnNow && !wasMyTurn) this.turnFlashUntil = performance.now() + 1400;

      this.state = state;
      this.myId = state.you;
      const ids = state.hand.map((c) => c.id);
      // 카드 나눔(교환)이 막 끝나 최종 14장을 받은 시점 — 서버가 이미 오름차순 정렬해서 보내주므로
      // 손패 순서를 여기서 한 번 그 정렬을 그대로 받아들인다(이후엔 낸 카드만 빈 자리로 빠짐).
      const justEnteredTrick = this._lastPhase !== 'trick' && state.phase === 'trick';

      // 새 라운드 시작(첫 마운트 포함 — _lastRoundNo는 처음엔 undefined라 항상 다름)일 때만 슬롯을
      // 새로 배정한다. 손패를 전부 내서 모든 슬롯이 null이 되어도 여기서 다시 초기화하면 안
      // 된다 — 그러면 handOrder.length가 0으로 줄어들어(고정 슬롯이 깨짐) 레이아웃 폭이
      // state.hand([])만 기준으로 재계산되며 내 정보칸이 가운데로 튀는 버그가 생긴다.
      if (this._lastRoundNo !== state.roundNo) {
        this.handOrder = state.hand.map((c) => c.id);
      } else if (justEnteredTrick) {
        this.handOrder = state.hand.map((c) => c.id);
      } else {
        this.handOrder = this.handOrder.map((id) => (id != null && ids.includes(id)) ? id : null);
        for (const id of ids) {
          if (this.handOrder.includes(id)) continue;
          const emptyIdx = this.handOrder.indexOf(null);
          if (emptyIdx !== -1) this.handOrder[emptyIdx] = id;
          else this.handOrder.push(id);
        }
      }
      this._lastRoundNo = state.roundNo;
      // 카드 나눔이 막 끝난 시점이면, 내가 준 3장/받은 3장을 손패 스냅샷 비교로 알아내 날아가는/날아오는
      // 애니메이션을 띄운다(서버는 누가 나에게 어떤 카드를 줬는지 알려주지 않으므로 좌/파트너/우 순으로 매칭).
      if (justEnteredTrick && prev && prev.phase === 'exchange') {
        const prevIds = prev.hand.map((c) => c.id);
        const givenCards = prev.hand.filter((c) => !ids.includes(c.id));
        const receivedCards = state.hand.filter((c) => !prevIds.includes(c.id));
        if (givenCards.length && receivedCards.length) this.startExchangeAnim(givenCards, receivedCards);
      }
      this._lastPhase = state.phase;

      this.selected = new Set([...this.selected].filter((id) => ids.includes(id)));
      this.updatePlayable();
      this.notifyButtons();
    },

    // 손패 정렬(오름차순). 고정 슬롯 개수(라운드 시작 시 배정된 손패 칸 수)는 유지하고
    // 남은 카드만 정렬된 순서로 앞쪽 슬롯에 채운다 — 정렬 후에도 카드 크기가 다시 커지지 않도록.
    sortHand() {
      if (!this.state) return;
      const sortedIds = core.sortCards(this.state.hand).map((c) => c.id);
      const pad = this.handOrder.length - sortedIds.length;
      this.handOrder = pad > 0 ? sortedIds.concat(new Array(pad).fill(null)) : sortedIds;
    },

    selectCards(ids) {
      this.selected = new Set(ids);
      if (window.Sound) window.Sound.select();
      this.notifyButtons();
    },

    cardById(id) {
      return this.state.hand.find((c) => c.id === id);
    },

    isMyTurn() {
      return this.state && this.state.turnId === this.myId && !this.state.finished;
    },

    updatePlayable() {
      if (!this.state) { this.playable = null; return; }
      if (this.isMyTurn() && this.state.phase === 'trick' && !this.state.pendingWish && !this.state.pendingDragonGive) {
        const current = this.state.table ? { type: this.state.table.type, length: this.state.table.length, isBomb: this.state.table.isBomb, rank: this.state.table.rank, cards: this.state.table.cards } : null;
        let plays = core.validPlays(this.state.hand, current);
        if (this.state.wish != null) {
          const fulfilling = plays.filter((p) => p.cards.some((c) => c.rank === this.state.wish && !c.special));
          if (fulfilling.length) plays = fulfilling;
        }
        const s = new Set();
        for (const p of plays) for (const c of p.cards) s.add(c.id);
        this.playable = s;
      } else {
        this.playable = null;
      }
    },

    selectedCombo() {
      if (!this.selected.size) return null;
      const cards = [...this.selected].map((id) => this.cardById(id)).filter(Boolean);
      return core.analyze(cards);
    },

    canPlaySelection() {
      if (!this.state || this.state.phase !== 'trick' || this.state.finished) return false;
      if (this.state.pendingWish || this.state.pendingDragonGive) return false;
      const combo = this.selectedCombo();
      if (!combo) return false;
      const cur = this.state.table;
      if (!this.isMyTurn()) {
        // 내 차례가 아니어도 봄(폭탄)으로는 언제든 끼어들어 현재 조합을 이길 수 있다(정식 규칙).
        if (!combo.isBomb || !cur) return false;
        return core.beats(combo, { type: cur.type, length: cur.length, isBomb: cur.isBomb, rank: cur.rank });
      }
      // 소원이 걸려 있으면 this.playable(=updatePlayable가 미리 필터링해둔 집합)이 소원을
      // 만족하는 카드만 담고 있으므로, 선택한 카드 중 하나라도 빠지면 거부(소원 미이행 방지).
      if (this.playable && [...this.selected].some((id) => !this.playable.has(id))) return false;
      if (!cur) return true;
      if (combo.type === 'single' && combo.cards[0].special === 'phoenix') {
        combo.rank = core.resolvePhoenixSingleRank({ rank: cur.rank });
      }
      return core.beats(combo, { type: cur.type, length: cur.length, isBomb: cur.isBomb, rank: cur.rank });
    },

    clearSelection() {
      if (!this.selected.size) return;
      this.selected.clear();
      this.notifyButtons();
    },

    notifyButtons() {
      if (this.callbacks.onSelectionChange) this.callbacks.onSelectionChange();
    },

    /* ---------- 레이아웃 ---------- */
    handLayout() {
      const n = this.handOrder.length;
      const H = this.H, W = this.W;
      const portrait = H > W;
      const twoRows = portrait && n > 8;
      const c0 = twoRows ? Math.ceil(n / 2) : n;
      const c1 = twoRows ? n - c0 : 0;
      const maxCount = Math.max(c0, c1, 1);
      const sideReserve = (H < 400 ? 60 : 66) + 12;
      const availW = W - 2 * sideReserve;

      let tw = H < 380 ? 34 : 40;
      if (maxCount > 1) {
        const neededW = tw + (tw + 4) * (maxCount - 1);
        if (neededW > availW) tw = Math.max(20, Math.floor((availW - 4 * (maxCount - 1)) / maxCount));
      } else if (tw > availW) {
        tw = Math.max(20, availW);
      }
      const th = Math.round(tw * 1.38);
      const spacing = maxCount > 1 ? Math.min(tw + 4, (availW - tw) / (maxCount - 1)) : 0;
      const rowGap = 8;
      const xFor = (count) => {
        const totalW = tw + spacing * (Math.max(count, 1) - 1);
        return (W - totalW) / 2;
      };
      const y0 = H - th - 10;
      const y1 = twoRows ? y0 - th - rowGap : y0;
      return { n, tw, th, spacing, twoRows, c0, c1, x0: xFor(c0), x1: xFor(c1), y0, y1 };
    },

    rowOfIndex(i, L) {
      L = L || this.handLayout();
      return (L.twoRows && i >= L.c0) ? 1 : 0;
    },

    // 드래그 중 포인터 좌표 → 삽입될 손패 인덱스(두 줄 배치 대응)
    posToIndex(px, py) {
      const L = this.handLayout();
      if (!L.twoRows) {
        const ins = Math.round((px - L.x0) / (L.spacing || 1));
        return Math.max(0, Math.min(L.n - 1, ins));
      }
      const d0 = Math.abs(py - (L.y0 + L.th / 2));
      const d1 = Math.abs(py - (L.y1 + L.th / 2));
      if (d0 <= d1) {
        const ins = Math.round((px - L.x0) / (L.spacing || 1));
        return Math.max(0, Math.min(L.c0 - 1, ins));
      }
      const ins = Math.round((px - L.x1) / (L.spacing || 1));
      return L.c0 + Math.max(0, Math.min(L.c1 - 1, ins));
    },

    tileRectAt(i) {
      const L = this.handLayout();
      const id = this.handOrder[i];
      const sel = this.selected.has(id);
      const row = this.rowOfIndex(i, L);
      const col = row === 0 ? i : i - L.c0;
      const x = (row === 0 ? L.x0 : L.x1) + col * L.spacing;
      const y = (row === 0 ? L.y0 : L.y1) - (sel ? 12 : 0);
      return { x, y, w: L.tw, h: L.th };
    },

    // 상대 좌석: 오른쪽 이웃 / 파트너(맞은편) / 왼쪽 이웃 순으로 고정 배치
    seatPositions() {
      const st = this.state;
      if (!st) return [];
      const myIdx = st.players.findIndex((p) => p.id === this.myId);
      if (myIdx === -1) return [];
      const right = st.players[(myIdx + 1) % 4];
      const partner = st.players[(myIdx + 2) % 4];
      const left = st.players[(myIdx + 3) % 4];
      // topY 하한을 상단 점수판(약 y<42)과 겹치지 않도록 충분히 아래로 잡는다.
      const cx = this.W / 2, topY = Math.max(122, this.H * 0.2), midY = this.H * 0.42;
      return [
        { player: partner, x: cx, y: topY, pos: 'top' },
        { player: left, x: Math.max(46, this.W * 0.12), y: midY, pos: 'left' },
        { player: right, x: Math.min(this.W - 46, this.W * 0.88), y: midY, pos: 'right' },
      ];
    },

    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const seat = this.seatPositions().find((s) => s.player && s.player.id === id);
      if (!seat) return null;
      const rect = this.canvas.getBoundingClientRect();
      return { x: rect.left + seat.x, y: rect.top + seat.y - 40 };
    },

    myInfoAnchor() {
      if (!this.state || !this.canvas) return null;
      const L = this.handLayout();
      const x = Math.max(10, L.x0);
      const handTopY = L.twoRows ? L.y1 : L.y0;
      const rect = this.canvas.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + handTopY - this.HAND_TOP_GAP };
    },

    /* ---------- 애니메이션(제출/카드 나눔) ---------- */
    mySpot() {
      return { x: this.W / 2, y: this.H - 60 };
    },
    _sourceXY(id) {
      if (id === this.myId) return this.mySpot();
      const seat = this.seatPositions().find((s) => s.player && s.player.id === id);
      return seat ? { x: seat.x, y: seat.y - 8 } : { x: this.W / 2, y: this.H * 0.2 };
    },
    _roleXY(role) {
      const seat = this.seatPositions().find((s) => s.pos === role);
      return seat ? { x: seat.x, y: seat.y - 8 } : { x: this.W / 2, y: this.H * 0.2 };
    },

    centerCardLayout(count) {
      const cx = this.W / 2, cy = this.H * 0.5;
      const tw = 34, th = 47;
      const sp = Math.min(tw + 3, 130 / Math.max(count, 1));
      const totalW = tw + sp * (count - 1);
      const startX = cx - totalW / 2;
      const y = cy - th / 2;
      const positions = [];
      for (let i = 0; i < count; i++) positions.push({ x: startX + sp * i, y });
      return { tw, th, sp, positions, cx, cy, y };
    },

    // 트릭 제출: 낸 사람 → 중앙 테이블로 카드가 날아오는 애니메이션.
    _sigOfTable(table) {
      return table ? table.byId + '#' + table.cards.map((c) => c.id).join(',') : '';
    },
    startPlayAnim(table) {
      if (!table || !table.cards || !table.cards.length) return;
      this.playAnim = {
        sig: this._sigOfTable(table),
        cards: table.cards.slice(),
        from: this._sourceXY(table.byId),
        start: performance.now(),
        dur: 300,
      };
    },
    drawPlayAnim(ctx) {
      const a = this.playAnim;
      if (!a) return;
      if (!this.state || !this.state.table || this._sigOfTable(this.state.table) !== a.sig) { this.playAnim = null; return; }
      const now = this.anim || performance.now();
      const p = (now - a.start) / a.dur;
      if (p >= 1) { this.playAnim = null; return; }
      const L = this.centerCardLayout(a.cards.length);
      const ease = 1 - Math.pow(1 - p, 3);
      const scale = 1.35 - 0.35 * ease;
      if (p > 0.82) {
        const ip = (p - 0.82) / 0.18;
        const r = (18 + a.cards.length * 10) * ip;
        ctx.save();
        ctx.globalAlpha = (1 - ip) * 0.6;
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 3 + a.cards.length;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy + 6, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      for (let i = 0; i < a.cards.length; i++) {
        const to = L.positions[i];
        const x = a.from.x + (to.x + L.tw / 2 - a.from.x) * ease;
        const y = a.from.y + (to.y + L.th / 2 - a.from.y) * ease;
        const rot = (1 - ease) * (i % 2 ? 0.4 : -0.4);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        this.drawCard(ctx, -L.tw / 2, -L.th / 2, L.tw, L.th, a.cards[i], { glow: true });
        ctx.restore();
      }
    },

    // 카드 나눔: 내가 준 3장은 나→좌/파트너/우로, 받은 3장은 좌/파트너/우→나로 동시에 날아간다.
    // 서버는 누구에게서 어떤 카드를 받았는지 알려주지 않으므로 좌/파트너/우 순서로만 매칭한다(시각 효과일 뿐).
    startExchangeAnim(givenCards, receivedCards) {
      const roles = ['left', 'partner', 'right'];
      const me = this.mySpot();
      const flights = [];
      givenCards.forEach((card, i) => {
        flights.push({ card, from: me, to: this._roleXY(roles[i % 3]), start: performance.now(), dur: 520 });
      });
      receivedCards.forEach((card, i) => {
        flights.push({ card, from: this._roleXY(roles[i % 3]), to: me, start: performance.now() + 160, dur: 520 });
      });
      const until = Math.max(...flights.map((f) => f.start + f.dur)) + 80;
      this.exchangeAnim = { flights, until, receivedIds: new Set(receivedCards.map((c) => c.id)) };
    },
    drawExchangeAnim(ctx) {
      const a = this.exchangeAnim;
      if (!a) return;
      const now = this.anim || performance.now();
      if (now > a.until) { this.exchangeAnim = null; return; }
      const tw = 28, th = 39;
      for (const f of a.flights) {
        if (now < f.start) continue;
        const p = Math.min(1, (now - f.start) / f.dur);
        const ease = 1 - Math.pow(1 - p, 3);
        const x = f.from.x + (f.to.x - f.from.x) * ease;
        const y = f.from.y + (f.to.y - f.from.y) * ease - Math.sin(p * Math.PI) * 30; // 살짝 포물선으로
        const scale = 0.8 + 0.35 * Math.sin(Math.min(p, 1) * Math.PI);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        this.drawCard(ctx, -tw / 2, -th / 2, tw, th, f.card, { glow: true });
        ctx.restore();
      }
    },

    /* ---------- 렌더링 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      this.drawSeats(ctx);
      this.drawTable(ctx);
      this.drawWishBadge(ctx);
      this.drawMyInfo(ctx);
      this.drawHand(ctx);
      this.drawPlayAnim(ctx);
      this.drawExchangeAnim(ctx);
      this.drawScoreboard(ctx);
      if (this.isMyTurn()) this.drawTurnEffects(ctx);
    },

    // 목표 점수 + A/B팀 누적 점수를 화면 상단에 항상 표시(라운드 종료 후에도 계속 갱신됨).
    drawScoreboard(ctx) {
      const st = this.state;
      if (!st) return;
      const scores = st.teamScores || { A: 0, B: 0 };
      const target = st.targetScore || 0;
      const cx = this.W / 2;
      const topInset = 38;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(`목표 ${target}점`, cx, topInset + 12);

      ctx.font = '800 15px sans-serif';
      const aLabel = `A팀 ${scores.A}`;
      const sep = '  :  ';
      const bLabel = `B팀 ${scores.B}`;
      const aw = ctx.measureText(aLabel).width;
      const sw = ctx.measureText(sep).width;
      const bw = ctx.measureText(bLabel).width;
      let x = cx - (aw + sw + bw) / 2;
      const y = topInset + 32;

      // 뒤에 은은한 배경 캡슐을 깔아 좌석/카드 위에서도 항상 잘 보이게 한다.
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(10, 8, 16, 0.55)';
      this.roundRect(ctx, x - 12, y - 16, aw + sw + bw + 24, 22, 11);
      ctx.fill();

      ctx.fillStyle = '#6fd3ff';
      ctx.fillText(aLabel, x, y);
      x += aw;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(sep, x, y);
      x += sw;
      ctx.fillStyle = '#ff9fb0';
      ctx.fillText(bLabel, x, y);
      ctx.restore();
    },

    drawMyInfo(ctx) {
      const st = this.state;
      const me = st.players.find((p) => p.id === this.myId);
      if (!me) return;
      const L = this.handLayout();
      const x = Math.max(10, L.x0);
      const handTopY = L.twoRows ? L.y1 : L.y0;
      const rowY = handTopY - this.MY_ACTIONS_GAP - this.HAND_TOP_GAP;
      const topY = rowY - 16;
      const isTurn = this.isMyTurn();

      ctx.textAlign = 'left';
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
      ctx.fillText(me.name, x, rowY);
      const nameW = ctx.measureText(me.name).width;
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = me.team === 'A' ? '#6fd3ff' : '#ff9fb0';
      ctx.fillText(`${me.team || '?'}팀`, x + nameW + 8, rowY);

      if (isTurn) {
        const pulse = 0.6 + 0.4 * Math.sin(this.anim / 220);
        const label = '▶ 내 차례';
        ctx.font = '800 12px sans-serif';
        const w = ctx.measureText(label).width + 16;
        ctx.save();
        ctx.shadowColor = '#ffd76e';
        ctx.shadowBlur = 10 * pulse;
        ctx.fillStyle = `rgba(130, 95, 20, ${0.55 + 0.25 * pulse})`;
        this.roundRect(ctx, x, topY - 13, w, 18, 9);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = `rgba(255, 233, 176, ${0.8 + 0.2 * pulse})`;
        ctx.fillText(label, x + 8, topY);
      } else if (me.passed) {
        ctx.fillStyle = 'rgba(120, 40, 55, 0.9)';
        this.roundRect(ctx, x, topY - 12, 44, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#ffc9c9';
        ctx.font = '800 10px sans-serif';
        ctx.fillText('PASS', x + 7, topY);
      } else if (me.out) {
        ctx.fillStyle = 'rgba(30, 80, 90, 0.9)';
        this.roundRect(ctx, x, topY - 12, 60, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#9fe8ff';
        ctx.font = '800 10px sans-serif';
        ctx.fillText(`${me.finishRank}등 완주`, x + 7, topY);
      }
    },

    // 내 차례임을 놓치지 않도록 화면 전체 테두리 글로우 + 반짝이는 별빛 + 시작 직후 강조 배너를 그린다.
    drawTurnEffects(ctx) {
      const pulse = 0.55 + 0.45 * Math.sin(this.anim / 260);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 220, 130, ${0.35 + 0.4 * pulse})`;
      ctx.lineWidth = 5 + 4 * pulse;
      ctx.shadowColor = '#ffe9a8';
      ctx.shadowBlur = 26 * pulse;
      this.roundRect(ctx, 3, 3, this.W - 6, this.H - 6, 14);
      ctx.stroke();
      ctx.restore();

      this.drawTurnSparkles(ctx);

      if (this.turnFlashUntil > this.anim) {
        const total = 1400;
        const remain = this.turnFlashUntil - this.anim;
        const t = 1 - remain / total;
        const fadeIn = Math.min(1, t / 0.15);
        const fadeOut = remain < 350 ? Math.max(0, remain / 350) : 1;
        const alpha = Math.min(fadeIn, fadeOut);
        const scale = 1 + 0.1 * Math.sin(Math.min(t, 1) * Math.PI);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.W / 2, this.H * 0.34);
        const glowR = 150 * (0.7 + 0.3 * scale);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
        glow.addColorStop(0, 'rgba(255, 231, 176, 0.4)');
        glow.addColorStop(1, 'rgba(255, 231, 176, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.font = '900 30px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(70, 45, 5, 0.85)';
        ctx.shadowColor = '#ffe9a8';
        ctx.shadowBlur = 26;
        ctx.strokeText('✨ 당신의 차례! ✨', 0, 0);
        ctx.fillStyle = '#fff3d6';
        ctx.fillText('✨ 당신의 차례! ✨', 0, 0);
        ctx.restore();
      }
    },

    // 화면 테두리를 따라 랜덤하게 반짝이는 작은 별빛 파티클 — 내 차례임을 더 눈에 띄게 알려준다.
    turnSparklePts: null,
    drawTurnSparkles(ctx) {
      if (!this.turnSparklePts) {
        const pts = [];
        for (let i = 0; i < 22; i++) {
          pts.push({
            edge: Math.floor(Math.random() * 4),
            off: Math.random(),
            phase: Math.random() * Math.PI * 2,
            speed: 700 + Math.random() * 900,
            size: 3 + Math.random() * 4.5,
          });
        }
        this.turnSparklePts = pts;
      }
      const W = this.W, H = this.H, m = 12;
      for (const p of this.turnSparklePts) {
        let x, y;
        if (p.edge === 0) { x = m + p.off * (W - 2 * m); y = m; }
        else if (p.edge === 1) { x = W - m; y = m + p.off * (H - 2 * m); }
        else if (p.edge === 2) { x = m + p.off * (W - 2 * m); y = H - m; }
        else { x = m; y = m + p.off * (H - 2 * m); }

        const tw = 0.5 + 0.5 * Math.sin(this.anim / p.speed + p.phase);
        if (tw < 0.35) continue;
        const alpha = (tw - 0.35) / 0.65;
        const s = p.size * (0.7 + 0.5 * tw);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.fillStyle = '#fff7d6';
        ctx.shadowColor = '#ffe9a8';
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.3, -s * 0.3); ctx.lineTo(s, 0);
        ctx.lineTo(s * 0.3, s * 0.3); ctx.lineTo(0, s); ctx.lineTo(-s * 0.3, s * 0.3);
        ctx.lineTo(-s, 0); ctx.lineTo(-s * 0.3, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },

    drawBackground(ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, this.W, this.H);
    },

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    drawSeats(ctx) {
      const st = this.state;
      const me = st.players.find((x) => x.id === this.myId);
      const myTeam = me ? me.team : null;
      for (const s of this.seatPositions()) {
        const p = s.player;
        if (!p) continue;
        const x = s.x, y = s.y;
        const isTurn = st.turnId === p.id && !st.finished;
        const isAlly = myTeam && p.team === myTeam;
        // 같은 편(파트너)은 초록, 상대편(좌우)은 붉은 계열로 명확히 구분한다.
        const teamColor = isAlly ? '#6fe0a0' : '#ff7a7a';
        if (isTurn) {
          const pulse = 6 + 3 * Math.sin(this.anim / 250);
          ctx.save();
          ctx.shadowColor = '#ffd76e';
          ctx.shadowBlur = pulse + 10;
          ctx.fillStyle = 'rgba(255, 215, 110, 0.25)';
          ctx.beginPath();
          ctx.arc(x, y - 6, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        // 배경에 은은한 팀 색 후광을 깔아 링 색만으로 구분하기 어려운 경우도 보완한다.
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = teamColor;
        ctx.beginPath();
        ctx.arc(x, y - 6, 27, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = p.connected ? (p.isBot ? '#4a4460' : '#5c5480') : '#3a3444';
        ctx.strokeStyle = teamColor;
        ctx.lineWidth = isTurn ? 2.8 : 2.2;
        ctx.beginPath();
        ctx.arc(x, y - 6, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = '700 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ece7dc';
        ctx.fillText(p.isBot ? '🤖' : p.name.slice(0, 1), x, y - 1);

        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
        ctx.fillText(p.name.slice(0, 8), x, y + 20);

        // 우리팀/상대팀 표시(색으로만 구분하기 어려울 때를 대비한 텍스트 라벨).
        // 이 4인 구조에서 같은 편은 항상 맞은편(파트너) 한 명뿐이다.
        ctx.font = '800 9px sans-serif';
        ctx.fillStyle = teamColor;
        ctx.fillText(isAlly ? '우리팀 · 파트너' : '상대팀', x, y + 32);

        const badgeY = y + 38;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 30, badgeY, 60, 15, 7);
        ctx.fill();
        ctx.font = '700 10px sans-serif';
        ctx.fillStyle = '#9fe8ff';
        ctx.fillText(`🂠×${p.cardCount}`, x, badgeY + 11);

        let tagY = y - 28;
        if (p.grandTichu === true) {
          ctx.fillStyle = '#ffd76e';
          ctx.font = '800 10px sans-serif';
          ctx.fillText('그랜드티츄!', x, tagY);
          tagY -= 13;
        } else if (p.tichu) {
          ctx.fillStyle = '#ffd76e';
          ctx.font = '800 10px sans-serif';
          ctx.fillText('티츄!', x, tagY);
          tagY -= 13;
        }
        if (p.passed) {
          ctx.fillStyle = '#c98a8a';
          ctx.font = '700 9px sans-serif';
          ctx.fillText('PASS', x, tagY);
        }
        if (p.out) {
          ctx.fillStyle = '#9fe8ff';
          ctx.font = '700 9px sans-serif';
          ctx.fillText(`${p.finishRank}등 완주`, x, tagY);
        }
      }
    },

    drawTable(ctx) {
      const st = this.state;
      const cx = this.W / 2, cy = this.H * 0.5;
      const table = st.table;
      if (!table) {
        ctx.font = '600 13px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.textAlign = 'center';
        ctx.fillText(st.leaderId === this.myId ? '내가 리드할 차례' : '리드 대기 중', cx, cy);
        return;
      }
      const L = this.centerCardLayout(table.cards.length);
      // 방금 낸 조합이 날아오는 중이면(playAnim) 정착 카드는 그리지 않는다(비행 카드가 대신 보임)
      const flying = this.playAnim && this.playAnim.sig === this._sigOfTable(table);
      if (!flying) {
        for (let i = 0; i < table.cards.length; i++) {
          this.drawCard(ctx, L.positions[i].x, L.positions[i].y, L.tw, L.th, table.cards[i], {});
        }
      }
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = '#c9c2d6';
      ctx.textAlign = 'center';
      ctx.fillText(`${table.byName} · ${core.describeCombo({ type: table.type, length: table.length, isBomb: table.isBomb, rank: 0, cards: table.cards })}`, cx, L.y + L.th + 16);
    },

    // 마작 소원으로 걸린 숫자를 테이블 위쪽에 항상 표시(해소되기 전까지 계속 보여야 함).
    drawWishBadge(ctx) {
      const st = this.state;
      if (!st || st.wish == null) return;
      const cx = this.W / 2;
      const y = this.H * 0.5 - 50;
      const label = `🀄 소원: ${core.rankLabel(st.wish)}`;
      ctx.save();
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 20;
      ctx.fillStyle = 'rgba(120, 40, 110, 0.8)';
      this.roundRect(ctx, cx - w / 2, y - 14, w, 22, 11);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 159, 255, 0.85)';
      ctx.lineWidth = 1.2;
      this.roundRect(ctx, cx - w / 2, y - 14, w, 22, 11);
      ctx.stroke();
      ctx.fillStyle = '#ffe3ff';
      ctx.fillText(label, cx, y + 2);
      ctx.restore();
    },

    drawHand(ctx) {
      const L = this.handLayout();
      const dragging = this.pointer && this.pointer.dragging;
      const fromIdx = dragging ? this.pointer.tileIdx : -1;
      const toIdx = dragging ? this.dragInsert : -1;
      const toRow = dragging && toIdx >= 0 ? this.rowOfIndex(toIdx, L) : -1;

      const incoming = this.exchangeAnim ? this.exchangeAnim.receivedIds : null;

      // 뒷줄(위쪽, row=1)을 먼저 그리고 앞줄(아래쪽, row=0)을 나중에 그려서, 앞줄 카드가 선택되어
      // 위로 올라올 때 뒷줄 카드에 가려 잘리지 않고 항상 앞줄이 더 높은 z-index를 갖게 한다.
      const drawOrder = [];
      for (let i = 0; i < this.handOrder.length; i++) if (this.rowOfIndex(i, L) === 1) drawOrder.push(i);
      for (let i = 0; i < this.handOrder.length; i++) if (this.rowOfIndex(i, L) === 0) drawOrder.push(i);

      // 타일은 항상 고정된 슬롯(행/열)에 그린다. 드롭 시 자리 바꾸기(swap)만 일어나므로
      // 드래그 중에도 관계없는 카드들이 밀려 보이지 않는다.
      for (const i of drawOrder) {
        if (dragging && i === fromIdx) continue; // 드래그 중인 카드는 마지막에 확대해서 그림
        const id = this.handOrder[i];
        if (incoming && incoming.has(id)) continue; // 카드 나눔으로 날아 들어오는 중인 카드는 도착 전까지 숨김
        const card = id != null ? this.cardById(id) : null;
        if (!card) continue;
        const row = this.rowOfIndex(i, L);
        const col = row === 0 ? i : i - L.c0;
        const x = (row === 0 ? L.x0 : L.x1) + col * L.spacing;
        const y = row === 0 ? L.y0 : L.y1;
        const sel = this.selected.has(id);
        const dim = this.playable ? !this.playable.has(id) : false;
        this.drawCard(ctx, x, y - (sel ? 12 : 0), L.tw, L.th, card, { selected: sel, dimmed: dim });
      }
      // 드래그 삽입 슬롯 하이라이트
      if (dragging && toIdx >= 0) {
        const col = toRow === 0 ? toIdx : toIdx - L.c0;
        const x = (toRow === 0 ? L.x0 : L.x1) + col * L.spacing;
        const y = toRow === 0 ? L.y0 : L.y1;
        ctx.save();
        ctx.strokeStyle = '#ffd76e';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        this.roundRect(ctx, x - 2, y - 4, L.tw + 4, L.th + 8, 8);
        ctx.stroke();
        ctx.restore();
      }
      // 드래그 중인 카드를 포인터 위치에 확대+글로우로
      if (dragging) {
        const id = this.handOrder[fromIdx];
        const card = id != null ? this.cardById(id) : null;
        if (card) {
          const w = L.tw * 1.12, h = L.th * 1.12;
          this.drawCard(ctx, this.pointer.x - w / 2, this.pointer.y - h * 0.7, w, h, card, {
            selected: this.selected.has(id), glow: true,
          });
        }
      }
    },

    drawCard(ctx, x, y, w, h, card, opts) {
      opts = opts || {};
      const isSpecial = !!card.special;
      const suitColor = isSpecial ? SPECIAL_COLOR[card.special] : SUIT_COLOR[card.suit];
      ctx.save();
      if (opts.glow) { ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 14; }
      ctx.fillStyle = '#060509';
      this.roundRect(ctx, x + 2, y + 3, w, h, 6);
      ctx.fill();
      const body = ctx.createLinearGradient(x, y, x, y + h);
      body.addColorStop(0, '#232030');
      body.addColorStop(1, '#131019');
      ctx.fillStyle = body;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = opts.selected ? '#ffd76e' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = opts.selected ? 2 : 1;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = suitColor;
      if (isSpecial) {
        ctx.font = `${Math.round(h * 0.42)}px sans-serif`;
        ctx.fillText(SPECIAL_GLYPH[card.special], x + w / 2, y + h * 0.58);
      } else {
        ctx.font = `800 ${Math.round(h * 0.34)}px sans-serif`;
        ctx.fillText(core.rankLabel(card.rank), x + w / 2, y + h * 0.45);
        ctx.font = `${Math.round(h * 0.24)}px sans-serif`;
        ctx.fillText(core.SUIT_SYMBOL[card.suit], x + w / 2, y + h * 0.82);
      }
      if (opts.dimmed) {
        ctx.fillStyle = 'rgba(5, 5, 10, 0.62)';
        this.roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
      }
      ctx.restore();
    },

    /* ---------- 입력 ---------- */
    eventPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },

    hitTile(x, y) {
      for (let i = this.handOrder.length - 1; i >= 0; i--) {
        if (this.handOrder[i] == null) continue;
        const r = this.tileRectAt(i);
        if (x >= r.x && x <= r.x + r.w && y >= r.y - 6 && y <= r.y + r.h) return i;
      }
      return -1;
    },

    onDown(e) {
      if (!this.state) return;
      // 결정 대기 팝업이 떠 있을 때는 손패를 만지지 않음(트릭 플레이 단계에서만 선택/드래그 가능)
      if (this.state.phase !== 'trick' || this.state.pendingWish || this.state.pendingDragonGive) return;
      const p = this.eventPos(e);
      const idx = this.hitTile(p.x, p.y);
      if (idx === -1) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, startX: p.x, startY: p.y, x: p.x, y: p.y, dragging: false, tileIdx: idx };
      this.dragInsert = -1;
    },

    onMove(e) {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      const p = this.eventPos(e);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      if (!this.pointer.dragging) {
        const dx = p.x - this.pointer.startX;
        const dy = p.y - this.pointer.startY;
        if (Math.hypot(dx, dy) > 12) this.pointer.dragging = true;
      }
      if (this.pointer.dragging) this.dragInsert = this.posToIndex(p.x, p.y);
    },

    onUp(e) {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      const { dragging, tileIdx } = this.pointer;
      if (dragging && this.dragInsert >= 0 && this.dragInsert !== tileIdx) {
        // 슬롯을 서로 맞바꾼다(밀어넣지 않음) — 그래야 사이에 있는 다른 카드들의 고정 슬롯
        // 위치가 흔들리지 않는다(빈 슬롯과 바꾸면 그 자리는 그냥 비워짐).
        const id = this.handOrder[tileIdx];
        this.handOrder[tileIdx] = this.handOrder[this.dragInsert];
        this.handOrder[this.dragInsert] = id;
      } else if (!dragging) {
        // 탭 → 선택 토글
        const id = this.handOrder[tileIdx];
        if (this.selected.has(id)) {
          this.selected.delete(id);
          if (window.Sound) window.Sound.deselect();
        } else {
          this.selected.add(id);
          if (window.Sound) window.Sound.select();
        }
        this.notifyButtons();
      }
      this.pointer = null;
      this.dragInsert = -1;
    },
  };

  window.TichuUI = TichuUI;
})();
