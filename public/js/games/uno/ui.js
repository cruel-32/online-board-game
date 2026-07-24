/**
 * 우노 캔버스 렌더러 — 상대 좌석(원형 배치), 중앙 버림패/색/방향/뽑기 더미, 내 손패.
 * 낼 수 있는 카드 강조, 와일드 색 선택 오버레이 처리.
 */
(function () {
  'use strict';

  const COLOR_HEX = { red: '#e2564d', yellow: '#e0b83c', green: '#4dae5e', blue: '#4d8fe2' };
  const COLORS = ['red', 'yellow', 'green', 'blue'];

  const UnoUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null, anim: 0,
    handRects: [], drawRect: null, colorRects: [],
    wildPending: null, // 색을 고르는 중인 와일드 카드 id
    callbacks: {},

    init(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.callbacks = callbacks || {};
      const resize = () => {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = canvas.clientWidth; this.H = canvas.clientHeight;
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
      const prev = this.state;
      this.state = state;
      this.myId = state.you;
      // 내 손패에 없는 와일드 선택은 해제
      if (this.wildPending && !state.hand.some((c) => c.id === this.wildPending)) this.wildPending = null;
      // 누군가 카드를 냈으면(버림패 맨 위 변화) 그 플레이어 → 중앙으로 카드가 날아오는 애니메이션
      const top = state.discardTop;
      const topSig = top ? (top.id || (top.color + top.type + top.num)) : '';
      if (prev && topSig && topSig !== this._topSig && state.lastAction && /냄$/.test(state.lastAction.text || '')) {
        this.startPlayAnim(top, state.lastAction);
      }
      this._topSig = topSig;
      // 드로우 페널티가 새로 발생하면(seq 변화) 카드가 날아가는 애니메이션 시작
      const pen = state.penalty;
      if (pen && pen.seq && pen.seq !== this._penaltySeqSeen) {
        this._penaltySeqSeen = pen.seq;
        this.startPenaltyAnim(pen);
      }
    },

    // 낸 카드가 그 플레이어 좌석 → 중앙 버림패로 날아오는 애니메이션(단일 카드)
    startPlayAnim(card, lastAction) {
      // 낸 사람 찾기: lastAction.name과 일치하는 플레이어 좌석(없으면 위쪽에서 등장)
      let from = { x: this.W / 2, y: this.H * 0.2 };
      const by = (this.state.players || []).find((p) => p.name === (lastAction && lastAction.name));
      if (by) {
        if (by.id === this.myId) from = { x: this.W / 2, y: this.H - 70 };
        else { const seat = this.seatPositions().find((s) => s.player.id === by.id); if (seat) from = { x: seat.x, y: seat.y - 8 }; }
      }
      this._playAnim = { card, from, start: performance.now(), dur: 260 };
      if (window.Sound && window.Sound.play) window.Sound.play();
    },

    // 드로우 카드(+2/+4) 페널티: 뽑기 더미에서 대상 플레이어 좌석으로 카드가 날아가는 애니메이션
    startPenaltyAnim(pen) {
      this._penaltyAnim = { targetId: pen.targetId, count: pen.count, byId: pen.byId, start: performance.now(), dur: 220 };
      if (window.Sound && window.Sound.select) window.Sound.select();
    },

    // 대상 좌석의 화면 좌표(나 자신은 하단 손패 중앙)
    _seatXY(id) {
      if (id === this.myId) return { x: this.W / 2, y: this.H - 60 };
      const seat = this.seatPositions().find((s) => s.player.id === id);
      return seat ? { x: seat.x, y: seat.y - 8 } : null;
    },

    isMyTurn() { return this.state && this.state.turnId === this.myId && !this.state.finished; },

    playable(card) {
      const st = this.state, top = st.discardTop, color = st.currentColor;
      if (card.type === 'wild' || card.type === 'wild4') return true;
      if (card.color === color) return true;
      if (card.type === 'number' && top.type === 'number') return card.num === top.num;
      if (card.type !== 'number' && card.type === top.type) return true;
      return false;
    },

    // 지금 낼 수 있는 카드 집합(방금 뽑았으면 그 카드만)
    playableNow(card) {
      if (!this.isMyTurn()) return false;
      if (this.state.justDrewCardId) return card.id === this.state.justDrewCardId;
      return this.playable(card);
    },

    /* ---------- 입력 ---------- */
    onDown(e) {
      if (!this.state) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // 와일드 색 선택 중이면 색만 처리
      if (this.wildPending) {
        for (const cr of this.colorRects) {
          if (x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h) {
            const id = this.wildPending; this.wildPending = null;
            if (window.Sound) window.Sound.select();
            if (this.callbacks.onPlay) this.callbacks.onPlay(id, cr.color);
            return;
          }
        }
        return; // 오버레이 밖 클릭은 무시
      }
      if (!this.isMyTurn()) return;
      // 손패(겹침 대비 역순)
      for (let k = this.handRects.length - 1; k >= 0; k--) {
        const hr = this.handRects[k];
        if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) {
          const card = this.state.hand.find((c) => c.id === hr.id);
          if (!card || !this.playableNow(card)) return;
          if (card.type === 'wild' || card.type === 'wild4') {
            this.wildPending = card.id; // 색 선택 오버레이 표시
            if (window.Sound) window.Sound.select();
          } else {
            if (window.Sound) window.Sound.select();
            if (this.callbacks.onPlay) this.callbacks.onPlay(card.id);
          }
          return;
        }
      }
      // 뽑기 더미
      if (this.drawRect && !this.state.justDrewCardId) {
        const d = this.drawRect;
        if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) {
          if (this.callbacks.onDraw) this.callbacks.onDraw();
        }
      }
    },

    /* ---------- 렌더 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      this.drawTable(ctx);
      this.drawSeats(ctx);
      this.drawCenter(ctx);
      this.drawHand(ctx);
      this.drawLastAction(ctx);
      this.drawPlayAnim(ctx);
      this.drawPenaltyAnim(ctx);
      if (this.isMyTurn() && !this.wildPending) this.drawTurnFrame(ctx);
      if (this.wildPending) this.drawWildPicker(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#2a2440'); g.addColorStop(1, '#0b0a10');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
      const spotRx = this.W * 0.42, spotRy = Math.min(this.H * 0.34, spotRx);
      ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = '#ffd76e';
      ctx.beginPath(); ctx.ellipse(this.W / 2, this.H * 0.48, spotRx, spotRy, 0, 0, Math.PI * 2); ctx.fill();
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

    // 렉시오와 동일한 원형 좌석/테이블 배치
    seatCenter() {
      const cx = this.W / 2, cy = this.H * 0.47;
      const rx = Math.min(this.W * 0.40, 330);
      const ry = Math.min(this.H * 0.30, rx);
      return { cx, cy, rx, ry };
    },
    seatPositions() {
      const others = (this.state.players || []).filter((p) => p.id !== this.myId);
      const n = others.length;
      const { cx, cy, rx, ry } = this.seatCenter();
      return others.map((p, i) => {
        const a = Math.PI * (1 - (i + 1) / (n + 1));
        return { player: p, x: cx + Math.cos(a) * rx, y: cy - Math.sin(a) * ry };
      });
    },
    centerY() { return this.H * 0.47; },

    // 렉시오와 동일한 카지노풍 원형 테이블(나무 테두리 + 펠트)
    drawTable(ctx) {
      const cx = this.W / 2, cy = this.H * 0.47;
      const rx = Math.min(this.W * 0.34, 300);
      const ry = Math.min(this.H * 0.27, rx);
      ctx.fillStyle = '#1c1206';
      ctx.beginPath(); ctx.ellipse(cx, cy + 10, rx + 16, ry + 14, 0, 0, Math.PI * 2); ctx.fill();
      const rim = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
      rim.addColorStop(0, '#7a4a22'); rim.addColorStop(1, '#3d2410');
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx + 16, ry + 12, 0, 0, Math.PI * 2); ctx.fill();
      const felt = ctx.createRadialGradient(cx, cy - ry * 0.3, 20, cx, cy, rx);
      felt.addColorStop(0, '#1e5c38'); felt.addColorStop(1, '#0d3520');
      ctx.fillStyle = felt;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 215, 130, 0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.8, ry * 0.76, 0, 0, Math.PI * 2); ctx.stroke();
    },

    drawSeats(ctx) {
      const st = this.state;
      for (const s of this.seatPositions()) {
        const p = s.player;
        const isTurn = st.turnId === p.id && !st.finished;
        const x = s.x, y = s.y;
        if (isTurn) {
          ctx.save();
          ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 16;
          ctx.fillStyle = 'rgba(255,215,110,0.25)';
          ctx.beginPath(); ctx.arc(x, y - 8, 24, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        // UNO! 배지(1장 남음)
        if (p.handCount === 1) {
          ctx.fillStyle = '#e2564d';
          this.roundRect(ctx, x - 18, y - 44, 36, 16, 8); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('UNO!', x, y - 32);
        }
        // 아바타
        ctx.fillStyle = p.connected ? (p.isBot ? '#4a4460' : '#5c5480') : '#3a3444';
        ctx.strokeStyle = isTurn ? '#ffd76e' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = isTurn ? 2.5 : 1;
        ctx.beginPath(); ctx.arc(x, y - 8, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'center'; ctx.fillStyle = '#ece7dc'; ctx.font = '700 14px sans-serif';
        ctx.fillText(p.isBot ? '🤖' : (p.name || '?').slice(0, 1), x, y - 3);
        // 이름
        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
        ctx.fillText((p.name || '').slice(0, 7), x, y + 17);
        // 남은 장수 배지
        const badgeY = y + 24;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 26, badgeY, 52, 16, 8); ctx.fill();
        ctx.font = '700 10px sans-serif'; ctx.fillStyle = '#9fe8ff';
        ctx.fillText('🂠 ' + p.handCount, x, badgeY + 12);
      }
    },

    drawCenter(ctx) {
      const st = this.state;
      const cx = this.W / 2, cy = this.centerY();
      const cw = this.H < 420 ? 52 : 62, ch = Math.round(cw * 1.45);
      // 현재 색 링
      ctx.save();
      ctx.strokeStyle = COLOR_HEX[st.currentColor] || '#888';
      ctx.lineWidth = 4; ctx.shadowColor = COLOR_HEX[st.currentColor] || '#888'; ctx.shadowBlur = 14;
      this.roundRect(ctx, cx - cw / 2 - 5, cy - ch / 2 - 5, cw + 10, ch + 10, 12); ctx.stroke();
      ctx.restore();
      // 버림패 맨 위 — 방금 낸 카드가 날아오는 중이면 정착 카드는 숨기고(비행 카드가 대신 보임)
      const flying = this._playAnim && this._playAnim.card &&
        (this._playAnim.card.id ? this._playAnim.card.id === st.discardTop.id : true);
      if (!flying) this.drawCard(ctx, cx - cw / 2, cy - ch / 2, cw, ch, st.discardTop);

      // 드로우 카드(+2/+4)가 맨 위일 때: 페널티는 이미 적용됐고 색만 맞추면 됨을 명확히 안내
      const topT = st.discardTop && st.discardTop.type;
      if (topT === 'draw2' || topT === 'wild4') {
        const label = '✓ 적용됨 · 색 맞추기';
        ctx.font = '800 11px sans-serif'; ctx.textAlign = 'center';
        const bw = ctx.measureText(label).width + 16;
        const by = cy + ch / 2 + 14;
        ctx.fillStyle = 'rgba(20,60,30,0.92)';
        this.roundRect(ctx, cx - bw / 2, by - 11, bw, 18, 9); ctx.fill();
        ctx.strokeStyle = COLOR_HEX[st.currentColor] || '#8f8'; ctx.lineWidth = 1.5;
        this.roundRect(ctx, cx - bw / 2, by - 11, bw, 18, 9); ctx.stroke();
        ctx.fillStyle = '#c9f5d6'; ctx.fillText(label, cx, by + 2);
      }

      // 뽑기 더미(왼쪽) — 클릭 가능
      const dw = cw, dh = ch;
      const dx = cx - cw / 2 - dw - 24, dy = cy - dh / 2;
      this.drawCardBack(ctx, dx, dy, dw, dh);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.roundRect(ctx, dx + dw / 2 - 16, dy + dh + 4, 32, 15, 7); ctx.fill();
      ctx.fillStyle = '#cfc8dc'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('' + st.drawCount, dx + dw / 2, dy + dh + 15);
      ctx.fillStyle = '#9a93a8'; ctx.font = '700 10px sans-serif';
      ctx.fillText('뽑기', dx + dw / 2, dy - 6);
      this.drawRect = { x: dx, y: dy, w: dw, h: dh };

      // 진행 방향(오른쪽)
      ctx.fillStyle = 'rgba(255,231,176,0.85)'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(st.dir === 1 ? '↻' : '↺', cx + cw / 2 + dw / 2 + 24, cy + 6);

      // 승리 배너
      if (st.finished && st.winnerName) {
        const pulse = 0.65 + 0.35 * Math.sin(this.anim / 220);
        ctx.font = '800 16px sans-serif'; ctx.textAlign = 'center';
        const label = `🎉 ${st.winnerName} 승리!`;
        const w = ctx.measureText(label).width + 28;
        const ty = cy - ch / 2 - 20;
        ctx.fillStyle = 'rgba(30,20,5,0.85)';
        this.roundRect(ctx, cx - w / 2, ty - 17, w, 26, 13); ctx.fill();
        ctx.fillStyle = `rgba(255,231,176,${pulse})`;
        ctx.fillText(label, cx, ty);
      }
    },

    drawHand(ctx) {
      this.handRects = [];
      const st = this.state, hand = st.hand || [];
      if (!hand.length) return;
      const gap = 6;
      const twoRows = this.H > this.W && hand.length >= 8;
      const c0 = twoRows ? Math.ceil(hand.length / 2) : hand.length;
      const c1 = twoRows ? hand.length - c0 : 0;
      const maxCount = Math.max(c0, c1, 1);
      const sideReserve = (this.H < 400 ? 60 : 66) + 12;
      const availW = this.W - 2 * sideReserve;
      let cw = this.H < 420 ? 42 : 50;
      if (maxCount > 1) {
        const needed = cw + (cw + gap) * (maxCount - 1);
        if (needed > availW) cw = Math.max(26, Math.floor((availW - gap * (maxCount - 1)) / maxCount));
      } else if (cw > availW) cw = Math.max(26, availW);
      const ch = Math.round(cw * 1.45);
      const spacing = maxCount > 1 ? Math.min(cw + gap, (availW - cw) / (maxCount - 1)) : 0;
      const rowGap = 8;
      const y0 = this.H - ch - 10, y1 = twoRows ? y0 - ch - rowGap : y0;
      const xFor = (count) => (this.W - (cw + spacing * (Math.max(count, 1) - 1))) / 2;
      const x0s = xFor(c0), x1s = xFor(c1);
      const myTurn = this.isMyTurn();

      for (let i = 0; i < hand.length; i++) {
        const c = hand[i];
        const row = (twoRows && i >= c0) ? 1 : 0;
        const col = row === 0 ? i : i - c0;
        const x = (row === 0 ? x0s : x1s) + col * spacing;
        const canNow = this.playableNow(c);
        const raised = canNow ? 12 : 0;
        const y = (row === 0 ? y0 : y1) - raised;
        ctx.save();
        if (myTurn && !canNow) ctx.globalAlpha = 0.5; // 낼 수 없는 카드는 흐리게
        this.drawCard(ctx, x, y, cw, ch, c);
        if (canNow) {
          ctx.strokeStyle = '#ffd76e'; ctx.lineWidth = 2.5;
          this.roundRect(ctx, x, y, cw, ch, 8); ctx.stroke();
        }
        ctx.restore();
        this.handRects.push({ id: c.id, x, y, w: cw, h: ch });
      }
    },

    drawLastAction(ctx) {
      const la = this.state.lastAction;
      if (!la || this.state.finished) return;
      const text = `${la.name}: ${la.text}`;
      ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 20;
      const x = this.W / 2, y = this.centerY() + (this.H < 420 ? 62 : 72);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      this.roundRect(ctx, x - w / 2, y - 13, w, 20, 10); ctx.fill();
      ctx.fillStyle = '#d8d2e4'; ctx.fillText(text, x, y + 1);
    },

    // 낸 카드가 플레이어 좌석 → 중앙 버림패로 역동적으로 날아오는 애니메이션
    drawPlayAnim(ctx) {
      const a = this._playAnim;
      if (!a) return;
      const now = performance.now();
      let p = (now - a.start) / a.dur;
      if (p >= 1) { this._playAnim = null; return; }
      const cx = this.W / 2, cy = this.centerY();
      const cw = this.H < 420 ? 52 : 62, ch = Math.round(cw * 1.45);
      const ease = 1 - Math.pow(1 - p, 3);
      const x = a.from.x + (cx - a.from.x) * ease;
      const y = a.from.y + (cy - a.from.y) * ease;
      const scale = 1.3 - 0.3 * ease;
      const rot = (1 - ease) * 0.5;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      this.drawCard(ctx, -cw / 2, -ch / 2, cw, ch, a.card);
      ctx.restore();
    },

    // 드로우 페널티 카드가 뽑기 더미에서 대상 좌석으로 역동적으로 날아가는 애니메이션
    drawPenaltyAnim(ctx) {
      const a = this._penaltyAnim;
      if (!a) return;
      const src = this.drawRect ? { x: this.drawRect.x + this.drawRect.w / 2, y: this.drawRect.y + this.drawRect.h / 2 }
                                : { x: this.W / 2, y: this.centerY() };
      const dst = this._seatXY(a.targetId);
      if (!dst) { this._penaltyAnim = null; return; }
      const now = performance.now();
      const perCard = a.dur, stagger = 130;
      const total = perCard + stagger * (a.count - 1) + 260; // 마지막 카드 도착 후 여운
      const elapsed = now - a.start;
      if (elapsed > total) { this._penaltyAnim = null; return; }
      const cw = 24, ch = 34;
      for (let i = 0; i < a.count; i++) {
        const t0 = i * stagger;
        let p = (elapsed - t0) / perCard;
        if (p < 0) continue;
        let alpha = 1;
        if (p > 1) { alpha = Math.max(0, 1 - (p - 1) * 1.6); p = 1; }
        const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const x = src.x + (dst.x - src.x) * ease;
        const y = src.y + (dst.y - src.y) * ease;
        const scale = 0.8 + 0.25 * Math.sin(p * Math.PI); // 날아가며 살짝 커졌다 작아짐
        const rot = (1 - p) * (i % 2 ? 0.5 : -0.5) + ease * 0.6;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        this.drawCardBack(ctx, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
      }
      // 대상 좌석 위에 "+N" 강조
      const badgeP = Math.min(1, elapsed / (perCard + stagger * (a.count - 1)));
      if (badgeP > 0.3) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (badgeP - 0.3) / 0.4) * (elapsed > total - 260 ? Math.max(0, (total - elapsed) / 260) : 1);
        const bx = dst.x, by = dst.y - 30;
        ctx.font = '900 18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#e2564d'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
        ctx.strokeText('+' + a.count, bx, by); ctx.fillText('+' + a.count, bx, by);
        ctx.restore();
      }
    },

    drawTurnFrame(ctx) {
      const pulse = 0.55 + 0.45 * Math.sin(this.anim / 260);
      ctx.save();
      ctx.strokeStyle = `rgba(255,220,130,${0.3 + 0.35 * pulse})`;
      ctx.lineWidth = 4 + 3 * pulse; ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 18 * pulse;
      this.roundRect(ctx, 3, 3, this.W - 6, this.H - 6, 14); ctx.stroke();
      ctx.restore();
    },

    // 와일드 색 선택 오버레이
    drawWildPicker(ctx) {
      this.colorRects = [];
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, this.W, this.H);
      const sw = 58, gap = 12;
      const totalW = sw * 4 + gap * 3;
      const x0 = this.W / 2 - totalW / 2, cy = this.H * 0.5;
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffe9b0'; ctx.font = '800 15px sans-serif';
      ctx.fillText('바꿀 색을 고르세요', this.W / 2, cy - sw / 2 - 18);
      let x = x0;
      for (const c of COLORS) {
        ctx.fillStyle = COLOR_HEX[c];
        this.roundRect(ctx, x, cy - sw / 2, sw, sw, 12); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
        this.roundRect(ctx, x, cy - sw / 2, sw, sw, 12); ctx.stroke();
        this.colorRects.push({ color: c, x, y: cy - sw / 2, w: sw, h: sw });
        x += sw + gap;
      }
      ctx.restore();
    },

    /* ---------- 카드 그리기 ---------- */
    drawCardBack(ctx, x, y, w, h) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#2c2740'); g.addColorStop(1, '#171325');
      ctx.fillStyle = g; this.roundRect(ctx, x, y, w, h, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, w, h, 8); ctx.stroke();
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.5);
      ctx.fillStyle = '#e2564d'; ctx.font = `800 ${Math.round(h * 0.28)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText('UNO', 0, h * 0.1);
      ctx.restore();
    },

    drawCard(ctx, x, y, w, h, card) {
      const isWild = card.type === 'wild' || card.type === 'wild4';
      // 본체
      ctx.fillStyle = '#f4f1ea';
      this.roundRect(ctx, x, y, w, h, 8); ctx.fill();
      // 안쪽 색 타원(와일드는 4색)
      ctx.save();
      this.roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6); ctx.clip();
      if (isWild) {
        const half = w / 2, midY = y + h / 2;
        const quads = [['red', x + 3, y + 3], ['blue', x + half, y + 3], ['yellow', x + 3, midY], ['green', x + half, midY]];
        for (const [c, qx, qy] of quads) { ctx.fillStyle = COLOR_HEX[c]; ctx.fillRect(qx, qy, half, h / 2); }
      } else {
        ctx.fillStyle = COLOR_HEX[card.color] || '#888';
        ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.45);
        ctx.beginPath(); ctx.ellipse(0, 0, w * 0.5, h * 0.34, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      ctx.restore();
      // 테두리
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, w, h, 8); ctx.stroke();
      // 라벨
      ctx.textAlign = 'center';
      const label = this._label(card);
      ctx.fillStyle = isWild ? '#fff' : '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2;
      ctx.font = `800 ${Math.round(h * (label.length > 2 ? 0.24 : 0.4))}px sans-serif`;
      ctx.strokeText(label, x + w / 2, y + h / 2 + h * 0.13);
      ctx.fillText(label, x + w / 2, y + h / 2 + h * 0.13);
      // 모서리 작은 라벨
      ctx.font = `800 ${Math.round(h * 0.15)}px sans-serif`;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(this._corner(card), x + 5, y + h * 0.18);
    },

    _label(card) {
      if (card.type === 'number') return String(card.num);
      return { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' }[card.type] || '?';
    },
    _corner(card) {
      if (card.type === 'number') return String(card.num);
      return { skip: 'S', reverse: 'R', draw2: '+2', wild: 'W', wild4: '+4' }[card.type] || '';
    },

    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      if (id === this.myId) return { x: rect.left + this.W / 2, y: rect.top + this.H - 120 };
      const seat = this.seatPositions().find((s) => s.player.id === id);
      if (!seat) return null;
      return { x: rect.left + seat.x, y: rect.top + seat.y - 40 };
    },
  };

  window.UnoUI = UnoUI;
})();
