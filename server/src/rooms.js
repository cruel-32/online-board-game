'use strict';
/**
 * 게임 독립 방/로비 오케스트레이터.
 * 방 생명주기·로비·채팅·음성 시그널링·봇 스케줄링을 담당하고,
 * 게임별 규칙/직렬화/정산은 room.engine(플러그인)에 위임한다.
 */
const registry = require('./games/registry');
const store = require('./store');

const BOT_NAMES = ['봇 알파', '봇 브라보', '봇 찰리', '봇 델타'];

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
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
    gameId: r.gameId,
    gameName: r.engine.meta.name,
    players: r.players.length,
    maxPlayers: r.maxPlayers,
    locked: !!r.password,
    state: r.state,
  }));
}

function broadcastLobby() {
  const msg = { type: 'lobby', rooms: publicRoomList(), games: registry.listGames() };
  for (const c of clients.values()) {
    if (!playerRoom.has(c.clientId)) send(c.ws, msg);
  }
}

function serializeRoom(room, viewerId) {
  const engine = room.engine;
  return {
    type: 'room',
    room: {
      id: room.id,
      name: room.name,
      gameId: room.gameId,
      games: registry.listGames(),
      game: {
        id: engine.meta.id,
        name: engine.meta.name,
        minPlayers: engine.meta.minPlayers,
        maxPlayers: engine.meta.maxPlayers,
      },
      options: room.options,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      state: room.state,
      locked: !!room.password,
      you: viewerId,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot,
        ready: p.ready, connected: p.connected,
        seat: engine.seatLabel(room, p),
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
  return { type: 'game', state: room.engine.serialize(room.game, room, viewerId) };
}

function broadcastGame(room) {
  for (const p of room.players) {
    if (!p.isBot) sendTo(p.id, serializeGame(room, p.id));
  }
}

// 음성/마이크 상태처럼 방 상태에 얹혀가는 정보가 바뀌었을 때 현재 화면에 맞는 브로드캐스트.
function broadcastPresence(room) {
  if (room.state === 'playing' && room.game) broadcastGame(room);
  else broadcastRoom(room);
}

/* ---------------- 방 관리 ---------------- */

function createRoom(client, msg) {
  const engine = registry.getEngine(String(msg.gameId || registry.DEFAULT_GAME));
  const room = {
    id: roomCode(),
    name: String(msg.name || client.name + '의 방').slice(0, 20),
    password: msg.password ? String(msg.password).slice(0, 20) : '',
    gameId: engine.meta.id,
    engine,
    options: engine.normalizeOptions(engine.defaultOptions()),
    maxPlayers: engine.meta.maxPlayers,
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
  const player = {
    id: client.clientId,
    name: client.name,
    isBot: false,
    ready: false,
    connected: true,
  };
  room.engine.initPlayer(room, player);
  room.players.push(player);
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
    const p = room.players[idx];
    p.connected = false;
    p.inVoice = false;
    p.micMuted = false;
    if (room.engine.handleDisconnect) {
      // 봇 전환이 불가능한 실시간 게임(예: 테트리스) — 엔진이 알아서 탈락 등으로 처리
      const r = room.engine.handleDisconnect(room.game, room, clientId);
      reassignHost(room);
      broadcastRoom(room);
      broadcastGame(room);
      if (r && r.ended) finishGame(room);
      else scheduleBotTurn(room);
    } else {
      // 게임 중 이탈 → 해당 좌석을 봇으로 전환해 게임 유지
      p.isBot = true;
      p.name = p.name + '(봇)';
      p.ready = true;
      reassignHost(room);
      broadcastRoom(room);
      broadcastGame(room);
      scheduleBotTurn(room);
    }
  } else {
    room.players.splice(idx, 1);
    reassignHost(room);
    broadcastRoom(room);
  }
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
  clearTimeout(room.botTimer);
  clearTimeout(room.settleTimer);

  const destroy = () => {
    for (const p of room.players) playerRoom.delete(p.id);
    rooms.delete(room.id);
    broadcastLobby();
  };
  if (immediate) return destroy();
  room.emptyTimer = setTimeout(() => {
    const stillEmpty = !room.players.some((p) => !p.isBot && p.connected);
    if (stillEmpty) destroy();
  }, 30 * 1000);
}

/* ---------------- 게임 진행 ---------------- */

function startGame(room) {
  const engine = room.engine;
  if (room.players.length < engine.meta.minPlayers)
    throw new Error(`최소 ${engine.meta.minPlayers}인이 필요합니다. 봇을 추가하세요.`);
  if (room.players.length > room.maxPlayers) throw new Error('최대 인원을 초과했습니다.');
  const humansNotReady = room.players.filter(
    (p) => !p.isBot && p.connected && p.id !== room.hostId && !p.ready
  );
  if (humansNotReady.length) throw new Error('아직 준비하지 않은 플레이어가 있습니다.');

  if (room.matchOver) {
    engine.resetMatch(room);
    room.matchOver = false;
    room.roundNo = 0;
  }
  room.roundNo += 1;
  room.state = 'playing';
  shuffleInPlace(room.players); // 방 입장 순서와 무관하게 매 게임 시작마다 순서를 무작위로 섞는다
  room.game = engine.createGame(room);
  for (const p of room.players) p.ready = p.isBot;
  broadcastRoom(room);
  broadcastGame(room);
  broadcastLobby();
  scheduleBotTurn(room);
}

function scheduleBotTurn(room) {
  clearTimeout(room.botTimer);
  const g = room.game, engine = room.engine;
  if (!g || room.state !== 'playing') return;
  const pid = engine.currentActor(g);
  if (!pid) return;
  const p = room.players.find((x) => x.id === pid);
  if (!p) return;
  const isAuto = p.isBot || !p.connected;
  if (!isAuto) return;
  const delay = p.isBot ? engine.botDelay(g) : 8000;
  room.botTimer = setTimeout(() => {
    if (room.game !== g || room.state !== 'playing' || engine.currentActor(g) !== pid) return;
    try {
      const action = engine.botAction(g, pid);
      const r = engine.applyAction(g, room, pid, action);
      if (r && r.ended) return finishGame(room);
      broadcastGame(room);
      scheduleBotTurn(room);
    } catch (e) {
      console.error('[bot] move failed:', e.message);
      try {
        engine.applyAction(g, room, pid, { kind: 'pass' });
        broadcastGame(room);
        scheduleBotTurn(room);
      } catch (_) { /* 무시 */ }
    }
  }, delay);
}

// 게임(라운드/세션) 종료 상태를 잠시 보여준 뒤 정산.
function finishGame(room) {
  broadcastGame(room);
  clearTimeout(room.settleTimer);
  const delay = room.engine.meta.settleDelay || 0;
  room.settleTimer = setTimeout(() => settleGame(room), delay);
}

function settleGame(room) {
  if (!rooms.has(room.id) || !room.game) return;
  const { payload } = room.engine.settle(room.game, room);
  room.lastResult = payload;
  room.state = 'waiting';
  room.game = null;
  clearTimeout(room.botTimer);
  for (const p of room.players) p.ready = p.isBot;

  store.saveRound(room.gameId, room.name, room.roundNo, payload).catch(() => {});

  for (const p of room.players) {
    if (!p.isBot) sendTo(p.id, { type: 'round_over', result: payload });
  }
  broadcastRoom(room);
  broadcastLobby();
}

function maybeAutoStart(room) {
  // 라운드/게임 사이(직전 결과 존재)에 전원 준비 시 자동으로 다음 게임 시작.
  if (room.state !== 'waiting' || !room.lastResult) return;
  const humans = room.players.filter((p) => !p.isBot && p.connected);
  if (humans.length && humans.every((p) => p.ready) && room.players.length >= room.engine.meta.minPlayers) {
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

    const roomId = playerRoom.get(clientId);
    const room = roomId ? rooms.get(roomId) : null;
    if (room) {
      const p = room.players.find((x) => x.id === clientId);
      if (p) {
        p.connected = true;
        clearTimeout(room.emptyTimer);
        if (!p.isBot && !room.hostId) room.hostId = p.id;
        send(ws, { type: 'hello_ok', clientId, name, view: room.state === 'playing' ? 'game' : 'room' });
        send(ws, serializeRoom(room, clientId));
        if (room.state === 'playing') send(ws, serializeGame(room, clientId));
        broadcastRoom(room);
        return;
      }
      playerRoom.delete(clientId);
    }
    send(ws, { type: 'hello_ok', clientId, name, view: 'lobby' });
    send(ws, { type: 'lobby', rooms: publicRoomList(), games: registry.listGames() });
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
    send(ws, { type: 'lobby', rooms: publicRoomList(), games: registry.listGames() });
  },

  // 방장이 대기 중에 게임 종류를 변경
  set_game(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 변경할 수 있습니다.');
    const engine = registry.getEngine(String(msg.gameId || ''));
    if (engine.meta.id === room.gameId) return;
    if (room.players.length > engine.meta.maxPlayers)
      throw new Error(`${engine.meta.name}은(는) 최대 ${engine.meta.maxPlayers}인입니다. 인원을 줄이세요.`);
    room.gameId = engine.meta.id;
    room.engine = engine;
    room.options = engine.normalizeOptions(engine.defaultOptions());
    room.maxPlayers = Math.min(Math.max(room.maxPlayers, engine.meta.minPlayers), engine.meta.maxPlayers);
    for (const p of room.players) engine.initPlayer(room, p);
    // 게임이 바뀌면 진행 상태/결과 초기화
    room.lastResult = null;
    room.matchOver = false;
    room.roundNo = 0;
    for (const p of room.players) if (!p.isBot) p.ready = false;
    broadcastRoom(room);
    broadcastLobby();
  },

  set_max(ws, msg, client) {
    const room = mustBeHost(client);
    const n = +msg.maxPlayers;
    const { minPlayers, maxPlayers } = room.engine.meta;
    if (!(n >= minPlayers && n <= maxPlayers)) throw new Error(`인원은 ${minPlayers}~${maxPlayers}명입니다.`);
    if (n < room.players.length) throw new Error('현재 인원보다 적게 설정할 수 없습니다.');
    room.maxPlayers = n;
    broadcastRoom(room);
    broadcastLobby();
  },

  // 게임별 설정값 변경(예: 렉시오 칩)
  set_option(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 변경할 수 있습니다.');
    if (room.lastResult && !room.matchOver)
      throw new Error('진행 중에는 변경할 수 없습니다. 종료 후 변경하세요.');
    const next = { ...room.options, [String(msg.key)]: msg.value };
    room.options = room.engine.normalizeOptions(next);
    for (const p of room.players) room.engine.initPlayer(room, p);
    broadcastRoom(room);
    broadcastLobby();
  },

  add_bot(ws, msg, client) {
    const room = mustBeHost(client);
    if (room.state !== 'waiting') throw new Error('대기 중에만 가능합니다.');
    if (room.engine.meta.noBots) throw new Error('이 게임은 봇을 지원하지 않습니다.');
    if (room.players.length >= room.maxPlayers) throw new Error('자리가 없습니다.');
    const used = room.players.filter((p) => p.isBot).length;
    const bot = {
      id: 'bot-' + ++botSeq,
      name: BOT_NAMES[used % BOT_NAMES.length],
      isBot: true,
      ready: true,
      connected: true,
    };
    room.engine.initPlayer(room, bot);
    room.players.push(bot);
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
    sendTo(target.id, { type: 'lobby', rooms: publicRoomList(), games: registry.listGames() });
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

  // 게임별 액션(렉시오 play/pass, 펠리시티 bid/pass/place_card 등)을 엔진에 위임
  game_action(ws, msg, client) {
    const room = mustBeInRoom(client);
    if (room.state !== 'playing' || !room.game) throw new Error('게임 중이 아닙니다.');
    const r = room.engine.applyAction(room.game, room, client.clientId, msg.action || {});
    if (r && r.ended) return finishGame(room);
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

  // ---- 음성채팅 시그널링 (실제 오디오는 P2P WebRTC, 서버는 offer/answer/ICE 중계만) ----
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
    if (!target) return;
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
    if (!client || client.ws !== ws) return;
    client.ws = null;
    const roomId = playerRoom.get(clientId);
    const room = roomId ? rooms.get(roomId) : null;
    if (room) {
      const p = room.players.find((x) => x.id === clientId);
      if (p) {
        p.connected = false;
        p.inVoice = false;
        p.micMuted = false;
        reassignHost(room);
        broadcastRoom(room);
        if (room.state === 'playing') {
          if (room.engine.handleDisconnect) {
            // 봇 전환이 불가능한 실시간 게임(예: 테트리스) — 엔진이 알아서 탈락 등으로 처리
            const r = room.engine.handleDisconnect(room.game, room, clientId);
            broadcastGame(room);
            if (r && r.ended) finishGame(room);
            else scheduleBotTurn(room);
          } else {
            broadcastGame(room);
            scheduleBotTurn(room);
          }
        }
        checkRoomEmpty(room);
      }
    }
  });
}

module.exports = { attach };
