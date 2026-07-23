/**
 * 게임 독립 WebSocket 계층 — 연결/자동 재연결/전송/메시지 디스패치.
 */
(function () {
  'use strict';

  const Net = {
    ws: null,
    reconnectDelay: 500,
    _onMessage: null,
    _hello: null,

    connect({ clientId, name, onMessage }) {
      this._onMessage = onMessage;
      this._hello = { type: 'hello', clientId, name };
      this._open();
    },

    _open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectDelay = 500;
        this.send(this._hello);
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (this._onMessage) this._onMessage(msg);
      };
      ws.onclose = () => {
        setTimeout(() => this._open(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
      };
    },

    // hello 재전송 시 최신 이름 반영
    setHelloName(name) {
      if (this._hello) this._hello.name = name;
    },

    send(msg) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    },
  };

  window.Net = Net;
})();
