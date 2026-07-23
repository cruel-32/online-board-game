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
      if (key && key !== this.lastResultKey) { this.lastResultKey = key; this.lastResultUntil = performance.now() + 4000; }
    },

    isMyTurn() { return this.state && this.state.turnId === this.myId && !this.state.finished; },

    /* ---------- 입력: 손패 선택(배치 단계) ---------- */
    onDown(e) {
      if (!this.state || this.state.phase !== 'placing' || !this.isMyTurn()) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      for (const hr of this.handRects) {
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
      this.drawMouseRow(ctx);
      this.drawAnimalRow(ctx);
      this.drawPlayers(ctx);
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
      const y = 12;
      ctx.textAlign = 'center';
      for (const m of mice) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,215,130,0.35)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, x, y, cw, ch, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f0d78a';
        ctx.font = '800 15px sans-serif';
        ctx.fillText(String(m.num), x + cw / 2, y + 15);
        ctx.fillStyle = m.coins > 0 ? '#ffd76e' : '#6f6a80';
        ctx.font = '700 11px sans-serif';
        ctx.fillText('🪙' + m.coins, x + cw / 2, y + 29);
        x += cw + gap;
      }
      // 은행
      ctx.fillStyle = '#9a93a8';
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`은행 🪙${st.bank}`, (this.W + totalW) / 2 + 14, y + 22);
    },

    // 동물 카드 열(자루)
    drawAnimalRow(ctx) {
      const st = this.state;
      const row = st.row || [];
      const cw = this.H < 420 ? 46 : 56, ch = Math.round(cw * 1.4), gap = 10;
      const totalW = row.length * cw + Math.max(0, row.length - 1) * gap;
      let x = (this.W - totalW) / 2;
      const y = this.H * 0.30;
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
        // 소유자 색 점 + 자루/시작 표시(i===0)
        ctx.fillStyle = ownerColor;
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch + 9, 5, 0, Math.PI * 2);
        ctx.fill();
        if (i === 0) {
          ctx.fillStyle = '#c98a2e';
          ctx.font = '700 10px sans-serif';
          ctx.fillText('자루', x + cw / 2, y - 6);
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

    // 플레이어 배지 행
    drawPlayers(ctx) {
      const st = this.state;
      const players = st.players || [];
      const bw = 118, bh = 46, gap = 8;
      const totalW = players.length * bw + (players.length - 1) * gap;
      let x = Math.max(8, (this.W - totalW) / 2);
      const y = this.H * 0.30 + (this.H < 420 ? 46 : 56) * 1.4 + 26;
      for (const p of players) {
        const isTurn = st.turnId === p.id && !st.finished;
        const color = core.COLOR_HEX[p.color] || '#888';
        ctx.fillStyle = isTurn ? 'rgba(255,215,110,0.16)' : 'rgba(255,255,255,0.05)';
        ctx.strokeStyle = isTurn ? '#ffd76e' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = isTurn ? 2 : 1;
        this.roundRect(ctx, x, y, bw, bh, 9); ctx.fill(); ctx.stroke();
        // 색 칩
        ctx.fillStyle = color;
        this.roundRect(ctx, x + 7, y + 7, 10, 10, 3); ctx.fill();
        // 이름 + 선
        ctx.textAlign = 'left';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#d8d2e4';
        ctx.font = '700 12px sans-serif';
        ctx.fillText((p.name || '').slice(0, 6) + (p.isStart ? ' ⭐' : ''), x + 22, y + 16);
        // 코인 / 입찰 / 상태
        ctx.font = '700 11px sans-serif';
        ctx.fillStyle = '#ffd76e';
        const coinTxt = p.coins == null ? '🪙?' : '🪙' + p.coins;
        ctx.fillText(coinTxt, x + 8, y + 33);
        ctx.fillStyle = '#9fe8ff';
        ctx.fillText('🐱' + p.collectedCount, x + 8, y + 43);
        ctx.textAlign = 'right';
        if (p.passed) {
          ctx.fillStyle = '#ff9a9a'; ctx.font = '800 11px sans-serif';
          ctx.fillText('패스', x + bw - 8, y + 33);
        } else if (p.bid > 0) {
          ctx.fillStyle = '#ffe9b0'; ctx.font = '800 12px sans-serif';
          ctx.fillText('입찰 ' + p.bid, x + bw - 8, y + 33);
        }
        x += bw + gap;
      }
    },

    // 내 손패(배치 단계에 클릭 선택)
    drawHand(ctx) {
      this.handRects = [];
      const st = this.state;
      const hand = st.hand || [];
      if (!hand.length) return;
      const cw = this.H < 420 ? 40 : 48, ch = Math.round(cw * 1.4), gap = 6;
      const availW = this.W - 160;
      const spacing = hand.length > 1 ? Math.min(cw + gap, (availW - cw) / (hand.length - 1)) : 0;
      const totalW = cw + spacing * (hand.length - 1);
      let x0 = (this.W - 70 - totalW) / 2;
      const y = this.H - ch - 12;
      const canPlace = st.phase === 'placing' && this.isMyTurn();
      for (let i = 0; i < hand.length; i++) {
        const c = hand[i];
        const x = x0 + i * spacing;
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
      // 내 정보(좌하단)
      const me = (st.players || []).find((p) => p.id === this.myId);
      if (me) {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd76e'; ctx.font = '700 12px sans-serif';
        ctx.fillText(`${me.name}  🪙${me.coins}`, 10, y - 8);
      }
    },

    // 지난 라운드 결과 배너
    drawLastResult(ctx) {
      if (this.lastResultUntil < this.anim) return;
      const lr = this.state.lastResult;
      if (!lr) return;
      let text;
      if (lr.discarded) text = '전원 패스 — 자루의 카드를 모두 버립니다';
      else {
        const dog = lr.removed.find((c) => c.kind === 'dog');
        const cat = lr.removed.find((c) => c.kind === 'cat');
        const dogNote = dog ? ` (개가 ${cat ? (cat.value > 0 ? '+' : '') + cat.value + ' 고양이를 쫓아냄' : '자기들끼리 놀아 사라짐'})` : '';
        text = `지난 라운드: ${lr.winnerName}님이 ${lr.bid} 코인에 획득${dogNote}`;
      }
      ctx.save();
      ctx.font = '800 14px sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 28;
      const x = this.W / 2, y = this.H * 0.30 - 26;
      ctx.fillStyle = 'rgba(20,30,20,0.9)';
      ctx.strokeStyle = 'rgba(255,215,130,0.5)'; ctx.lineWidth = 1;
      this.roundRect(ctx, x - w / 2, y - 16, w, 24, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(text, x, y);
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
      const players = this.state.players || [];
      const idx = players.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      const bw = 118, gap = 8;
      const totalW = players.length * bw + (players.length - 1) * gap;
      const x0 = Math.max(8, (this.W - totalW) / 2);
      const cx = x0 + idx * (bw + gap) + bw / 2;
      const y = this.H * 0.30 + (this.H < 420 ? 46 : 56) * 1.4 + 26;
      const rect = this.canvas.getBoundingClientRect();
      return { x: rect.left + cx, y: rect.top + y };
    },

    _colorOf(id) {
      const p = (this.state.players || []).find((x) => x.id === id);
      return p ? p.color : null;
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
