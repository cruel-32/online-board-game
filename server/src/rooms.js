'use strict';
const { Game } = require('./game');
const { chooseBotMove } = require('./bot');
const store = require('./store');

const DEFAULT_CHIPS = 50; // 최소 지급 칩. 방장이 50개 단위로 조절 가능
const BOT_NAMES = ['봇 알파', '봇 브라보', '봇 찰리', '봇 델타'];

function normalizeChips(v) {
  const n = Math.round(Number(v) / 50) * 50;
  return Number.isFinite(n) && n >= 50 ? n : DEFAULT_CHIPS;
}

const clients = new Map(); // clientId -> { clientId, ws, name }
const rooms = new Map(); // roomId -> room
const playerRoom = new Map(); // clientId -> roomId

let botSeq = 0;

/* ---------------- 유틸 ---------------- */

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function sendTo(clientId, msg) {
  const c = clients.get(clientId);
  if (c) send(c.ws, msg);
}
function sendError(ws, message) {
  send(ws, { type: 'error', message });
}
function roomCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function publicRoomList() {
  return Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    locked: !!r.password,
    state: r.state,
  }));
}

function broadcastLobby() {
  const msg = { type: 'lobby', rooms: publicRoomList() };
  for (const c of clients.values()) {
    if (!playerRoom.has(c.clientId)) send(c.ws, msg);
  }
}

function serializeRoom(room, viewerId) {
  return {
    type: 'room',
    room: {
      id: room.id,
      name: room.name,
      maxPlayers: room.maxPlayers,
      chipsPerPlayer: room.chipsPerPlayer,
      hostId: room.hostId,
      state: room.state,
      locked: !!room.password,
      you: viewerId,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot,
        ready: p.ready, connected: p.connected, chips: p.chips,
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      })),
      lastResult: room.lastResult || null,
      matchOver: !!room.matchOver,
    },
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    if (!p.isBot) sendTo(p.id, serializeRoom(room, p.id));
  }
}

function serializeGame(room, viewerId) {
  const g = room.game;
  const nameOf = (id) => {
    const p = room.players.find((x) => x.id === id);
    return p ? p.name : '?';
  };
  return {
    type: 'game',
    state: {
      roomId: room.id,
      roomName: room.name,
      roundNo: room.roundNo,
      maxN: g.maxN,
      you: viewerId,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot,
        connected: p.connected, chips: p.chips,
        tileCount: g.hands.get(p.id).length,
        passed: g.passed.has(p.id),
        inVoice: !!p.inVoice, micMuted: !!p.micMuted,
      })),
      turnId: g.currentPlayerId(),
      leaderId: g.leaderId,
      table: g.current
        ? {
            tiles: g.current.combo.tiles,
            combo: { type: g.current.combo.type, count: g.current.combo.count, rank: g.current.combo.rank },
            byId: g.current.byId,
            byName: nameOf(g.current.byId),
          }
        : null,
      hand: g.hands.get(viewerId) || [],
      finished: g.finished,
      winnerId: g.winnerId,
    },
  };
}

function broadcastGame(room) {
  for (const p of room.players) {
    if (!p.isBot) sendTo(p.id, serializeGame(room, p.id));
  }
}

// 음성채팅/마이크 상태처럼 방 상태에 얹혀가는 정보가 바뀌었을 때, 현재 화면(대기실/게임)에 맞는 브로드캐스트를 보낸다.
function broadcastPresence(room) {
  if (room.state === 'playing' && room.game) broadcastGame(room);
  else broadcastRoom(room);
}

/* ---------------- 방 관리 ---------------- */

function createRoom(client, { name, password, maxPlayers, chips }) {
  const room = {
    id: roomCode(),
    name: String(name || client.name + '의 방').slice(0, 20),
    password: password ? String(password).slice(0, 20) : '',
    maxPlayers: [3, 4, 5].includes(+maxPlayers) ? +maxPlayers : 5,
    chipsPerPlayer: normalizeChips(chips),
    hostId: client.clientId,
    state: 'waiting',
    players: [],
    game: null,
    roundNo: 0,
    lastResult: null,
    matchOver: false,
    botTimer: null,
    emptyTimer: null,
    settleTimer: null,
  };
  rooms.set(room.id, room);
  joinRoomInternal(room, client);
  return room;
}

function joinRoomInternal(room, client) {
  room.players.push({
    id: client.clientId,
    name: client.name,
    isBot: false,
    ready: false,
    connected: true,
    chips: room.chipsPerPlayer,
  });
  playerRoom.set(client.clientId, room.id);
  clearTimeout(room.emptyTimer);
  broadcastRoom(room);
  broadcastLobby();
}

