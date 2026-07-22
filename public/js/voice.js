/**
 * 음성채팅 — 참가자끼리 WebRTC로 직접 연결(mesh)하는 P2P 오디오.
 * 서버(WebSocket)는 offer/answer/ICE candidate를 옆 사람에게 전달해주는 시그널링 중계만 담당하고,
 * 실제 음성 데이터는 서버를 거치지 않는다.
 *
 * 누가 누구에게 먼저 offer를 보낼지는 접속마다 다시 정하지 않고, 두 클라이언트 id를 문자열로
 * 비교해 항상 더 큰 쪽이 offer를 보내는 규칙으로 고정한다(양쪽이 동시에 offer를 보내는 충돌 방지).
 */
(function () {
  'use strict';

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  const VoiceChat = {
    myId: null,
    send: null,
    onStateChange: null,
    onError: null,

    enabled: false,
    muted: false,
    localStream: null,
    peers: new Map(), // id -> RTCPeerConnection
    audioEls: new Map(), // id -> <audio>
    lastRoster: new Set(),

    init({ myId, send, onStateChange, onError }) {
      this.myId = myId;
      this.send = send;
      this.onStateChange = onStateChange;
      this.onError = onError;
    },

    supported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    },

    async enable() {
      if (this.enabled) return true;
      if (!this.supported()) {
        if (this.onError) this.onError('이 브라우저/환경에서는 음성채팅을 사용할 수 없습니다. (마이크 권한에는 HTTPS 접속이 필요합니다)');
        return false;
      }
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        if (this.onError) this.onError('마이크 권한을 허용해야 음성채팅을 사용할 수 있습니다.');
        return false;
      }
      this.enabled = true;
      this.muted = false;
      this.send({ type: 'voice_join' });
      if (this.onStateChange) this.onStateChange();
      return true;
    },

    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      for (const id of Array.from(this.peers.keys())) this._teardownPeer(id);
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }
      this.send({ type: 'voice_leave' });
      if (this.onStateChange) this.onStateChange();
    },

    setMuted(muted) {
      if (!this.enabled) return;
      this.muted = !!muted;
      if (this.localStream) this.localStream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
      this.send({ type: 'mic_state', muted: this.muted });
      if (this.onStateChange) this.onStateChange();
    },

    // 방/게임 상태 브로드캐스트에서 현재 음성채팅 참가자 id 목록을 받아 mesh를 맞춘다.
    handleRoster(participantIds) {
      const set = new Set(participantIds);
      this.lastRoster = set;
      if (!this.enabled) return;

      for (const id of Array.from(this.peers.keys())) {
        if (!set.has(id)) this._teardownPeer(id);
      }
      for (const id of set) {
        if (id === this.myId || this.peers.has(id)) continue;
        const iInitiate = this.myId > id; // 결정론적 tie-break: 더 큰 id가 offer를 보냄
        this._ensurePeer(id, iInitiate);
      }
    },

    async handleSignal(fromId, data) {
      if (!this.enabled) return;
      let pc = this.peers.get(fromId);
      if (!pc) pc = this._ensurePeer(fromId, false);
      try {
        if (data.kind === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({ type: 'voice_signal', to: fromId, data: { kind: 'answer', sdp: pc.localDescription } });
        } else if (data.kind === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.kind === 'ice' && data.candidate) {
          await pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (e) {
        console.error('[voice] signal 처리 실패:', e);
      }
    },

    _ensurePeer(id, initiator) {
      if (this.peers.has(id)) return this.peers.get(id);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.peers.set(id, pc);

      if (this.localStream) {
        for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) this.send({ type: 'voice_signal', to: id, data: { kind: 'ice', candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        let audio = this.audioEls.get(id);
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true;
          audio.playsInline = true;
          audio.style.display = 'none';
          document.body.appendChild(audio);
          this.audioEls.set(id, audio);
        }
        audio.srcObject = e.streams[0];
      };
      if (initiator) {
        pc.onnegotiationneeded = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.send({ type: 'voice_signal', to: id, data: { kind: 'offer', sdp: pc.localDescription } });
          } catch (e) {
            console.error('[voice] offer 생성 실패:', e);
          }
        };
      }
      return pc;
    },

    _teardownPeer(id) {
      const pc = this.peers.get(id);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onnegotiationneeded = null;
        pc.close();
        this.peers.delete(id);
      }
      const audio = this.audioEls.get(id);
      if (audio) {
        audio.srcObject = null;
        audio.remove();
        this.audioEls.delete(id);
      }
    },

    // 방을 나가거나 연결이 끊겼을 때 전체 초기화(다음 방에 영향이 남지 않도록).
    reset() {
      this.enabled = false;
      this.muted = false;
      for (const id of Array.from(this.peers.keys())) this._teardownPeer(id);
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }
      this.lastRoster = new Set();
      if (this.onStateChange) this.onStateChange();
    },
  };

  window.VoiceChat = VoiceChat;
})();
