/**
 * 게임 화면 캔버스 렌더러 + 입력 처리.
 * - 카지노풍 원형(타원) 테이블, 입체(3D 느낌) 타일
 * - 내 손패: 오름차순 자동 정렬 + 드래그 수동 정렬(액티브 효과)
 * - 낼 수 있는 패 / 없는 패 구분 표시, 선/차례 표시, 마지막 낸 패 표시
 */
(function () {
  'use strict';
  const core = window.LexioCore;

  const SUIT_COLOR = { sun: '#ff6b57', moon: '#52d273', star: '#ffd23e', cloud: '#4db3ff' };

  const GameUI = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    state: null, myId: null,
    handOrder: [],       // 타일 id 배열 (표시 순서)
    selected: new Set(), // 선택된 타일 id
    playable: new Set(),
    manualOrder: false,
    // 드래그 상태
    pointer: null, // {id, startX, startY, x, y, dragging, tileIdx}
    dragInsert: -1,
    anim: 0,
    callbacks: {},
    lastEvent: null, // {text, until}
    chatBubbles: new Map(), // playerId -> {text, until} 채팅 말풍선

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
      };
      this.resize = resize;
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', () => setTimeout(resize, 250));
      // 화면 전환(display:none → block)으로 크기가 바뀌는 시점도 감지
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
      const prevRound = this.state && this.state.roundNo;
      const prev = this.state;
      this.state = state;
      this.myId = state.you;

      const ids = state.hand.map((t) => t.id);
      if (prevRound !== state.roundNo || !this.handOrder.length) {
        this.manualOrder = false;
      }
      if (this.manualOrder) {
        // 수동 순서 유지, 사라진 타일 제거
        this.handOrder = this.handOrder.filter((id) => ids.includes(id));
        for (const id of ids) if (!this.handOrder.includes(id)) this.handOrder.push(id);
      } else {
        this.handOrder = core.sortTiles(state.hand, state.maxN).map((t) => t.id);
      }
      // 선택 유지하되 없는 타일 제거
      this.selected = new Set([...this.selected].filter((id) => ids.includes(id)));
      this.updatePlayable();

      // 마지막 액션 문구
      if (prev && state.table && (!prev.table || prev.table.byId !== state.table.byId ||
          JSON.stringify(prev.table.tiles.map(t=>t.id)) !== JSON.stringify(state.table.tiles.map(t=>t.id)))) {
        this.lastEvent = null;
      }
      this.notifyButtons();
    },

    sortHand() {
      if (!this.state) return;
      this.manualOrder = false;
      this.handOrder = core.sortTiles(this.state.hand, this.state.maxN).map((t) => t.id);
    },

    tileById(id) {
      return this.state.hand.find((t) => t.id === id);
    },

    isMyTurn() {
      return this.state && this.state.turnId === this.myId && !this.state.finished;
    },

    currentCombo() {
      return this.state && this.state.table ? this.state.table.combo : null;
    },

    updatePlayable() {
      if (!this.state) return;
      if (this.isMyTurn()) {
        this.playable = core.playableTileIds(this.state.hand, this.currentCombo(), this.state.maxN);
      } else {
        this.playable = null; // 내 차례 아님 → 구분 표시 없음
      }
    },

    selectedCombo() {
      if (!this.selected.size) return null;
      const tiles = [...this.selected].map((id) => this.tileById(id)).filter(Boolean);
      return core.analyze(tiles, this.state.maxN);
    },

    canPlaySelection() {
      if (!this.isMyTurn()) return false;
      const combo = this.selectedCombo();
      if (!combo) return false;
      const cur = this.currentCombo();
      if (!cur) return true;
      return combo.count === cur.count && core.beats(combo, cur);
    },

    selectTiles(ids) {
      this.selected = new Set(ids);
      if (window.Sound) window.Sound.select();
      this.notifyButtons();
    },

    notifyButtons() {
      if (this.callbacks.onSelectionChange) this.callbacks.onSelectionChange();
    },

    // 채팅 메시지 도착 시 해당 플레이어 아이콘 옆에 몇 초간 말풍선 표시. 같은 사람이 다시 보내면 이전 것을 대체.
    showChatBubble(id, text) {
      this.chatBubbles.set(id, { text, until: performance.now() + 5000 });
    },

    /* ---------- 레이아웃 ---------- */
    handLayout() {
      const n = this.handOrder.length;
      const H = this.H, W = this.W;
      const tw = H < 380 ? 38 : 44; // 손패 칸 크기를 줄여 위쪽 정보 영역과의 겹침을 방지
      const th = Math.round(tw * 1.38);
      const availW = W - 150; // 오른쪽 HUD 버튼 영역 제외
      const spacing = n > 1 ? Math.min(tw + 5, (availW - tw) / (n - 1)) : 0;
      const totalW = tw + spacing * (n - 1);
      const x0 = (W - 70 - totalW) / 2 + 0; // 살짝 좌측 중심
      const y = H - th - 10;
      return { n, tw, th, spacing, x0, y };
    },

    tileRectAt(i) {
      const L = this.handLayout();
      const id = this.handOrder[i];
      const sel = this.selected.has(id);
      return { x: L.x0 + i * L.spacing, y: L.y - (sel ? 14 : 0), w: L.tw, h: L.th };
    },

    seatPositions() {
      // 상대 좌석: 내 다음 차례부터 시계 방향(왼쪽→위→오른쪽)
      const st = this.state;
      const myIdx = st.players.findIndex((p) => p.id === this.myId);
      const others = [];
      for (let k = 1; k < st.players.length; k++) {
        others.push(st.players[(myIdx + k) % st.players.length]);
      }
      const n = others.length;
      const cx = this.W / 2, cy = this.H * 0.47;
      const rx = Math.min(this.W * 0.40, 330), ry = this.H * 0.30;
      // 왼쪽(180°)에서 오른쪽(0°)으로 균등 배치 → 턴 진행 방향이 왼쪽→오른쪽
      return others.map((p, i) => {
        const a = Math.PI * (1 - (i + 1) / (n + 1));
        return { player: p, x: cx + Math.cos(a) * rx, y: cy - Math.sin(a) * ry };
      });
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
      this.drawHand(ctx);
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#2a2440');
      g.addColorStop(1, '#0b0a10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
      // 은은한 스포트라이트
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#ffd76e';
      ctx.beginPath();
      ctx.ellipse(this.W / 2, this.H * 0.48, this.W * 0.42, this.H * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    drawTable(ctx) {
      const cx = this.W / 2, cy = this.H * 0.47;
      const rx = Math.min(this.W * 0.34, 300), ry = this.H * 0.27;
      // 테이블 두께(입체감): 아래쪽 어두운 타원
      ctx.fillStyle = '#1c1206';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 10, rx + 16, ry + 14, 0, 0, Math.PI * 2);
      ctx.fill();
      // 나무 테두리
      const rim = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
      rim.addColorStop(0, '#7a4a22');
      rim.addColorStop(1, '#3d2410');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 16, ry + 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // 펠트
      const felt = ctx.createRadialGradient(cx, cy - ry * 0.3, 20, cx, cy, rx);
      felt.addColorStop(0, '#1e5c38');
      felt.addColorStop(1, '#0d3520');
      ctx.fillStyle = felt;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // 안쪽 라인
      ctx.strokeStyle = 'rgba(255, 215, 130, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.8, ry * 0.76, 0, 0, Math.PI * 2);
      ctx.stroke();
    },

    drawCenter(ctx) {
      const st = this.state;
      const cx = this.W / 2, cy = this.H * 0.47;
      if (st.table) {
        const tiles = st.table.tiles;
        const tw = this.H < 380 ? 34 : 40, th = Math.round(tw * 1.38);
        const overlap = tiles.length > 3 ? tw * 0.62 : tw * 0.85;
        const totalW = tw + overlap * (tiles.length - 1);
        let x = cx - totalW / 2;
        const y = cy - th / 2 + 6;
        for (const t of tiles) {
          this.draw3DTile(ctx, x, y, tw, th, t, {});
          x += overlap;
        }
        if (st.finished) {
          this.drawFinishBanner(ctx, cx, y);
        } else {
          // 누가 낸 패인지 + 조합명
          const label = `${st.table.byName} · ${core.TYPE_LABEL[st.table.combo.type]}`;
          ctx.font = '700 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffe9b0';
          const tx = cx, ty = y - 12;
          const w = ctx.measureText(label).width + 20;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          this.roundRect(ctx, tx - w / 2, ty - 14, w, 20, 10);
          ctx.fill();
          ctx.fillStyle = '#ffe9b0';
          ctx.fillText(label, tx, ty);
        }
      } else {
        ctx.font = '700 14px sans-serif';
        ctx.textAlign = 'center';
        const pulse = 0.6 + 0.4 * Math.sin(this.anim / 300);
        ctx.fillStyle = `rgba(255, 231, 176, ${pulse})`;
        const leader = st.players.find((p) => p.id === st.turnId);
        const text = st.turnId === this.myId
          ? '당신이 선입니다 — 원하는 조합을 내세요'
          : `${leader ? leader.name : ''} 님이 선입니다`;
        ctx.fillText(text, cx, cy + 4);
      }
    },

    // 라운드 종료: 마지막 패를 낸 사람을 잠시 크게 알려준다(결과 팝업이 뜨기 전 텀).
    drawFinishBanner(ctx, cx, tileY) {
      const st = this.state;
      const name = (st.table && st.table.byName) || '';
      const pulse = 0.65 + 0.35 * Math.sin(this.anim / 220);
      const label = `🎉 ${name}님이 모든 패를 냈습니다!`;
      ctx.font = '800 15px sans-serif';
      ctx.textAlign = 'center';
      const ty = tileY - 16;
      const w = ctx.measureText(label).width + 28;
      ctx.save();
      ctx.shadowColor = '#ffd76e';
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = 'rgba(30, 20, 5, 0.78)';
      this.roundRect(ctx, cx - w / 2, ty - 17, w, 25, 13);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = `rgba(255, 231, 176, ${pulse})`;
      ctx.fillText(label, cx, ty);
    },

    // 채팅 말풍선: cx 위치 위로 꼬리가 bottomY를 가리키는 말풍선을 그린다.
    drawSpeechBubble(ctx, cx, bottomY, text) {
      const maxChars = 26;
      const label = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
      ctx.save();
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'center';
      const textW = ctx.measureText(label).width;
      const padX = 10;
      const w = Math.min(Math.max(textW + padX * 2, 30), 200);
      const h = 22;
      const bx = Math.max(4, Math.min(cx - w / 2, this.W - w - 4));
      const by = bottomY - h - 7;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, bx, by, w, h, 8);
      ctx.fill();
      ctx.stroke();
      // 말풍선 꼬리(아이콘을 가리킴)
      ctx.beginPath();
      ctx.moveTo(cx - 6, by + h);
      ctx.lineTo(cx + 6, by + h);
      ctx.lineTo(cx, by + h + 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#181524';
      ctx.fillText(label, bx + w / 2, by + h / 2 + 4);
      ctx.restore();
    },

    drawSeats(ctx) {
      const st = this.state;
      const seats = this.seatPositions();
      for (const s of seats) {
        const p = s.player;
        const isTurn = st.turnId === p.id && !st.finished;
        const isLeader = st.leaderId === p.id;
        const x = s.x, y = s.y;

        // 차례 글로우
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
        // 아바타
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

        // 음성채팅 참여 표시
        if (p.inVoice) {
          ctx.fillStyle = p.micMuted ? 'rgba(107, 53, 53, 0.95)' : 'rgba(44, 86, 54, 0.95)';
          ctx.beginPath();
          ctx.arc(x - 15, y - 22, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '9px sans-serif';
          ctx.fillText(p.micMuted ? '🔕' : '🎙️', x - 15, y - 19);
        }

        // 선 배지
        if (isLeader) {
          ctx.fillStyle = '#c98a2e';
          ctx.beginPath();
          ctx.arc(x + 16, y - 22, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff3d6';
          ctx.font = '700 10px sans-serif';
          ctx.fillText('선', x + 16, y - 18.5);
        }
        // 이름
        ctx.font = '600 11px sans-serif';
        ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
        ctx.fillText(p.name.slice(0, 8), x, y + 24);
        // 남은 타일 수 (렉시오 타일 뒷면 아이콘)
        const badgeY = y + 32;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.roundRect(ctx, x - 34, badgeY, 68, 16, 8);
        ctx.fill();
        this.drawTileBackIcon(ctx, x - 31, badgeY + 2, 9, 12);
        ctx.font = '700 10px sans-serif';
        ctx.fillStyle = '#9fe8ff';
        ctx.textAlign = 'left';
        ctx.fillText(`×${p.tileCount}`, x - 19, badgeY + 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd76e';
        ctx.fillText(`● ${p.chips}`, x + 16, badgeY + 12);
        // PASS 표시
        if (p.passed) {
          ctx.fillStyle = 'rgba(120, 40, 55, 0.9)';
          this.roundRect(ctx, x - 22, y - 16, 44, 17, 9);
          ctx.fill();
          ctx.fillStyle = '#ffc9c9';
          ctx.font = '800 10px sans-serif';
          ctx.fillText('PASS', x, y - 4);
        }
        // 채팅 말풍선
        const bubble = this.chatBubbles.get(p.id);
        if (bubble && bubble.until > this.anim) {
          this.drawSpeechBubble(ctx, x, y - 40, bubble.text);
        }
      }
    },

    drawMyInfo(ctx) {
      const st = this.state;
      const me = st.players.find((p) => p.id === this.myId);
      if (!me) return;
      const L = this.handLayout();
      const x = 10;
      // 손패 바로 위에 두 줄로 압축 배치 (겹침 방지): 아래 줄=이름/칩/선, 위 줄=차례·패스 표시
      const rowY = L.y - 10;
      const topY = rowY - 16;
      const isTurn = this.isMyTurn();

      ctx.textAlign = 'left';
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = isTurn ? '#ffe9b0' : '#c9c2d6';
      ctx.fillText(me.name, x, rowY);
      const nameW = ctx.measureText(me.name).width;
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = '#ffd76e';
      const chipsLabel = `● ${me.chips}점`;
      ctx.fillText(chipsLabel, x + nameW + 8, rowY);
      if (st.leaderId === this.myId) {
        const chipsW = ctx.measureText(chipsLabel).width;
        const bx = x + nameW + 8 + chipsW + 6;
        ctx.fillStyle = '#c98a2e';
        this.roundRect(ctx, bx, rowY - 12, 22, 15, 7);
        ctx.fill();
        ctx.fillStyle = '#fff3d6';
        ctx.font = '700 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('선', bx + 11, rowY - 1);
        ctx.textAlign = 'left';
      }

      if (isTurn) {
        const pulse = 0.6 + 0.4 * Math.sin(this.anim / 250);
        ctx.fillStyle = `rgba(255, 215, 110, ${pulse})`;
        ctx.font = '800 12px sans-serif';
        ctx.fillText('▶ 내 차례', x, topY);
      } else if (me.passed) {
        ctx.fillStyle = 'rgba(120, 40, 55, 0.9)';
        this.roundRect(ctx, x, topY - 12, 44, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#ffc9c9';
        ctx.font = '800 10px sans-serif';
        ctx.fillText('PASS', x + 7, topY);
      }

      // 채팅 말풍선
      const myBubble = this.chatBubbles.get(this.myId);
      if (myBubble && myBubble.until > this.anim) {
        this.drawSpeechBubble(ctx, x + Math.min(80, nameW + 40), topY - 8, myBubble.text);
      }
    },

    drawHand(ctx) {
      const L = this.handLayout();
      const dragging = this.pointer && this.pointer.dragging;
      for (let i = 0; i < this.handOrder.length; i++) {
        if (dragging && i === this.pointer.tileIdx) continue; // 드래그 중인 타일은 마지막에
        let x = L.x0 + i * L.spacing;
        // 드래그 삽입 위치 표시: 자리 이동
        if (dragging && this.dragInsert >= 0) {
          const from = this.pointer.tileIdx;
          const to = this.dragInsert;
          let vi = i;
          if (from < to && i > from && i <= to) vi = i - 1;
          else if (from > to && i >= to && i < from) vi = i + 1;
          x = L.x0 + vi * L.spacing;
        }
        const id = this.handOrder[i];
        const t = this.tileById(id);
        if (!t) continue;
        const sel = this.selected.has(id);
        const dim = this.playable ? !this.playable.has(id) : false;
        this.draw3DTile(ctx, x, L.y - (sel ? 14 : 0), L.tw, L.th, t, { selected: sel, dimmed: dim });
      }
      // 드래그 삽입 슬롯 하이라이트
      if (dragging && this.dragInsert >= 0) {
        const x = L.x0 + this.dragInsert * L.spacing;
        ctx.save();
        ctx.strokeStyle = '#ffd76e';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        this.roundRect(ctx, x - 2, L.y - 4, L.tw + 4, L.th + 8, 8);
        ctx.stroke();
        ctx.restore();
      }
      // 드래그 중인 타일을 포인터 위치에 확대+글로우로
      if (dragging) {
        const id = this.handOrder[this.pointer.tileIdx];
        const t = this.tileById(id);
        if (t) {
          const w = L.tw * 1.12, h = L.th * 1.12;
          this.draw3DTile(ctx, this.pointer.x - w / 2, this.pointer.y - h * 0.7, w, h, t, {
            selected: this.selected.has(id), glow: true,
          });
        }
      }
    },

    draw3DTile(ctx, x, y, w, h, tile, opts) {
      opts = opts || {};
      const isTop = tile.num === 2; // 렉시오 최고 패 — 화려하게 강조
      ctx.save();
      if (opts.glow) {
        ctx.shadowColor = '#ffd76e';
        ctx.shadowBlur = 16;
      } else if (isTop) {
        ctx.shadowColor = '#ffcf4a';
        ctx.shadowBlur = 9;
      }
      // 입체 옆면 (아래+오른쪽)
      ctx.fillStyle = '#060509';
      this.roundRect(ctx, x + 2.5, y + 3.5, w, h, 6);
      ctx.fill();
      // 본체
      const body = ctx.createLinearGradient(x, y, x, y + h);
      if (isTop) {
        body.addColorStop(0, '#3d2a10');
        body.addColorStop(0.5, '#241606');
        body.addColorStop(1, '#120a02');
      } else {
        body.addColorStop(0, '#232030');
        body.addColorStop(1, '#131019');
      }
      ctx.fillStyle = body;
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isTop) {
        // 대각선으로 흐르는 반짝임
        ctx.save();
        this.roundRect(ctx, x, y, w, h, 6);
        ctx.clip();
        const phase = (this.anim / 900) % 1;
        const sx = x - w + phase * (w * 3);
        const shine = ctx.createLinearGradient(sx, y, sx + w * 0.7, y + h);
        shine.addColorStop(0, 'rgba(255,255,255,0)');
        shine.addColorStop(0.5, 'rgba(255,255,255,0.3)');
        shine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        // 이중 금테(안쪽)
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 1.6;
        this.roundRect(ctx, x + 1.8, y + 1.8, w - 3.6, h - 3.6, 5);
        ctx.stroke();
      }

      // 윗면 테두리
      ctx.strokeStyle = opts.selected ? '#ffd76e' : (isTop ? '#ffcf4a' : 'rgba(255,255,255,0.18)');
      ctx.lineWidth = opts.selected ? 2 : (isTop ? 1.5 : 1);
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.stroke();

      // 숫자/무늬
      const color = SUIT_COLOR[tile.suit];
      ctx.textAlign = 'center';
      if (isTop) {
        ctx.shadowColor = 'rgba(255, 210, 100, 0.9)';
        ctx.shadowBlur = 5;
      }
      ctx.fillStyle = color;
      ctx.font = `800 ${Math.round(h * 0.34)}px sans-serif`;
      ctx.fillText(String(tile.num), x + w / 2, y + h * 0.45);
      ctx.font = `${Math.round(h * 0.26)}px sans-serif`;
      ctx.fillText(core.SUIT_SYMBOL[tile.suit], x + w / 2, y + h * 0.82);
      ctx.shadowBlur = 0;

      // 낼 수 없는 패는 어둡게
      if (opts.dimmed) {
        ctx.fillStyle = 'rgba(5, 5, 10, 0.62)';
        this.roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
      }
      ctx.restore();
    },

    // 남은 타일 수 배지용 — 렉시오 타일 뒷면을 축소한 아이콘(마작패 이모지 대체)
    drawTileBackIcon(ctx, x, y, w, h) {
      const body = ctx.createLinearGradient(x, y, x, y + h);
      body.addColorStop(0, '#2c2740');
      body.addColorStop(1, '#171325');
      ctx.fillStyle = body;
      this.roundRect(ctx, x, y, w, h, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 215, 130, 0.55)';
      ctx.lineWidth = 0.8;
      this.roundRect(ctx, x, y, w, h, 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 215, 130, 0.75)';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h * 0.2);
      ctx.lineTo(x + w * 0.8, y + h / 2);
      ctx.lineTo(x + w / 2, y + h * 0.8);
      ctx.lineTo(x + w * 0.2, y + h / 2);
      ctx.closePath();
      ctx.fill();
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

    /* ---------- 입력 ---------- */
    eventPos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },

    hitTile(x, y) {
      for (let i = this.handOrder.length - 1; i >= 0; i--) {
        const r = this.tileRectAt(i);
        // 겹침 보정: 다음 타일이 덮는 부분은 다음 타일 우선 (역순 탐색으로 해결)
        if (x >= r.x && x <= r.x + r.w && y >= r.y - 6 && y <= r.y + r.h) return i;
      }
      return -1;
    },

    onDown(e) {
      if (!this.state) return;
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
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
          this.pointer.dragging = true;
        }
      }
      if (this.pointer.dragging) {
        const L = this.handLayout();
        let ins = Math.round((p.x - L.x0) / (L.spacing || 1));
        this.dragInsert = Math.max(0, Math.min(this.handOrder.length - 1, ins));
      }
    },

    onUp(e) {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      const { dragging, tileIdx } = this.pointer;
      if (dragging && this.dragInsert >= 0 && this.dragInsert !== tileIdx) {
        const id = this.handOrder[tileIdx];
        this.handOrder.splice(tileIdx, 1);
        this.handOrder.splice(this.dragInsert, 0, id);
        this.manualOrder = true;
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

  window.GameUI = GameUI;
})();
