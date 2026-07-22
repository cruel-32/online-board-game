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
const wss = new WebSocketServer({ server });
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
  console.log(`렉시오 온라인 서버 시작: http://localhost:${PORT}`);
});
