/**
 * 게임 독립 채팅 — 채팅 패널/뱃지/입력 + 화면 위 말풍선 레이어.
 * 말풍선 위치는 활성 게임이 제공하는 getAnchor(playerId)->{x,y}(페이지 좌표) 훅으로 배치한다.
 * (캔버스에 직접 그리면 z-index 있는 다른 UI에 가려지므로 별도 최상단 DOM 레이어 사용)
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  const Chat = {
    myId: null,
    send: null,
    getAnchor: null,      // (playerId) -> {x,y} 페이지 좌표 | null
    bubbleLayer: null,
    bubbleEls: new Map(),  // playerId -> { el, timer }

    init({ myId, send, getAnchor }) {
      this.myId = myId;
      this.send = send;
      this.getAnchor = getAnchor || (() => null);
      this.bubbleLayer = $('chat-bubbles-layer');

      $('btn-chat-send').addEventListener('click', () => this.sendInput());
      $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendInput(); });
      $('btn-chat-close').addEventListener('click', () => $('chat-panel').classList.add('hidden'));
      window.addEventListener('resize', () => this.reposition());
    },

    toggle() {
      const panel = $('chat-panel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        $('chat-badge').classList.add('hidden');
        $('chat-input').focus();
      }
    },

    addMessage(msg) {
      const list = $('chat-messages');
      const row = document.createElement('div');
      row.className = 'chat-msg';
      row.innerHTML = `<span class="cname">${escapeHtml(msg.name)}</span>${escapeHtml(msg.text)}`;
      list.appendChild(row);
      list.scrollTop = list.scrollHeight;
      if ($('chat-panel').classList.contains('hidden')) $('chat-badge').classList.remove('hidden');
      // 내 메시지는 채팅창에 이미 보이므로 말풍선 중복 표시하지 않음
      if (msg.id !== this.myId) this.showBubble(msg.id, msg.text);
    },

    clear() {
      $('chat-messages').innerHTML = '';
      $('chat-badge').classList.add('hidden');
    },

    sendInput() {
      const input = $('chat-input');
      const text = input.value.trim();
      if (!text) return;
      this.send({ type: 'chat', text });
      input.value = '';
    },

    // 해당 플레이어 아이콘 옆에 몇 초간 말풍선 표시. 같은 사람이 다시 보내면 이전 것을 대체.
    showBubble(id, text) {
      if (!this.bubbleLayer) return;
      const anchor = this.getAnchor(id);
      if (!anchor) return; // 현재 게임 화면에 없는 상대는 표시 안 함

      const maxChars = 26;
      const label = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;

      let entry = this.bubbleEls.get(id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'chat-bubble-el';
        this.bubbleLayer.appendChild(el);
        entry = { el, timer: null };
        this.bubbleEls.set(id, entry);
      }
      entry.el.textContent = label;
      this._place(entry.el, anchor);
      requestAnimationFrame(() => entry.el.classList.add('show'));

      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.el.remove();
        this.bubbleEls.delete(id);
      }, 5000);
    },

    _place(el, anchor) {
      el.style.left = `${anchor.x}px`;
      el.style.top = `${anchor.y}px`;
    },

    reposition() {
      for (const [id, entry] of this.bubbleEls) {
        const anchor = this.getAnchor(id);
        if (anchor) this._place(entry.el, anchor);
      }
    },

    clearBubbles() {
      for (const entry of this.bubbleEls.values()) {
        clearTimeout(entry.timer);
        entry.el.remove();
      }
      this.bubbleEls.clear();
    },
  };

  window.Chat = Chat;
})();
