/**
 * 펠리시티 캔버스 렌더러.
 * 쥐 카드 행+동전, 은행, 동물 카드 열(자루), 플레이어 배지, 내 손패, 차례/선택 강조를 그린다.
 */
(function () {
  'use strict';
  const core = window.FelicityCore;

  const FelicityUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null, anim: 0,
    selected: null,          // 배치할 손패 카드 id
    handRects: [],           // 손패 히트박스
    callbacks: {},
    lastResultKey: '', lastResultUntil: 0,

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
        if (window.Chat) window.Chat.reposition();
      };
      this.resize = resize;
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 250));
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
      resize();
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));

      const loop = () => { this.anim = performance.now(); if (this.state) this.render(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },

    setState(state) {
      const prevRound = this.state && this.state.round;
      this.state = state;
      this.myId = state.you;
      // 라운드가 바뀌면 선택 초기화
      if (prevRound !== state.round) this.selected = null;
      // 내 손패에 없는 선택은 해제
      if (this.selected && !state.hand.some((c) => c.id === this.selected)) this.selected = null;
      // 지난 라운드 결과 배너를 잠시 표시
      const key = state.lastResult ? JSON.stringify(state.lastResult) + '@' + state.round : '';
      if (key && key !== this.lastResultKey) { this.lastResultKey = key; this.lastResultUntil = performance.now() + 7000; }
    },

    isMyTurn() { return this.state && this.state.turnId === this.myId && !this.state.finished; },

    /* ---------- 입력: 손패 선택(배치 단계) ---------- */
    onDown(e) {
      if (!this.state || this.state.phase !== 'placing' || !this.isMyTurn()) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // 겹친 카드는 나중에 그린(더 위에 있는) 카드가 우선 → 역순 탐색
      for (let k = this.handRects.length - 1; k >= 0; k--) {
        const hr = this.handRects[k];
        if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) {
          this.selected = (this.selected === hr.id) ? null : hr.id;
          if (window.Sound) window.Sound.select();
          if (this.callbacks.onSelect) this.callbacks.onSelect();
          return;
        }
      }
    },

    /* ---------- 렌더링 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      this.drawTable(ctx);
      this.drawMouseRow(ctx);
      this.drawSeats(ctx);
      this.drawAnimalRow(ctx);
      this.drawHand(ctx);
      this.drawLastResult(ctx);
      if (this.isMyTurn()) this.drawTurnFrame(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#26302a');
      g.addColorStop(1, '#0d120e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    },

    /* ---------- 레이아웃(렉시오와 동일한 원형 좌석 배치) ----------
     * 상단: 쥐 카드 행 + 은행 / 그 아래 반원형 테이블에 다른 플레이어가 둘러앉고,
     * 좌석 아래(테이블 중앙)에 자루(동물 카드 열), 화면 하단에 내 손패를 둔다.
     */
    seatCenter() {
      const cx = this.W / 2;
      const avatarR = 18;
      const topReserve = 92;                       // 쥐 카드 행 + 은행이 차지하는 상단 높이
      const ry = Math.min(this.H * 0.12, 90);
      const cy = topReserve + avatarR + 6 + ry;    // 가장 높은 아바타가 상단 영역을 침범하지 않도록
      const rx = Math.min(this.W * 0.40, 330);
      return { cx, cy, rx, ry, avatarR };
    },

    // 다른 플레이어 좌석: 왼쪽(180°)→오른쪽(0°) 반원 호에 균등 배치 (렉시오와 동일)
    seatPositions() {
      const st = this.state;
      const others = (st.players || []).filter((p) => p.id !== this.myId);
      const n = others.length;
      const { cx, cy, rx, ry } = this.seatCenter();
      return others.map((p, i) => {
        const a = Math.PI * (1 - (i + 1) / (n + 1));
        return { player: p, x: cx + Math.cos(a) * rx, y: cy - Math.sin(a) * ry };
      });
    },

    // 자루(동물 카드 열)의 세로 시작 y — 좌석 아바타 바로 아래(테이블 중앙)
    animalRowY() {
      return this.seatCenter().cy + 64;
    },

    // 좌석을 감싸는 은은한 원형 테이블 — "둘러앉은" 느낌을 준다
    drawTable(ctx) {
      const sc = this.seatCenter();
      const cx = sc.cx, cy = sc.cy + 30;
      const rx = Math.min(this.W * 0.42, 340);
      const ry = Math.min(this.H * 0.20, rx);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 8, rx + 10, ry + 8, 0, 0, Math.PI * 2); ctx.fill();
      const felt = ctx.createRadialGradient(cx, cy - ry * 0.3, 20, cx, cy, rx);
      felt.addColorStop(0, '#1e5c38');
      felt.addColorStop(1, '#0d3520');
      ctx.fillStyle = felt;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,130,0.18)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.82, ry * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
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

    // 쥐 카드 행 + 은행
    drawMouseRow(ctx) {
      const st = this.state;
      const mice = st.mouse || [];
      const cw = 44, ch = 34, gap = 8;
      const totalW = mice.length * cw + (mice.length - 1) * gap;
      let x = (this.W - totalW) / 2;
      const y = 34; // 상단 HUD(방 이름·나가기·위젯)와 겹치지 않도록 아래로 내림
      ctx.textAlign = 'center';
      for (const m of mice) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,215,130,0.35)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, x, y, cw, ch, 7); ctx.fill(); ctx.stroke();
        // 쥐 카드 숫자만 표시(패스 획득액은 자루 카드 위 "리워드"로 안내하므로 여기선 생략)
        ctx.fillStyle = '#f0d78a';
        ctx.font = '800 16px sans-serif';
        ctx.fillText(String(m.num), x + cw / 2, y + ch / 2 + 6);
        x += cw + gap;
      }
      // 은행 — 쥐 카드 행 아래 가운데(상단 HUD·은행 겹침 방지)
      ctx.fillStyle = '#ffd76e';
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`은행 🪙${st.bank}`, this.W / 2, y + ch + 16);
    },

    // 동물 카드 열(자루)
    drawAnimalRow(ctx) {
      const st = this.state;
      const row = st.row || [];
      const cw = this.H < 420 ? 46 : 56, ch = Math.round(cw * 1.4), gap = 10;
      const totalW = row.length * cw + Math.max(0, row.length - 1) * gap;
      let x = (this.W - totalW) / 2;
      const y = this.animalRowY();
      // 패스 시 받는 보상(남은 최저 숫자 쥐 카드 동전)
      const passReward = ((st.mouse || []).find((m) => m.coins > 0) || {}).coins || 0;
      const bidding = st.phase === 'bidding' && !st.finished;
      ctx.textAlign = 'center';
      for (let i = 0; i < row.length; i++) {
        const slot = row[i];
        const ownerColor = core.COLOR_HEX[this._colorOf(slot.ownerId)] || '#888';
        if (slot.faceUp && slot.card) {
          this.drawCard(ctx, x, y, cw, ch, slot.card);
        } else {
          // 뒷면
          ctx.fillStyle = '#1c2a20';
          ctx.strokeStyle = ownerColor;
          ctx.lineWidth = 2;
          this.roundRect(ctx, x, y, cw, ch, 8); ctx.fill(); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '22px sans-serif';
          ctx.fillText('🐾', x + cw / 2, y + ch / 2 + 8);
        }
        // 카드 위: 누가 낸 카드인지 닉네임(소유자 색)
        ctx.fillStyle = ownerColor;
        ctx.font = '700 10px sans-serif';
        ctx.fillText((this._nameOf(slot.ownerId) || '').slice(0, 5), x + cw / 2, y - 5);
        // 소유자 색 점
        ctx.fillStyle = ownerColor;
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch + 9, 5, 0, Math.PI * 2);
        ctx.fill();
        // 패스 시 받는 보상 안내 — 모든 자루 카드 위에 간결하게 "리워드 🪙N"
        if (bidding && passReward > 0) {
          const label = `리워드 🪙${passReward}`;
          ctx.font = '800 10px sans-serif';
          const bw = ctx.measureText(label).width + 12;
          const by = y - 20;
          ctx.fillStyle = 'rgba(80,45,10,0.92)';
          this.roundRect(ctx, x + cw / 2 - bw / 2, by - 11, bw, 16, 8); ctx.fill();
          ctx.fillStyle = '#ffe0a0';
          ctx.fillText(label, x + cw / 2, by);
        }
        x += cw + gap;
      }
      if (!row.length) {
        ctx.fillStyle = 'rgba(255,231,176,0.7)';
        ctx.font = '700 14px sans-serif';
        ctx.fillText('카드를 놓는 중…', this.W / 2, y + ch / 2);
      }
    },

    // 카드 한 장(공개 상태)
    drawCard(ctx, x, y, w, h, card) {
      const color = core.COLOR_HEX[card.color] || '#888';
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, this._lighten(color, 0.12));
      grad.addColorStop(1, this._darken(color, 0.25));
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center';
      if (card.kind === 'cat') {
        const pos = card.value > 0;
        ctx.fillStyle = pos ? '#fff6d0' : '#ffd7d7';
        ctx.font = `800 ${Math.round(h * 0.30)}px sans-serif`;
        ctx.fillText((pos ? '+' : '') + card.value, x + w / 2, y + h * 0.44);
        ctx.font = `${Math.round(h * 0.22)}px sans-serif`;
        ctx.fillText('🐱', x + w / 2, y + h * 0.80);
      } else if (card.kind === 'rabbit') {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.round(h * 0.30)}px sans-serif`;
        ctx.fillText('🐰', x + w / 2, y + h * 0.44);
        ctx.font = `800 ${Math.round(h * 0.20)}px sans-serif`;
        ctx.fillText('0', x + w / 2, y + h * 0.80);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.round(h * 0.30)}px sans-serif`;
        ctx.fillText('🐶', x + w / 2, y + h * 0.44);
        ctx.font = `800 ${Math.round(h * 0.17)}px sans-serif`;
        ctx.fillText(card.size === 'big' ? '큰 개' : '작은 개', x + w / 2, y + h * 0.82);
      }
    },

    // 다른 플레이어 좌석 — 렉시오처럼 원형 테이블에 둘러앉은 아바타로 그린다
    drawSeats(ctx) {
      const st = this.state;
      const seats = this.seatPositions();
      for (const s of seats) {
        const p = s.player;
        const isTurn = st.turnId === p.id && !st.finished;
        const color = core.COLOR_HEX[p.color] || '#888';
        const x = s.x, y = s.y;

        // 차례 글로우
        if (isTurn) {
          ctx.save();
          ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 16;
          ctx.fillStyle = 'rgba(255,215,110,0.25)';
          ctx.beginPath(); ctx.arc(x, y - 8, 24, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        // 입찰/패스 배지(아바타 위 — 아이콘과 겹치지 않게 충분히 위로)
        if (p.passed) {
          ctx.fillStyle = 'rgba(120,40,55,0.9)';
          this.roundRect(ctx, x - 20, y - 46, 40, 16, 8); ctx.fill();
          ctx.fillStyle = '#ffc9c9'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('패스', x, y - 34);
        } else if (p.bid > 0) {
          ctx.fillStyle = 'rgba(130,95,20,0.92)';
          this.roundRect(ctx, x - 26, y - 46, 52, 16, 8); ctx.fill();
          ctx.fillStyle = '#ffe9b0'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('입찰 ' + p.bid, x, y - 34);
        }
        // 아바타(플레이어 색)
        ctx.fillStyle = this._darken(color, 0.35);
        ctx.strokeStyle = isTurn ? '#ffd76e' : color;
        ctx.lineWidth = isTurn ? 2.5 : 2;
        ctx.beginPath(); ctx.arc(x, y - 8, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f4efe4'; ctx.font = '700 14px sans-serif';
        ctx.fillText(p.isBot ? '🤖' : (p.name || '?').slice(0, 1), x, y - 3);
        // 시작(선) 표시
        if (p.isStart) {
          ctx.font = '13px sans-serif';
          ctx.fillText('⭐', x + 16, y - 16);
        }
        // 이름
        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#d8d2e4';
        ctx.fillText((p.name || '').slice(0, 7), x, y + 17);
        // 코인 · 고양이 배지
        const badgeY = y + 24;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 34, badgeY, 68, 16, 8); ctx.fill();
        ctx.font = '700 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd76e';
        ctx.fillText(p.coins == null ? '🪙?' : '🪙' + p.coins, x - 30, badgeY + 12);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#9fe8ff';
        ctx.fillText('🐱' + p.collectedCount, x + 30, badgeY + 12);
        ctx.textAlign = 'center';
      }
    },

    // 내 손패(배치 단계에 클릭 선택). 7장 이상이면 두 줄로 나눠 카드 겹침을 줄인다.
    drawHand(ctx) {
      this.handRects = [];
      const st = this.state;
      const hand = st.hand || [];
      if (!hand.length) return;
      const gap = 6;
      // 세로 모드에서 7장 이상이면 두 줄로(가로 모드는 폭이 넓어 한 줄로도 겹치지 않음)
      const twoRows = this.H > this.W && hand.length >= 7;
      const c0 = twoRows ? Math.ceil(hand.length / 2) : hand.length; // 앞줄(하단, 더 많은 쪽)
      const c1 = twoRows ? hand.length - c0 : 0;                     // 뒷줄(앞줄 위쪽)
      const maxCount = Math.max(c0, c1, 1);
      // 렉시오와 동일: 좌(패스)·우(입찰) 버튼이 양끝 코너에 있으므로 좌우 대칭으로 비우고 손패를 가운데로 모은다.
      const sideReserve = (this.H < 400 ? 62 : 76) + 20;
      const availW = this.W - 2 * sideReserve;
      let cw = this.H < 420 ? 40 : 48;
      if (maxCount > 1) {
        const neededW = cw + (cw + gap) * (maxCount - 1);
        if (neededW > availW) cw = Math.max(24, Math.floor((availW - gap * (maxCount - 1)) / maxCount));
      } else if (cw > availW) {
        cw = Math.max(24, availW);
      }
      const ch = Math.round(cw * 1.4);
      const spacing = maxCount > 1 ? Math.min(cw + gap, (availW - cw) / (maxCount - 1)) : 0;
      const rowGap = 8;
      const y0 = this.H - ch - 12;                    // 앞줄(하단)
      const y1 = twoRows ? y0 - ch - rowGap : y0;     // 뒷줄(위쪽)
      const canPlace = st.phase === 'placing' && this.isMyTurn();
      const xFor = (count) => {
        const totalW = cw + spacing * (Math.max(count, 1) - 1);
        return (this.W - totalW) / 2;                 // 좌우 대칭 여백 → 화면 중앙 정렬
      };
      const x0start = xFor(c0), x1start = xFor(c1);
      for (let i = 0; i < hand.length; i++) {
        const c = hand[i];
        const row = (twoRows && i >= c0) ? 1 : 0;
        const col = row === 0 ? i : i - c0;
        const x = (row === 0 ? x0start : x1start) + col * spacing;
        const y = row === 0 ? y0 : y1;
        const sel = this.selected === c.id;
        ctx.save();
        if (!canPlace) ctx.globalAlpha = 0.75;
        this.drawCard(ctx, x, y - (sel ? 12 : 0), cw, ch, c);
        if (sel) {
          ctx.strokeStyle = '#ffd76e'; ctx.lineWidth = 2.5;
          this.roundRect(ctx, x, y - 12, cw, ch, 8); ctx.stroke();
        }
        ctx.restore();
        this.handRects.push({ id: c.id, x, y: y - (sel ? 12 : 0), w: cw, h: ch });
      }
      // 내 정보(좌하단) — 손패 맨 윗줄 위에 표시
      const me = (st.players || []).find((p) => p.id === this.myId);
      if (me) {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd76e'; ctx.font = '700 12px sans-serif';
        const info = `${me.name}  🪙${me.coins}  🐱${me.collectedCount}` + (me.passed ? '  · 패스' : '');
        ctx.fillText(info, 10, (twoRows ? y1 : y0) - 8);
      }
    },

    // 지난 라운드 결과 — 공개된 카드 + 낙찰/패스 내역을 한눈에 보이는 패널로 표시
    drawLastResult(ctx) {
      if (this.lastResultUntil < this.anim) return;
      const lr = this.state.lastResult;
      if (!lr) return;

      // 이번 라운드에 등장한 자루 카드(획득 kept / 제거 removed)
      const cards = [
        ...(lr.kept || []).map((c) => ({ card: c, kept: true })),
        ...(lr.removed || []).map((c) => ({ card: c, kept: false })),
      ];
      const tw = 34, th = Math.round(tw * 1.4), cgap = 6;
      const cardsW = cards.length ? cards.length * tw + (cards.length - 1) * cgap : 0;

      // 텍스트 라인
      const lines = [];
      if (lr.discarded) {
        lines.push({ t: '전원 패스 — 자루 카드를 모두 버립니다', c: '#ffd7d7', f: '800 13px sans-serif' });
      } else {
        lines.push({ t: `${lr.winnerName} 낙찰 · 🪙${lr.bid} 지불 → +${lr.pointsGained}점`, c: '#ffe9b0', f: '800 13px sans-serif' });
      }
      const pg = (lr.passGains || []);
      if (pg.length) {
        lines.push({ t: '패스 보상  ' + pg.map((g) => `${g.name} +🪙${g.amount}`).join('   '), c: '#9fe8ff', f: '700 11px sans-serif' });
      }

      // 패널 크기 계산
      ctx.save();
      ctx.textAlign = 'center';
      let contentW = cardsW;
      ctx.font = '800 13px sans-serif';
      contentW = Math.max(contentW, ctx.measureText('지난 라운드 결과').width);
      for (const ln of lines) { ctx.font = ln.f; contentW = Math.max(contentW, ctx.measureText(ln.t).width); }
      const padX = 16;
      const panelW = Math.min(this.W - 12, contentW + padX * 2);
      const titleH = 20, cardsH = cards.length ? th + 10 : 0, lineH = 18;
      const panelH = 10 + titleH + cardsH + lines.length * lineH + 10;
      const cx = this.W / 2;
      let top = this.H * 0.54 - panelH / 2;
      top = Math.max(60, Math.min(top, this.H - panelH - 10));
      const x0 = cx - panelW / 2;

      // 배경
      const pulse = 0.6 + 0.4 * Math.sin(this.anim / 400);
      ctx.shadowColor = 'rgba(255,215,130,0.55)'; ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = 'rgba(16,24,16,0.96)';
      this.roundRect(ctx, x0, top, panelW, panelH, 14); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,215,130,0.6)'; ctx.lineWidth = 1.5;
      this.roundRect(ctx, x0, top, panelW, panelH, 14); ctx.stroke();

      let y = top + 10 + 14;
      ctx.fillStyle = '#ffd76e'; ctx.font = '800 13px sans-serif';
      ctx.fillText('지난 라운드 결과', cx, y);
      y += 6;

      // 공개 카드 썸네일(kept=선명 / removed=반투명 + ✕)
      if (cards.length) {
        let cxx = cx - cardsW / 2;
        const cyy = y + 4;
        for (const it of cards) {
          ctx.save();
          if (!it.kept) ctx.globalAlpha = 0.5;
          this.drawCard(ctx, cxx, cyy, tw, th, it.card);
          if (!it.kept) {
            ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cxx + 4, cyy + 4); ctx.lineTo(cxx + tw - 4, cyy + th - 4);
            ctx.moveTo(cxx + tw - 4, cyy + 4); ctx.lineTo(cxx + 4, cyy + th - 4);
            ctx.stroke();
          }
          ctx.restore();
          cxx += tw + cgap;
        }
        y = cyy + th + 4;
      }

      // 텍스트 라인
      ctx.textAlign = 'center';
      for (const ln of lines) {
        y += lineH - 3;
        ctx.fillStyle = ln.c; ctx.font = ln.f;
        ctx.fillText(ln.t, cx, y);
      }
      ctx.restore();
    },

    drawTurnFrame(ctx) {
      const pulse = 0.55 + 0.45 * Math.sin(this.anim / 260);
      ctx.save();
      ctx.strokeStyle = `rgba(255,220,130,${0.3 + 0.35 * pulse})`;
      ctx.lineWidth = 4 + 3 * pulse;
      ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 18 * pulse;
      this.roundRect(ctx, 3, 3, this.W - 6, this.H - 6, 14); ctx.stroke();
      ctx.restore();
    },

    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      if (id === this.myId) {
        return { x: rect.left + this.W / 2, y: rect.top + this.H - 130 };
      }
      const seat = this.seatPositions().find((s) => s.player.id === id);
      if (!seat) return null;
      return { x: rect.left + seat.x, y: rect.top + seat.y - 34 };
    },

    _colorOf(id) {
      const p = (this.state.players || []).find((x) => x.id === id);
      return p ? p.color : null;
    },
    _nameOf(id) {
      const p = (this.state.players || []).find((x) => x.id === id);
      return p ? p.name : '';
    },
    _lighten(hex, f) { return this._mix(hex, '#ffffff', f); },
    _darken(hex, f) { return this._mix(hex, '#000000', f); },
    _mix(a, b, f) {
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
      const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
      const r = Math.round(ar + (br - ar) * f), g = Math.round(ag + (bg - ag) * f), bl = Math.round(ab + (bb - ab) * f);
      return `rgb(${r},${g},${bl})`;
    },
  };

  window.FelicityUI = FelicityUI;
})();
