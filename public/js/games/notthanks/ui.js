/**
 * 노땡스 게임 화면 캔버스 렌더러.
 * - 렉시오와 동일한 카지노풍 원형(타원) 테이블 + 입체(3D 느낌) 카드 스타일을 재사용.
 * - 개인 손패 대신, 중앙에는 현재 뒤집힌 카드(+쌓인 칩), 화면 하단에는 "내가 모은 카드" 줄을 보여준다.
 * - 모은 카드는 모두 공개 정보이므로 상대 좌석에도 매수/칩을 뱃지로 표시한다.
 */
(function () {
  'use strict';

  const CARD_COLOR = '#ffd76e';

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  const GameUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null,
    anim: 0,
    callbacks: {},
    takeAnim: null, // 카드를 가져가는 애니메이션(중앙 → 좌석)
    chipAnim: null, // 칩을 내려놓는 애니메이션(좌석 → 중앙)

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

      const loop = () => {
        this.anim = performance.now();
        if (this.state) this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    setState(state) {
      this.state = state;
      this.myId = state.you;
    },

    isMyTurn() {
      return this.state && this.state.turnId === this.myId && !this.state.finished;
    },

    myChips() {
      if (!this.state) return 0;
      const me = this.state.players.find((p) => p.id === this.myId);
      return me ? me.chips : 0;
    },

    // 채팅 말풍선 앵커
    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const seat = this.seatPositions().find((s) => s.player.id === id);
      if (!seat) return null;
      const rect = this.canvas.getBoundingClientRect();
      return { x: rect.left + seat.x, y: rect.top + seat.y - 40 };
    },

    seatPositions() {
      const st = this.state;
      const myIdx = st.players.findIndex((p) => p.id === this.myId);
      const others = [];
      for (let k = 1; k < st.players.length; k++) {
        others.push(st.players[(myIdx + k) % st.players.length]);
      }
      const n = others.length;
      const cx = this.W / 2, cy = this.H * 0.42;
      const rx = Math.min(this.W * 0.40, 330);
      const ry = Math.min(this.H * 0.26, rx);
      return others.map((p, i) => {
        const a = Math.PI * (1 - (i + 1) / (n + 1));
        return { player: p, x: cx + Math.cos(a) * rx, y: cy - Math.sin(a) * ry };
      });
    },

    /* ---------- "내가 모은 카드" 줄 레이아웃 ----------
     * 겹쳐서 욱여넣으면 2자리 숫자가 서로 가려 읽을 수 없으므로, 겹치지 않는 간격을 유지할 수 있는
     * 한도까지만 한 줄로 펼치고, 그 이상(카드가 아주 많이 쌓인 경우)은 요약 뱃지로 대체한다.
     * 전체 목록은 "내 카드함" 팝업(DOM)에서 항상 확인할 수 있다.
     */
    myCardsLayout(count) {
      const H = this.H, W = this.W;
      const tw = H < 380 ? 32 : 38, th = Math.round(tw * 1.36);
      const sideReserve = (H < 400 ? 60 : 66) + 12;
      const availW = W - 2 * sideReserve;
      const gap = 4;
      const spacing = tw + gap;
      const neededW = count <= 1 ? tw : tw * count + gap * (count - 1);
      const compact = count > 0 && neededW > availW;
      const totalW = compact ? tw : neededW;
      const startX = (W - totalW) / 2;
      const y = H - th - 10;
      return { tw, th, spacing, startX, y, compact };
    },
    infoX() {
      const sideReserve = (this.H < 400 ? 60 : 66) + 12;
      return Math.max(10, sideReserve);
    },

    /* ---------- 렌더링 ---------- */
    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBackground(ctx);
      this.drawTable(ctx);
      this.drawCenter(ctx);
      this.drawSeats(ctx);
      this.drawMyInfo(ctx);
      this.drawMyCards(ctx);
      this.drawChipAnim(ctx);
      this.drawTakeAnim(ctx);
      if (this.isMyTurn()) this.drawTurnEffects(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#2a2440');
      g.addColorStop(1, '#0b0a10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
      const spotRx = this.W * 0.42;
      const spotRy = Math.min(this.H * 0.34, spotRx);
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#ffd76e';
      ctx.beginPath();
      ctx.ellipse(this.W / 2, this.H * 0.42, spotRx, spotRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    drawTable(ctx) {
      const cx = this.W / 2, cy = this.H * 0.42;
      const rx = Math.min(this.W * 0.34, 300);
      const ry = Math.min(this.H * 0.24, rx);
      ctx.fillStyle = '#1c1206';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, rx + 16, ry + 14, 0, 0, Math.PI * 2);
      ctx.fill();
      const rim = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
      rim.addColorStop(0, '#7a4a22');
      rim.addColorStop(1, '#3d2410');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 16, ry + 12, 0, 0, Math.PI * 2);
      ctx.fill();
      const felt = ctx.createRadialGradient(cx, cy - ry * 0.3, 20, cx, cy, rx);
      felt.addColorStop(0, '#1e5c38');
      felt.addColorStop(1, '#0d3520');
      ctx.fillStyle = felt;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 215, 130, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.8, ry * 0.76, 0, 0, Math.PI * 2);
      ctx.stroke();
    },

    centerXY() {
      return { x: this.W / 2, y: this.H * 0.42 };
    },

    drawCenter(ctx) {
      const st = this.state;
      const { x: cx, y: cy } = this.centerXY();
      const tw = this.H < 380 ? 46 : 56, th = Math.round(tw * 1.36);

      if (st.finished || st.current == null) {
        ctx.font = '700 15px sans-serif';
        ctx.textAlign = 'center';
        const pulse = 0.6 + 0.4 * Math.sin(this.anim / 300);
        ctx.fillStyle = `rgba(255, 231, 176, ${pulse})`;
        ctx.fillText(st.finished ? '🎉 덱 소진! 정산 중…' : '', cx, cy + 4);
        return;
      }

      const flying = this.takeAnim && this.takeAnim.sig === st.seq;
      if (!flying) this.draw3DCard(ctx, cx - tw / 2, cy - th / 2, tw, th, st.current, { glow: this.isMyTurn() });

      // 카드 위에 쌓인 칩
      if (st.pot > 0) {
        const py = cy + th / 2 + 16;
        ctx.font = '800 14px sans-serif';
        ctx.textAlign = 'center';
        const label = `● ${st.pot}`;
        const w = ctx.measureText(label).width + 18;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        this.roundRect(ctx, cx - w / 2, py - 14, w, 20, 10);
        ctx.fill();
        ctx.fillStyle = '#ffd76e';
        ctx.fillText(label, cx, py);
      }

      // 남은 덱 카드 수
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220, 214, 230, 0.65)';
      ctx.fillText(`남은 카드 ${st.deckLeft}장`, cx, cy - th / 2 - 14);
    },

    drawSeats(ctx) {
      const st = this.state;
      const seats = this.seatPositions();
      for (const s of seats) {
        const p = s.player;
        const isTurn = st.turnId === p.id && !st.finished;
        const x = s.x, y = s.y;

        if (isTurn) {
          const pulse = 6 + 3 * Math.sin(this.anim / 250);
          ctx.save();
          ctx.shadowColor = '#ffd76e';
          ctx.shadowBlur = pulse + 10;
          ctx.fillStyle = 'rgba(255, 215, 110, 0.25)';
          ctx.beginPath();
          ctx.arc(x, y - 8, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = p.connected ? (p.isBot ? '#4a4460' : '#5c5480') : '#3a3444';
        ctx.strokeStyle = isTurn ? '#ffd76e' : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = isTurn ? 2.5 : 1;
        ctx.beginPath();
        ctx.arc(x, y - 8, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = '700 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ece7dc';
        ctx.fillText(p.isBot ? '🤖' : p.name.slice(0, 1), x, y - 3);

        if (p.inVoice) {
          ctx.fillStyle = p.micMuted ? 'rgba(107, 53, 53, 0.95)' : 'rgba(44, 86, 54, 0.95)';
          ctx.beginPath();
          ctx.arc(x - 15, y - 22, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '9px sans-serif';
          ctx.fillText(p.micMuted ? '🔕' : '🎙️', x - 15, y - 19);
        }

        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
        ctx.fillText(p.name.slice(0, 8), x, y + 24);

        const badgeY = y + 32;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 34, badgeY, 68, 16, 8);
        ctx.fill();
        ctx.font = '700 10px sans-serif';
        ctx.fillStyle = '#9fe8ff';
        ctx.textAlign = 'left';
        ctx.fillText(`🗂×${p.cards.length}`, x - 31, badgeY + 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = p.chips <= 0 ? '#ff8f8f' : '#ffd76e';
        ctx.fillText(`● ${p.chips}`, x + 15, badgeY + 12);
      }
    },

    drawMyInfo(ctx) {
      const st = this.state;
      const me = st.players.find((p) => p.id === this.myId);
      if (!me) return;
      const L = this.myCardsLayout(me.cards.length);
      const x = this.infoX();
      const rowY = L.y - 10;
      const isTurn = this.isMyTurn();

      ctx.textAlign = 'left';
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
      ctx.fillText(me.name, x, rowY);
      const nameW = ctx.measureText(me.name).width;
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = me.chips <= 0 ? '#ff8f8f' : '#ffd76e';
      ctx.fillText(`● ${me.chips}`, x + nameW + 8, rowY);

      if (isTurn) {
        const pulse = 0.6 + 0.4 * Math.sin(this.anim / 220);
        const label = me.chips <= 0 ? '▶ 내 차례 (칩 없음 · 가져가기만 가능)' : '▶ 내 차례';
        ctx.font = '800 12px sans-serif';
        const topY = rowY - 18;
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
      }
    },

    drawMyCards(ctx) {
      const st = this.state;
      const me = st.players.find((p) => p.id === this.myId);
      if (!me || !me.cards.length) return;
      const cards = me.cards.slice().sort((a, b) => a - b);
      const L = this.myCardsLayout(cards.length);
      if (L.compact) { this.drawMyCardsBadge(ctx, cards, L); return; }
      // 방금 가져온 카드가 아직 중앙→내 카드줄로 날아오는 중이면, 도착 지점에 같은 카드가
      // 두 번(정착한 카드 + 날아오는 카드) 겹쳐 보이지 않도록 정착 쪽 타일은 잠시 그리지 않는다.
      // (자리는 그대로 유지해 다른 카드들이 밀리지 않게 한다.)
      const flying = this.takeAnim && this.takeAnim.sig === st.seq && this.takeAnim.toMe;
      const skipIdx = flying ? cards.indexOf(this.takeAnim.card) : -1;
      for (let i = 0; i < cards.length; i++) {
        if (i === skipIdx) continue;
        const runStart = i === 0 || cards[i] !== cards[i - 1] + 1;
        const x = L.startX + L.spacing * i;
        this.draw3DCard(ctx, x, L.y, L.tw, L.th, cards[i], { dim: !runStart });
      }
    },

    // 카드가 너무 많이 쌓여 한 줄에 겹치지 않게 다 펼칠 수 없을 때의 요약 뱃지.
    // 전체 목록은 "내 카드함" 팝업에서 확인할 수 있다.
    drawMyCardsBadge(ctx, cards, L) {
      const sum = cards.reduce((a, c) => a + c, 0);
      const label = `🗂 ${cards.length}장 (합계 ${sum}) · "내 카드함"에서 자세히 보기`;
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 24;
      const cx = this.W / 2, y = L.y + L.th / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.roundRect(ctx, cx - w / 2, y - 14, w, 28, 10);
      ctx.fill();
      ctx.fillStyle = '#ffd76e';
      ctx.fillText(label, cx, y + 5);
    },

    /* ---------- 애니메이션 ---------- */
    seatXYOf(id) {
      if (id === this.myId) {
        const st = this.state;
        const me = st.players.find((p) => p.id === this.myId);
        const L = this.myCardsLayout(me ? me.cards.length : 0);
        return { x: this.W / 2, y: L.y + L.th / 2 };
      }
      const seat = this.seatPositions().find((s) => s.player.id === id);
      return seat ? { x: seat.x, y: seat.y - 8 } : { x: this.W / 2, y: this.H * 0.2 };
    },
    startTakeAnim(byId, card, seq) {
      const { x, y } = this.centerXY();
      this.takeAnim = { sig: seq, card, toMe: byId === this.myId, from: { x, y }, to: this.seatXYOf(byId), start: performance.now(), dur: 380 };
    },
    startChipAnim(byId, seq) {
      const { x, y } = this.centerXY();
      const from = this.seatXYOf(byId);
      this.chipAnim = { sig: seq, from, to: { x, y }, start: performance.now(), dur: 300 };
    },
    drawTakeAnim(ctx) {
      const a = this.takeAnim;
      if (!a) return;
      if (!this.state || this.state.seq !== a.sig) { this.takeAnim = null; return; }
      const now = this.anim || performance.now();
      const p = (now - a.start) / a.dur;
      if (p >= 1) { this.takeAnim = null; return; }
      const ease = 1 - Math.pow(1 - p, 3);
      const tw = (this.H < 380 ? 46 : 56) * (1 - 0.3 * ease);
      const th = Math.round(tw * 1.36);
      const x = a.from.x + (a.to.x - a.from.x) * ease;
      const y = a.from.y + (a.to.y - a.from.y) * ease;
      ctx.save();
      ctx.globalAlpha = 1 - 0.15 * ease;
      this.draw3DCard(ctx, x - tw / 2, y - th / 2, tw, th, a.card, { glow: true });
      ctx.restore();
    },
    drawChipAnim(ctx) {
      const a = this.chipAnim;
      if (!a) return;
      if (!this.state || this.state.seq !== a.sig) { this.chipAnim = null; return; }
      const now = this.anim || performance.now();
      const p = (now - a.start) / a.dur;
      if (p >= 1) { this.chipAnim = null; return; }
      const ease = 1 - Math.pow(1 - p, 2);
      const x = a.from.x + (a.to.x - a.from.x) * ease;
      const y = a.from.y + (a.to.y - a.from.y) * ease;
      ctx.save();
      ctx.fillStyle = '#ffd76e';
      ctx.shadowColor = '#ffd76e';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

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
    },

    /* ---------- 카드 드로잉 ---------- */
    draw3DCard(ctx, x, y, w, h, num, opts) {
      opts = opts || {};
      ctx.save();
      if (opts.glow) {
        ctx.shadowColor = '#ffd76e';
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = '#060509';
      this.roundRect(ctx, x + 2.5, y + 3.5, w, h, 6);
      ctx.fill();
      const body = ctx.createLinearGradient(x, y, x, y + h);
      body.addColorStop(0, '#232030');
      body.addColorStop(1, '#131019');
      ctx.fillStyle = body;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = opts.glow ? '#ffd76e' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = opts.glow ? 2 : 1;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = CARD_COLOR;
      ctx.font = `800 ${Math.round(h * 0.4)}px sans-serif`;
      ctx.fillText(String(num), x + w / 2, y + h * 0.6);

      if (opts.dim) {
        ctx.fillStyle = 'rgba(5, 5, 10, 0.35)';
        this.roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
      }
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
  };

  window.NoThanksUI = GameUI;
})();
