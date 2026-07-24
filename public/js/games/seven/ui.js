/**
 * 세븐포커 캔버스 렌더러 — 원형 좌석(상대: 오픈 카드 공개/다운 뒷면), 중앙 팟/스트리트,
 * 하단 내 7장(다운은 살짝 어둡게 표시). 홀덤과 통일된 좌석·하단 레이아웃을 따른다.
 */
(function () {
  'use strict';
  const poker = window.PokerCore;

  const SevenUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null, anim: 0, callbacks: {},

    init(canvas, callbacks) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.callbacks = callbacks || {};
      const resize = () => {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = canvas.clientWidth; this.H = canvas.clientHeight;
        canvas.width = Math.round(this.W * this.dpr); canvas.height = Math.round(this.H * this.dpr);
        if (window.Chat) window.Chat.reposition();
      };
      this.resize = resize;
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 250));
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
      resize();
      const loop = () => { this.anim = performance.now(); if (this.state) this.render(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },

    setState(state) { this.state = state; this.myId = state.you; },
    isMyTurn() { return this.state && this.state.turnId === this.myId && !this.state.finished; },

    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    seatCenter() {
      const cx = this.W / 2, topReserve = 30, avatarR = 18;
      const ry = Math.min(this.H * 0.13, 96);
      const cy = topReserve + avatarR + 6 + ry;
      const rx = Math.min(this.W * 0.40, 330);
      return { cx, cy, rx, ry, avatarR };
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
    centerY() { return this.seatCenter().cy + 70; },

    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      this.drawTable(ctx);
      this.drawSeats(ctx);
      this.drawCenter(ctx);
      this.drawMe(ctx);
      if (this.isMyTurn()) this.drawTurnFrame(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#2a2440'); g.addColorStop(1, '#0b0a10');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    },

    drawTable(ctx) {
      const sc = this.seatCenter();
      const cx = sc.cx, cy = sc.cy + 34;
      const rx = Math.min(this.W * 0.44, 350), ry = Math.min(this.H * 0.22, rx);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 8, rx + 10, ry + 8, 0, 0, Math.PI * 2); ctx.fill();
      const felt = ctx.createRadialGradient(cx, cy - ry * 0.3, 20, cx, cy, rx);
      felt.addColorStop(0, '#2b3a6a'); felt.addColorStop(1, '#141b38');
      ctx.fillStyle = felt;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,130,0.18)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.82, ry * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    },

    drawSeats(ctx) {
      const st = this.state;
      for (const s of this.seatPositions()) {
        const p = s.player;
        const x = s.x, y = s.y;
        const isTurn = st.turnId === p.id && !st.finished;
        if (p.out) ctx.globalAlpha = 0.4;
        if (isTurn) {
          ctx.save();
          ctx.shadowColor = '#ffd76e'; ctx.shadowBlur = 16;
          ctx.fillStyle = 'rgba(255,215,110,0.25)';
          ctx.beginPath(); ctx.arc(x, y - 8, 24, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        // 상대 카드: 오픈은 앞면, 다운은 뒷면 — 아바타 위에 가로로 작게
        if (!p.out && !p.folded && p.cards && p.cards.length) {
          const cw = 15, ch = 21, g = 2;
          const totalW = p.cards.length * cw + (p.cards.length - 1) * g;
          let hx = x - totalW / 2; const hy = y - 44;
          for (const c of p.cards) {
            if (c.hidden || c.up === false && c.rank == null) this.drawCardBack(ctx, hx, hy, cw, ch);
            else if (c.rank != null) this.drawCard(ctx, hx, hy, cw, ch, c, !c.up);
            else this.drawCardBack(ctx, hx, hy, cw, ch);
            hx += cw + g;
          }
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
        // 스택 배지
        const badgeY = y + 24;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 30, badgeY, 60, 16, 8); ctx.fill();
        ctx.font = '700 10px sans-serif'; ctx.fillStyle = '#ffd76e';
        ctx.fillText('🪙' + (p.out ? 0 : p.stack), x, badgeY + 12);
        // 상태/베팅
        if (p.out) { ctx.fillStyle = '#9a93a8'; ctx.font = '700 10px sans-serif'; ctx.fillText('탈락', x, y - 48); }
        else if (p.folded) { ctx.fillStyle = '#b06a6a'; ctx.font = '800 10px sans-serif'; ctx.fillText('다이', x, y - 48); }
        else if (p.allIn) { this.chipLabel(ctx, x, y + 46, '올인', '#e0b060'); }
        else if (p.committed > 0) { this.chipLabel(ctx, x, y + 46, '' + p.committed, '#ffd76e'); }
        ctx.globalAlpha = 1;
      }
    },

    chipLabel(ctx, x, y, text, color) {
      ctx.font = '800 10px sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 16;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      this.roundRect(ctx, x - w / 2, y - 9, w, 16, 8); ctx.fill();
      ctx.fillStyle = color; ctx.fillText(text, x, y + 3);
    },

    drawCenter(ctx) {
      const st = this.state, cx = this.W / 2, cy = this.centerY();
      ctx.textAlign = 'center';
      ctx.font = '800 15px sans-serif'; ctx.fillStyle = '#ffe9b0';
      ctx.fillText(`팟 🪙${st.pot}`, cx, cy - 8);
      ctx.font = '700 11px sans-serif'; ctx.fillStyle = '#9fe8ff';
      ctx.fillText(st.street || '', cx, cy + 10);
      if (st.lastAction && !st.finished) {
        ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#d8d2e4';
        ctx.fillText(`${st.lastAction.name}: ${st.lastAction.text}`, cx, cy + 30);
      }
      // 결과 배너
      if (st.finished && st.winners && st.winners.length) {
        const pulse = 0.65 + 0.35 * Math.sin(this.anim / 220);
        const label = st.winners.map((w) => `${w.name} +🪙${w.amount}`).join(' · ');
        ctx.font = '800 14px sans-serif';
        const w = ctx.measureText(label).width + 26;
        const ty = cy + 40;
        ctx.fillStyle = 'rgba(30,20,5,0.85)';
        this.roundRect(ctx, cx - w / 2, ty - 15, w, 24, 12); ctx.fill();
        ctx.fillStyle = `rgba(255,231,176,${pulse})`; ctx.fillText('🏆 ' + label, cx, ty + 1);
      }
    },

    drawMe(ctx) {
      const st = this.state;
      const me = (st.players || []).find((p) => p.id === this.myId);
      const cards = st.hand || [];
      if (!cards.length) return;
      const gap = 5;
      const sideReserve = (this.H < 400 ? 60 : 66) + 12;
      const availW = this.W - 2 * sideReserve;
      let cw = this.H < 420 ? 40 : 46;
      const needed = cw + (cw + gap) * (cards.length - 1);
      if (needed > availW) cw = Math.max(26, Math.floor((availW - gap * (cards.length - 1)) / cards.length));
      const ch = Math.round(cw * 1.4);
      const spacing = cards.length > 1 ? Math.min(cw + gap, (availW - cw) / (cards.length - 1)) : 0;
      const totalW = cw + spacing * (cards.length - 1);
      const x0 = (this.W - totalW) / 2;
      const y = this.H - ch - 28;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        this.drawCard(ctx, x0 + i * spacing, y, cw, ch, c, !c.up); // 다운 카드는 어둡게 표시(내 것은 값 보임)
        if (!c.up) {
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          this.roundRect(ctx, x0 + i * spacing, y, cw, ch, 5); ctx.fill();
        }
      }
      if (me) {
        ctx.textAlign = 'center'; ctx.font = '700 13px sans-serif';
        ctx.fillStyle = me.folded ? '#b06a6a' : '#ffd76e';
        let info = `${me.name}  🪙${me.stack}`;
        if (me.folded) info += ' · 다이'; else if (me.allIn) info += ' · 올인';
        else if (me.committed > 0) info += ` · 벳 ${me.committed}`;
        ctx.fillText(info, this.W / 2, this.H - 8);
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

    drawCardBack(ctx, x, y, w, h) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#3a3557'); g.addColorStop(1, '#211d38');
      ctx.fillStyle = g; this.roundRect(ctx, x, y, w, h, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; this.roundRect(ctx, x, y, w, h, 4); ctx.stroke();
    },
    drawCard(ctx, x, y, w, h, card, dim) {
      const red = card.suit === 'h' || card.suit === 'd';
      ctx.fillStyle = dim ? '#d9d5cc' : '#f6f3ec'; this.roundRect(ctx, x, y, w, h, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; this.roundRect(ctx, x, y, w, h, 5); ctx.stroke();
      const col = red ? '#d1463f' : '#20242e';
      const rl = poker ? poker.rankLabel(card.rank) : String(card.rank);
      const sym = poker ? poker.SUIT_SYMBOL[card.suit] : card.suit;
      ctx.fillStyle = col; ctx.textAlign = 'left';
      ctx.font = `800 ${Math.round(h * 0.30)}px sans-serif`;
      ctx.fillText(rl, x + 3, y + h * 0.30);
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(h * 0.42)}px sans-serif`;
      ctx.fillText(sym, x + w / 2, y + h * 0.74);
    },

    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      if (id === this.myId) return { x: rect.left + this.W / 2, y: rect.top + this.H - 110 };
      const seat = this.seatPositions().find((s) => s.player.id === id);
      if (!seat) return null;
      return { x: rect.left + seat.x, y: rect.top + seat.y - 48 };
    },
  };

  window.SevenUI = SevenUI;
})();
