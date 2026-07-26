'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const rooms = require('./rooms');
const store = require('./store');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.static(path.join(__dirname, '../../public')));
app.get('/healthz', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  // 반복되는 키 이름·null 값이 많은 게임 상태 JSON은 압축률이 좋다(특히 테트리스 보드 스냅샷).
  // threshold로 아주 짧은 메시지(채팅 등)는 압축 오버헤드가 이득보다 클 수 있어 그대로 보낸다.
  perMessageDeflate: { threshold: 1024 },
});
wss.on('connection', (ws) => rooms.attach(ws));

// 죽은 연결 정리
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
wss.on('close', () => clearInterval(heartbeat));

store.init().catch((e) => console.error('[store] init error:', e.message));

server.listen(PORT, () => {
  console.log(`보드게임 온라인 서버 시작: http://localhost:${PORT}`);
});
