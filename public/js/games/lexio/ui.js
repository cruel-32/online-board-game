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

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

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
    turnFlashUntil: 0, // 내 차례가 막 시작됐을 때 강조 배너를 잠시 띄우기 위한 타임스탬프

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
      const wasMyTurn = !!(prev && prev.turnId === prev.you && !prev.finished);
      const isMyTurnNow = state.turnId === state.you && !state.finished;
      if (isMyTurnNow && !wasMyTurn) this.turnFlashUntil = performance.now() + 1400;
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

    // 채팅 말풍선 앵커: 해당 플레이어 아바타 위쪽의 페이지 좌표를 반환(Chat 코어가 사용).
    // 현재 게임 화면에 없는 상대(또는 나 자신)는 null.
    bubbleAnchor(id) {
      if (!this.state || !this.canvas) return null;
      const seat = this.seatPositions().find((s) => s.player.id === id);
      if (!seat) return null;
      const rect = this.canvas.getBoundingClientRect();
      return { x: rect.left + seat.x, y: rect.top + seat.y - 40 };
    },

    /* ---------- 레이아웃 ----------
     * 세로 모드(H > W)에서만 손패가 7장을 넘어가면 두 줄로 나눠 가로 폭을 줄인다
     * (예: 13장 → 앞줄 7장 + 뒷줄 6장). 가로 모드에서는 항상 한 줄로 표시한다.
     * 그래도 가용 폭이 좁을 때는 타일 크기 자체도 줄여 화면 밖으로 잘리지 않게 한다.
     */
    handLayout() {
      const n = this.handOrder.length;
      const H = this.H, W = this.W;
      const portrait = H > W;
      const twoRows = portrait && n > 7;
      const c0 = twoRows ? Math.ceil(n / 2) : n;   // 앞줄(화면 하단, 더 많은 쪽) 개수
      const c1 = twoRows ? n - c0 : 0;              // 뒷줄(앞줄 위쪽) 개수
      const maxCount = Math.max(c0, c1, 1);
      // 패스(좌)·내기(우) 버튼이 화면 양끝 코너에 있으므로 좌우 양쪽을 비워 손패를 가운데로 모은다.
      const sideReserve = (H < 400 ? 60 : 66) + 12;
      const availW = W - 2 * sideReserve;

      let tw = H < 380 ? 38 : 44; // 손패 칸 크기를 줄여 위쪽 정보 영역과의 겹침을 방지
      if (maxCount > 1) {
        const neededW = tw + (tw + 5) * (maxCount - 1);
        if (neededW > availW) {
          tw = Math.max(22, Math.floor((availW - 5 * (maxCount - 1)) / maxCount));
        }
      } else if (tw > availW) {
        tw = Math.max(22, availW);
      }
      const th = Math.round(tw * 1.38);
      const spacing = maxCount > 1 ? Math.min(tw + 5, (availW - tw) / (maxCount - 1)) : 0;
      const rowGap = 8;

      const xFor = (count) => {
        const totalW = tw + spacing * (Math.max(count, 1) - 1);
        return (W - totalW) / 2; // 좌우 대칭 여백 → 화면 중앙 정렬
      };
      const y0 = H - th - 10;                       // 앞줄(화면 하단)
      const y1 = twoRows ? y0 - th - rowGap : y0;    // 뒷줄(앞줄 위쪽)

      return { n, tw, th, spacing, twoRows, c0, c1, x0: xFor(c0), x1: xFor(c1), y0, y1 };
    },

    // 손패 인덱스가 앞줄(0)인지 뒷줄(1)인지 판정
    rowOfIndex(i, L) {
      L = L || this.handLayout();
      return (L.twoRows && i >= L.c0) ? 1 : 0;
    },

    tileRectAt(i) {
      const L = this.handLayout();
      const id = this.handOrder[i];
      const sel = this.selected.has(id);
      const row = this.rowOfIndex(i, L);
      const col = row === 0 ? i : i - L.c0;
      const x = (row === 0 ? L.x0 : L.x1) + col * L.spacing;
      const y = (row === 0 ? L.y0 : L.y1) - (sel ? 14 : 0);
      return { x, y, w: L.tw, h: L.th };
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
      const rx = Math.min(this.W * 0.40, 330);
      const ry = Math.min(this.H * 0.30, rx); // 테이블과 마찬가지로 세로로 긴 타원 방지
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
      this.drawPlayAnim(ctx);
      if (this.isMyTurn()) this.drawTurnEffects(ctx);
    },

    // 조합을 낸 플레이어 → 중앙 테이블로 타일이 역동적으로 날아오는 애니메이션.
    // 페어 이상은 한꺼번에(같은 진행도로) 쾅 날아온다.
    _sigOfTable(table) {
      return table ? table.byId + '#' + table.tiles.map((t) => t.id).join(',') : '';
    },
    _sourceXY(id) {
      if (id === this.myId) return { x: this.W / 2, y: this.H - 70 };
      const seat = this.seatPositions().find((s) => s.player.id === id);
      return seat ? { x: seat.x, y: seat.y - 8 } : { x: this.W / 2, y: this.H * 0.2 };
    },
    startPlayAnim(table) {
      if (!table || !table.tiles || !table.tiles.length) return;
      this.playAnim = {
        sig: this._sigOfTable(table),
        tiles: table.tiles.slice(),
        from: this._sourceXY(table.byId),
        start: performance.now(),
        dur: 300,
      };
    },
    drawPlayAnim(ctx) {
      const a = this.playAnim;
      if (!a) return;
      // 상태가 바뀌어 더 이상 현재 테이블과 맞지 않으면 종료
      if (!this.state || !this.state.table || this._sigOfTable(this.state.table) !== a.sig) { this.playAnim = null; return; }
      const now = this.anim || performance.now();
      let p = (now - a.start) / a.dur;
      if (p >= 1) { this.playAnim = null; return; } // 종료 → drawCenter가 정착 타일을 그림
      const L = this.centerTileLayout(a.tiles.length);
      const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const scale = 1.35 - 0.35 * ease;     // 뷰어 쪽에서 날아와 정착 크기로
      // 착지 직전 임팩트(페어 이상일수록 강하게): 확장 링 + 글로우
      if (p > 0.82) {
        const ip = (p - 0.82) / 0.18;
        const r = (18 + a.tiles.length * 10) * ip;
        ctx.save();
        ctx.globalAlpha = (1 - ip) * 0.6;
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 3 + a.tiles.length;
        ctx.beginPath(); ctx.arc(L.cx, L.cy + 6, r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      for (let i = 0; i < a.tiles.length; i++) {
        const to = L.positions[i];
        const x = a.from.x + (to.x + L.tw / 2 - a.from.x) * ease;
        const y = a.from.y + (to.y + L.th / 2 - a.from.y) * ease;
        const rot = (1 - ease) * (i % 2 ? 0.4 : -0.4);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        this.draw3DTile(ctx, -L.tw / 2, -L.th / 2, L.tw, L.th, a.tiles[i], { glow: true });
        ctx.restore();
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
        const t = 1 - remain / total; // 0(시작) → 1(끝)
        const fadeIn = Math.min(1, t / 0.15);
        const fadeOut = remain < 350 ? Math.max(0, remain / 350) : 1;
        const alpha = Math.min(fadeIn, fadeOut);
        const scale = 1 + 0.1 * Math.sin(Math.min(t, 1) * Math.PI);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.W / 2, this.H * 0.34);
        // 배너 뒤로 번지는 방사형 빛
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
        if (tw < 0.35) continue; // 대부분은 숨어있다가 반짝이는 순간만 보인다
        const alpha = (tw - 0.35) / 0.65;
        const s = p.size * (0.7 + 0.5 * tw);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.fillStyle = '#fff7d6';
        ctx.shadowColor = '#ffe9a8';
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.28, -s * 0.28);
        ctx.lineTo(s, 0);
        ctx.lineTo(s * 0.28, s * 0.28);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.28, s * 0.28);
        ctx.lineTo(-s, 0);
        ctx.lineTo(-s * 0.28, -s * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },

    drawBackground(ctx) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.2, 40, this.W / 2, this.H * 0.5, this.W * 0.8);
      g.addColorStop(0, '#2a2440');
      g.addColorStop(1, '#0b0a10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
      // 은은한 스포트라이트 — 테이블과 마찬가지로 세로로 긴 타원이 되지 않도록 제한
      const spotRx = this.W * 0.42;
      const spotRy = Math.min(this.H * 0.34, spotRx);
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#ffd76e';
      ctx.beginPath();
      ctx.ellipse(this.W / 2, this.H * 0.48, spotRx, spotRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    drawTable(ctx) {
      const cx = this.W / 2, cy = this.H * 0.47;
      const rx = Math.min(this.W * 0.34, 300);
      const ry = Math.min(this.H * 0.27, rx); // 세로모드에서도 세로로 긴 타원이 되지 않도록 가로 반지름 이하로 제한
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

    // 중앙 테이블에 놓이는 타일들의 좌표(애니메이션 도착점과 공유)
    centerTileLayout(count) {
      const cx = this.W / 2, cy = this.H * 0.47;
      const tw = this.H < 380 ? 34 : 40, th = Math.round(tw * 1.38);
      const overlap = count > 3 ? tw * 0.62 : tw * 0.85;
      const totalW = tw + overlap * (count - 1);
      const startX = cx - totalW / 2;
      const y = cy - th / 2 + 6;
      const positions = [];
      for (let i = 0; i < count; i++) positions.push({ x: startX + overlap * i, y });
      return { tw, th, overlap, startX, y, positions, cx, cy };
    },

    drawCenter(ctx) {
      const st = this.state;
      const cx = this.W / 2, cy = this.H * 0.47;
      if (st.table) {
        const tiles = st.table.tiles;
        const L = this.centerTileLayout(tiles.length);
        const tw = L.tw, th = L.th;
        const y = L.y;
        // 방금 낸 조합이 날아오는 중이면(playAnim) 정착 타일은 그리지 않는다(비행 타일이 대신 보임)
        const flying = this.playAnim && this.playAnim.sig === this._sigOfTable(st.table);
        if (!flying) {
          for (let i = 0; i < tiles.length; i++) this.draw3DTile(ctx, L.positions[i].x, y, tw, th, tiles[i], {});
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
      }
    },

    drawMyInfo(ctx) {
      const st = this.state;
      const me = st.players.find((p) => p.id === this.myId);
      if (!me) return;
      const L = this.handLayout();
      // 좌우 코너의 패스/내기 버튼과 겹치지 않도록, 가운데로 모인 손패의 왼쪽 끝 위에 정보를 얹는다.
      const x = Math.max(10, L.x0);
      // 손패(맨 위 줄) 바로 위에 두 줄로 압축 배치 (겹침 방지): 아래 줄=이름/칩/선, 위 줄=차례·패스 표시
      const handTopY = L.twoRows ? L.y1 : L.y0;
      const rowY = handTopY - 10;
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
      }
    },

    drawHand(ctx) {
      const L = this.handLayout();
      const dragging = this.pointer && this.pointer.dragging;
      const fromIdx = dragging ? this.pointer.tileIdx : -1;
      const toIdx = dragging ? this.dragInsert : -1;
      const fromRow = dragging ? this.rowOfIndex(fromIdx, L) : -1;
      const toRow = dragging && toIdx >= 0 ? this.rowOfIndex(toIdx, L) : -1;
      const sameRowDrag = dragging && toIdx >= 0 && fromRow === toRow;

      for (let i = 0; i < this.handOrder.length; i++) {
        if (dragging && i === fromIdx) continue; // 드래그 중인 타일은 마지막에
        const row = this.rowOfIndex(i, L);
        let col = row === 0 ? i : i - L.c0;
        // 드래그 삽입 위치 표시: 같은 줄 안에서만 자리 이동 애니메이션
        if (sameRowDrag && row === fromRow) {
          const from = row === 0 ? fromIdx : fromIdx - L.c0;
          const to = row === 0 ? toIdx : toIdx - L.c0;
          if (from < to && col > from && col <= to) col -= 1;
          else if (from > to && col >= to && col < from) col += 1;
        }
        const x = (row === 0 ? L.x0 : L.x1) + col * L.spacing;
        const y = row === 0 ? L.y0 : L.y1;
        const id = this.handOrder[i];
        const t = this.tileById(id);
        if (!t) continue;
        const sel = this.selected.has(id);
        const dim = this.playable ? !this.playable.has(id) : false;
        this.draw3DTile(ctx, x, y - (sel ? 14 : 0), L.tw, L.th, t, { selected: sel, dimmed: dim });
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
      // 드래그 중인 타일을 포인터 위치에 확대+글로우로
      if (dragging) {
        const id = this.handOrder[fromIdx];
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
      const suitColor = SUIT_COLOR[tile.suit]; // 2 테두리는 금색이 아닌 문양 색으로 강조
      ctx.save();
      if (opts.glow) {
        ctx.shadowColor = '#ffd76e';
        ctx.shadowBlur = 16;
      } else if (isTop) {
        ctx.shadowColor = suitColor;
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
        // 이중 테두리(안쪽) — 문양 색으로 강조
        ctx.strokeStyle = hexToRgba(suitColor, 0.9);
        ctx.lineWidth = 1.6;
        this.roundRect(ctx, x + 1.8, y + 1.8, w - 3.6, h - 3.6, 5);
        ctx.stroke();
      }

      // 윗면 테두리
      ctx.strokeStyle = opts.selected ? '#ffd76e' : (isTop ? suitColor : 'rgba(255,255,255,0.18)');
      ctx.lineWidth = opts.selected ? 2 : (isTop ? 1.5 : 1);
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.stroke();

      // 숫자/무늬
      const color = suitColor;
      ctx.textAlign = 'center';
      if (isTop) {
        ctx.shadowColor = hexToRgba(suitColor, 0.9);
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
        // 손패가 두 줄일 때는 줄 사이 이동이 세로 방향 움직임이 되므로, 방향에 상관없이
        // 이동 거리만으로 드래그 시작 여부를 판단한다(기존엔 가로 이동이 커야만 시작돼 줄 간 이동이 막혔음).
        if (Math.hypot(dx, dy) > 12) {
          this.pointer.dragging = true;
        }
      }
      if (this.pointer.dragging) {
        this.dragInsert = this.posToIndex(p.x, p.y);
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