function leaveRoom(clientId) {
  const roomId = playerRoom.get(clientId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  playerRoom.delete(clientId);
  if (!room) return;

  const idx = room.players.findIndex((p) => p.id === clientId);
  if (idx === -1) return;

  if (room.state === 'playing') {
    // 게임 중 이탈 → 해당 좌석을 봇으로 전환해 게임 유지
    const p = room.players[idx];
    p.isBot = true;
    p.connected = false;
    p.inVoice = false;
    p.micMuted = false;
    p.name = p.name + '(봇)';
    p.ready = true;
    reassignHost(room);
    broadcastRoom(room);
    broadcastGame(room);
    scheduleBotTurn(room);
  } else {
    room.players.splice(idx, 1);
    reassignHost(room);
    broadcastRoom(room);
  }
  // 명시적으로 나간 것이므로 실제 플레이어가 더 없으면 곧바로 방을 폭파한다.
  checkRoomEmpty(room, true);
  broadcastLobby();
}

function reassignHost(room) {
  if (room.players.some((p) => p.id === room.hostId && !p.isBot && p.connected)) return;
  const human = room.players.find((p) => !p.isBot && p.connected);
  room.hostId = human ? human.id : null;
}

function checkRoomEmpty(room, immediate) {
  clearTimeout(room.emptyTimer);
  const activeHumans = room.players.filter((p) => !p.isBot && p.connected);
  if (activeHumans.length > 0) return;
  clearTimeout(room.botTimer); // 지켜보는 실제 플레이어가 없으면 봇끼리 진행하지 않는다.
  clearTimeout(room.settleTimer);

  const destroy = () => {
    for (const p of room.players) playerRoom.delete(p.id);
    rooms.delete(room.id);
    broadcastLobby();
  };
  if (immediate) return destroy();
  // 접속이 끊긴 경우엔 재접속할 시간을 잠시 준다.
  room.emptyTimer = setTimeout(() => {
    const stillEmpty = !room.players.some((p) => !p.isBot && p.connected);
    if (stillEmpty) destroy();
  }, 30 * 1000);
}

/* ---------------- 게임 진행 ---------------- */

function startGame(room) {
  if (room.players.length < 3) throw new Error('최소 3인이 필요합니다. 봇을 추가하세요.');
  if (room.players.length > room.maxPlayers) throw new Error('최대 인원을 초과했습니다.');
  const humansNotReady = room.players.filter(
    (p) => !p.isBot && p.connected && p.id !== room.hostId && !p.ready
  );
  if (humansNotReady.length) throw new Error('아직 준비하지 않은 플레이어가 있습니다.');

  if (room.matchOver) {
    // 새 매치: 칩 초기화
    for (const p of room.players) p.chips = room.chipsPerPlayer;
    room.matchOver = false;
    room.roundNo = 0;
  }
  room.roundNo += 1;
  room.state = 'playing';
  room.game = new Game(room.players);
  for (const p of room.players) p.ready = p.isBot;
  broadcastRoom(room);
  broadcastGame(room);
  broadcastLobby();
  scheduleBotTurn(room);
}

function scheduleBotTurn(room) {
  clearTimeout(room.botTimer);
  const g = room.game;
  if (!g || g.finished || room.state !== 'playing') return;
  const pid = g.currentPlayerId();
  const p = room.players.find((x) => x.id === pid);
  if (!p) return;
  // 봇이거나, 접속이 끊긴 사람은 일정 시간 후 자동 진행
  const isAuto = p.isBot || !p.connected;
  if (!isAuto) return;
  const delay = p.isBot ? 900 + Math.random() * 900 : 8000;
  room.botTimer = setTimeout(() => {
    if (room.game !== g || g.finished || g.currentPlayerId() !== pid) return;
    try {
      const mv = chooseBotMove(g, pid);
      if (mv.action === 'play') {
        const r = g.play(pid, mv.tileIds);
        if (r.finished) return finishRound(room);
      } else {
        g.pass(pid);
      }
      broadcastGame(room);
      scheduleBotTurn(room);
    } catch (e) {
      console.error('[bot] move failed:', e.message);
      try {
        g.pass(pid);
        broadcastGame(room);
        scheduleBotTurn(room);
      } catch (_) { /* 선인데 낼 수 없는 상황은 없음 */ }
    }
  }, delay);
}

// 마지막 패를 낸 순간의 상태(모든 타일을 냈다는 표시)를 먼저 보여준 뒤, 잠시 후 결과를 정산한다.
function finishRound(room) {
  broadcastGame(room);
  clearTimeout(room.settleTimer);
  room.settleTimer = setTimeout(() => settleRound(room), 2200);
}

function settleRound(room) {
  if (!rooms.has(room.id) || !room.game) return; // 정산 대기 중 방이 사라진 경우(드묾) 무시
  const g = room.game;
  const res = g.results(); // [{id, remaining, twos, eff, tiles}]
  // 순위: eff 오름차순 (0 = 우승)
  const sorted = res.slice().sort((a, b) => a.eff - b.eff);
  const rankOf = new Map();
  sorted.forEach((r, i) => {
    // 동점자는 같은 순위
    const prev = i > 0 ? sorted[i - 1] : null;
    rankOf.set(r.id, prev && prev.eff === r.eff ? rankOf.get(prev.id) : i + 1);
  });

  const chipsOf = new Map(room.players.map((p) => [p.id, p.chips]));
  const delta = new Map(res.map((r) => [r.id, 0]));

  // 모든 쌍에 대해: 남은 타일이 많은 쪽이 차이만큼 지불 (칩 잔액 한도)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const win = sorted[i], lose = sorted[j];
      const diff = lose.eff - win.eff;
      if (diff <= 0) continue;
      const pay = Math.min(chipsOf.get(lose.id), diff);
      if (pay <= 0) continue;
      chipsOf.set(lose.id, chipsOf.get(lose.id) - pay);
      chipsOf.set(win.id, chipsOf.get(win.id) + pay);
      delta.set(lose.id, delta.get(lose.id) - pay);
      delta.set(win.id, delta.get(win.id) + pay);
    }
  }

  for (const p of room.players) p.chips = chipsOf.get(p.id);
  const busted = room.players.filter((p) => p.chips <= 0);
  const matchOver = busted.length > 0;
  room.matchOver = matchOver;

  const rows = res
    .map((r) => {
      const p = room.players.find((x) => x.id === r.id);
      return {
        id: r.id,
        name: p.name,
        isBot: p.isBot,
        rank: rankOf.get(r.id),
        remaining: r.remaining,
        twos: r.twos,
        eff: r.eff,
        delta: delta.get(r.id),
        chips: p.chips,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  room.lastResult = { roundNo: room.roundNo, rows, matchOver, bustedNames: busted.map((b) => b.name) };
  room.state = 'waiting';
  room.game = null;
  clearTimeout(room.botTimer);
  for (const p of room.players) p.ready = p.isBot;

  store.saveRound(room.name, room.roundNo, rows, matchOver).catch(() => {});

  for (const p of room.players) {
    if (!p.isBot) sendTo(p.id, { type: 'round_over', result: room.lastResult });
  }
  broadcastRoom(room);
  broadcastLobby();
}

function maybeAutoStart(room) {
  // 모든 인원(호스트 포함)이 준비되면 자동 시작하지 않고 호스트의 시작을 기다린다.
  // 단, 라운드 사이(직전 결과 존재)에는 전원 준비 시 자동으로 다음 라운드 시작.
  if (room.state !== 'waiting' || !room.lastResult) return;
  const humans = room.players.filter((p) => !p.isBot && p.connected);
  if (humans.length && humans.every((p) => p.ready) && room.players.length >= 3) {
    try {
      startGame(room);
    } catch (e) {
      console.error('[room] auto start failed:', e.message);
    }
  }
}

/* ---------------- 메시지 라우팅 ---------------- */

const handlers = {
  hello(ws, msg) {
    const clientId = String(msg.clientId || '').slice(0, 64) || 'c-' + Math.random().toString(36).slice(2);
    const name = String(msg.name || '').trim().slice(0, 12) || '플레이어' + Math.floor(Math.random() * 1000);
    const existing = clients.get(clientId);
    if (existing && existing.ws && existing.ws !== ws) {
      try { existing.ws.close(); } catch (_) {}
    }
    const client = { clientId, ws, name };
    clients.set(clientId, client);
    ws.clientId = clientId;

    // 재접속: 방에 있었다면 복귀
    const roomId = playerRoom.get(clientId);
    const room = roomId ? rooms.get(roomId) : null;
    if (room) {
      const p = room.players.find((x) => x.id === clientId);
      if (p) {
        p.connected = true;
        clearTimeout(room.emptyTimer); // 방 폭파 예약 취소
        if (!p.isBot && !room.hostId) room.hostId = p.id; // 아무도 방장이 아니면 재접속한 본인이 이어받음
        send(ws, { type: 'hello_ok', clientId, name, view: room.state === 'playing' ? 'game' : 'room' });
        send(ws, serializeRoom(room, clientId));
        if (room.state === 'playing') send(ws, serializeGame(room, clientId));
        broadcastRoom(room);
        return;
      }
      playerRoom.delete(clientId);
    }
    send(ws, { type: 'hello_ok', clientId, name, view: 'lobby' });
    send(ws, { type: 'lobby', rooms: publicRoomList() });
  },

  set_name(ws, msg, client) {
    const name = String(msg.name || '').trim().slice(0, 12);
    if (name) client.name = name;
  },

  create_room(ws, msg, client) {
    if (playerRoom.has(client.clientId)) throw new Error('이미 방에 있습니다.');
    if (msg.playerName) client.name = String(msg.playerName).trim().slice(0, 12) || client.name;
    const room = createRoom(client, msg);
    send(ws, { type: 'joined', roomId: room.id });
    send(ws, serializeRoom(room, client.clientId));
  },

  join_room(ws, msg, client) {
    if (playerRoom.has(client.clientId)) throw new Error('이미 방에 있습니다.');
    const room = rooms.get(String(msg.roomId || '').toUpperCase());
    if (!room) throw new Error('존재하지 않는 방입니다.');
    if (room.state === 'playing') throw new Error('게임이 진행 중인 방입니다.');
    if (room.players.length >= room.maxPlayers) throw new Error('방이 가득 찼습니다.');
    if (room.password && room.password !== String(msg.password || '')) {
      send(ws, { type: 'need_password', roomId: room.id, wrong: msg.password != null });
      return;
    }
    if (msg.name) client.name = String(msg.name).trim().slice(0, 12) || client.name;
    joinRoomInternal(room, client);
    send(ws, { type: 'joined', roomId: room.id });
  },

  leave_room(ws, msg, client) {
    leaveRoom(client.clientId);
    send(ws, { type: 'left' });
    send(ws, { type: 'lobby', rooms: publicRoomList() });
  },

  set_max(ws, msg, client) {
    const room = mustBeHost(client);
    const n = +msg.maxPlayers;
    if (![3, 4, 5].includes(n)) throw new Error('인원은 3~5명입니다.');
    if (n < room.players.length) throw new Error('현재 인원보다 적게 설정할 수 없습니다.');
    room.maxPlayers = n;
    broadcastRoom(room);
    broadcastLobby();
  },

  set_chips(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 변경할 수 있습니다.');
    if (room.lastResult && !room.matchOver)
      throw new Error('라운드 진행 중에는 칩 개수를 변경할 수 없습니다. 매치 종료 후 변경하세요.');
    room.chipsPerPlayer = normalizeChips(msg.chips);
    for (const p of room.players) p.chips = room.chipsPerPlayer;
    broadcastRoom(room);
    broadcastLobby();
  },

  add_bot(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 가능합니다.');
    if (room.players.length >= room.maxPlayers) throw new Error('자리가 없습니다.');
    const used = room.players.filter((p) => p.isBot).length;
    room.players.push({
      id: 'bot-' + ++botSeq,
      name: BOT_NAMES[used % BOT_NAMES.length],
      isBot: true,
      ready: true,
      connected: true,
      chips: room.chipsPerPlayer,
    });
    broadcastRoom(room);
    broadcastLobby();
  },

  remove_bot(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 가능합니다.');
    const idx = room.players.findIndex((p) => p.id === msg.playerId && p.isBot);
    if (idx === -1) throw new Error('해당 봇이 없습니다.');
    room.players.splice(idx, 1);
    broadcastRoom(room);
    broadcastLobby();
  },

  kick(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 강퇴할 수 있습니다.');
    const target = room.players.find((p) => p.id === msg.playerId);
    if (!target) throw new Error('대상이 없습니다.');
    if (target.id === client.clientId) throw new Error('자신은 강퇴할 수 없습니다.');
    if (target.isBot) return handlers.remove_bot(ws, msg, client);
    room.players = room.players.filter((p) => p.id !== target.id);
    playerRoom.delete(target.id);
    sendTo(target.id, { type: 'kicked' });
    sendTo(target.id, { type: 'lobby', rooms: publicRoomList() });
    broadcastRoom(room);
    broadcastLobby();
  },

  ready(ws, msg, client) {
    const room = mustBeInRoom(client);
    if (room.state !== 'waiting') return;
    const p = room.players.find((x) => x.id === client.clientId);
    p.ready = !!msg.ready;
    broadcastRoom(room);
    maybeAutoStart(room);
  },

  start(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('이미 게임 중입니다.');
    startGame(room);
  },

  play(ws, msg, client) {
    const room = mustBeInRoom(client);
    if (room.state !== 'playing' || !room.game) throw new Error('게임 중이 아닙니다.');
    const r = room.game.play(client.clientId, msg.tileIds || []);
    if (r.finished) return finishRound(room);
    broadcastGame(room);
    scheduleBotTurn(room);
  },

  pass(ws, msg, client) {
    const room = mustBeInRoom(client);
    if (room.state !== 'playing' || !room.game) throw new Error('게임 중이 아닙니다.');
    room.game.pass(client.clientId);
    broadcastGame(room);
    scheduleBotTurn(room);
  },

  chat(ws, msg, client) {
    const room = mustBeInRoom(client);
    const text = String(msg.text || '').trim().slice(0, 200);
    if (!text) return;
    const sender = room.players.find((p) => p.id === client.clientId);
    const payload = {
      type: 'chat',
      id: client.clientId,
      name: sender ? sender.name : client.name,
      text,
      at: Date.now(),
    };
    for (const p of room.players) {
      if (!p.isBot) sendTo(p.id, payload);
    }
  },

  // ---- 음성채팅 시그널링 (실제 오디오는 P2P WebRTC, 서버는 offer/answer/ICE 중계만 담당) ----
  voice_join(ws, msg, client) {
    const room = mustBeInRoom(client);
    const p = room.players.find((x) => x.id === client.clientId);
    if (!p) return;
    p.inVoice = true;
    p.micMuted = false;
    broadcastPresence(room);
  },

  voice_leave(ws, msg, client) {
    const room = mustBeInRoom(client);
    const p = room.players.find((x) => x.id === client.clientId);
    if (!p) return;
    p.inVoice = false;
    p.micMuted = false;
    broadcastPresence(room);
  },

  mic_state(ws, msg, client) {
    const room = mustBeInRoom(client);
    const p = room.players.find((x) => x.id === client.clientId);
    if (!p || !p.inVoice) return;
    p.micMuted = !!msg.muted;
    broadcastPresence(room);
  },

  voice_signal(ws, msg, client) {
    const room = mustBeInRoom(client);
    const targetId = String(msg.to || '');
    const target = room.players.find((p) => p.id === targetId && !p.isBot);
    if (!target) return; // 상대가 이미 나갔으면 조용히 무시
    sendTo(targetId, { type: 'voice_signal', from: client.clientId, data: msg.data });
  },
};

function mustBeInRoom(client) {
  const roomId = playerRoom.get(client.clientId);
  const room = roomId ? rooms.get(roomId) : null;
  if (!room) throw new Error('방에 입장해 있지 않습니다.');
  return room;
}
function mustBeHost(client) {
  const room = mustBeInRoom(client);
  if (room.hostId !== client.clientId) throw new Error('방장만 가능합니다.');
  return room;
}

/* ---------------- WebSocket 연결 ---------------- */

function attach(ws) {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (_) {
      return;
    }
    const handler = handlers[msg.type];
    if (!handler) return;
    try {
      if (msg.type === 'hello') return handler(ws, msg);
      const client = ws.clientId ? clients.get(ws.clientId) : null;
      if (!client) throw new Error('먼저 접속(hello)이 필요합니다.');
      handler(ws, msg, client);
    } catch (e) {
      sendError(ws, e.message || String(e));
    }
  });

  ws.on('close', () => {
    const clientId = ws.clientId;
    if (!clientId) return;
    const client = clients.get(clientId);
    if (!client || client.ws !== ws) return; // 새 연결로 대체됨
    client.ws = null;
    const roomId = playerRoom.get(clientId);
    const room = roomId ? rooms.get(roomId) : null;
    if (room) {
      const p = room.players.find((x) => x.id === clientId);
      if (p) {
        p.connected = false;
        p.inVoice = false;
        p.micMuted = false;
        reassignHost(room); // 방장 접속이 끊기면 다른 실제 플레이어에게 방장 위임
        broadcastRoom(room);
        if (room.state === 'playing') {
          broadcastGame(room);
          scheduleBotTurn(room); // 끊긴 사람 차례면 자동 진행 예약
        }
        checkRoomEmpty(room); // 재접속 유예 후 실제 플레이어가 없으면 방 폭파
      }
    }
  });
}

module.exports = { attach };
