/**
 * 게임 독립 사이드 위젯(음성/마이크/채팅 버튼) — 배치·상태 관리.
 * 대기실에서는 상단 액션 줄로, 게임 화면에서는 우측 상단 고정으로 배치한다.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const Widgets = {
    voice: null,
    chat: null,
    toast: null,

    init({ voice, chat, toast }) {
      this.voice = voice;
      this.chat = chat;
      this.toast = toast;

      $('btn-voice-toggle').addEventListener('click', async () => {
        if (voice.enabled) voice.disable();
        else await voice.enable();
      });
      $('btn-mic-toggle').addEventListener('click', () => voice.setMuted(!voice.muted));
      $('btn-chat-toggle').addEventListener('click', () => chat.toggle());
      voice.init({
        myId: chat.myId,
        send: (m) => window.Net.send(m),
        onStateChange: () => this.refreshVoice(),
        onError: (m) => toast(m),
      });
    },

    // 화면 전환 시 위젯 배치 변경
    place(screenName) {
      const widgets = $('side-widgets');
      if (screenName === 'room') {
        const bar = $('room-footer-actions');
        bar.insertBefore(widgets, bar.firstChild);
        widgets.classList.add('inline');
      } else {
        $('side-widgets-home').after(widgets);
        widgets.classList.remove('inline');
      }
    },

    update(inRoom) {
      $('side-widgets').classList.toggle('hidden', !inRoom);
      if (!inRoom) $('chat-panel').classList.add('hidden');
      this.refreshVoice();
    },

    refreshVoice() {
      const voiceBtn = $('btn-voice-toggle');
      const micBtn = $('btn-mic-toggle');
      voiceBtn.textContent = this.voice.enabled ? '🔊 음성' : '🔇 음성';
      voiceBtn.classList.toggle('on', this.voice.enabled);
      micBtn.disabled = !this.voice.enabled;
      micBtn.textContent = this.voice.muted ? '🔕' : '🎙️';
      micBtn.classList.toggle('muted', this.voice.muted);
    },
  };

  window.Widgets = Widgets;
})();
