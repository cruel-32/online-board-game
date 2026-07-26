/**
 * 효과음 — 외부 파일 없이 Web Audio API(+ 브라우저 내장 TTS)로 즉석 합성.
 * 브라우저 자동재생 정책 때문에 최초 사용자 제스처(클릭/터치) 이후에 오디오가 활성화된다.
 */
(function () {
  'use strict';

  let ctx = null;
  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 첫 사용자 입력에서 오디오 컨텍스트/음성 엔진을 미리 깨워둔다.
  const unlock = () => {
    getCtx();
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  /**
   * @param {number} freq 시작 주파수
   * @param {object} opt {type, dur, gain, endFreq, delay}
   */
  function tone(freq, opt) {
    const c = getCtx();
    if (!c) return;
    opt = opt || {};
    const type = opt.type || 'sine';
    const dur = opt.dur || 0.12;
    const gain = opt.gain != null ? opt.gain : 0.18;
    const delay = opt.delay || 0;
    const t0 = c.currentTime + delay;

    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opt.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(opt.endFreq, 1), t0 + dur);

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /**
   * 마작패끼리 부딪히는 듯한 짧고 청량한 "딱" 소리 한 번.
   * 감쇠하는 대역통과 노이즈(타격의 질감) + 짧은 배음 핑(패의 단단한 공명)을 겹친다.
   * @param {number} delay 지연(초)
   * @param {number} pitchMul 개체별 음높이 편차(패마다 살짝 다르게)
   */
  function tileClack(delay, pitchMul) {
    const c = getCtx();
    if (!c) return;
    const dur = 0.055;
    const t0 = c.currentTime + delay;

    // 타격 질감: 짧게 감쇠하는 대역통과 노이즈
    const bufferSize = Math.max(1, Math.round(c.sampleRate * dur));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    const noise = c.createBufferSource();
    noise.buffer = buffer;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200 * pitchMul;
    bp.Q.value = 1.1;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.4, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(c.destination);
    noise.start(t0);
    noise.stop(t0 + dur + 0.01);

    // 단단한 패의 공명: 짧고 높은 배음이 빠르게 떨어짐
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2000 * pitchMul, t0);
    osc.frequency.exponentialRampToValueAtTime(850 * pitchMul, t0 + dur * 0.9);
    const og = c.createGain();
    og.gain.setValueAtTime(0.14, t0);
    og.gain.exponentialRampToValueAtTime(0.0008, t0 + dur * 0.85);
    osc.connect(og);
    og.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  // 강력한 "쾅" 임팩트: 저음 서브 붐(내려꽂힘) + 넓은 노이즈 버스트(타격) + 밝은 트랜지언트.
  // 페어 이상 조합을 한꺼번에 낼 때 사용.
  function slamHit() {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;

    // 1) 서브 붐: 낮게 내려꽂히는 사인
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(170, t0);
    sub.frequency.exponentialRampToValueAtTime(38, t0 + 0.26);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.linearRampToValueAtTime(0.42, t0 + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.34);
    sub.connect(sg); sg.connect(c.destination);
    sub.start(t0); sub.stop(t0 + 0.36);

    // 2) 타격 노이즈 버스트: 넓은 대역, 빠르게 감쇠
    const dur = 0.16;
    const bufferSize = Math.max(1, Math.round(c.sampleRate * dur));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    const noise = c.createBufferSource();
    noise.buffer = buffer;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t0);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    noise.connect(lp); lp.connect(ng); ng.connect(c.destination);
    noise.start(t0); noise.stop(t0 + dur + 0.02);

    // 3) 밝은 금속성 트랜지언트: 짧고 강한 "챙"
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0.16, t0);
    og.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.11);
    osc.connect(og); og.connect(c.destination);
    osc.start(t0); osc.stop(t0 + 0.13);
  }

  function speak(text, opt) {
    opt = opt || {};
    const synth = window.speechSynthesis;
    if (!synth) {
      tone(260, { type: 'sine', endFreq: 150, dur: 0.16, gain: 0.13 }); // 음성 미지원 시 대체음
      return;
    }
    try {
      synth.cancel(); // 빠르게 여러 번 트리거돼도 밀리지 않도록 이전 발화는 취소
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opt.lang || 'ko-KR';
      u.rate = opt.rate || 1.15;
      u.pitch = opt.pitch != null ? opt.pitch : 1.0;
      u.volume = opt.volume != null ? opt.volume : 1.0;
      const voices = synth.getVoices();
      const ko = voices.find((v) => v.lang && v.lang.startsWith('ko'));
      if (ko) u.voice = ko;
      synth.speak(u);
    } catch (_) {
      tone(260, { type: 'sine', endFreq: 150, dur: 0.16, gain: 0.13 });
    }
  }

  const Sound = {
    // 손패에서 타일 선택: 가볍게 집어드는 소리
    select() {
      tone(880, { type: 'triangle', dur: 0.05, gain: 0.11 });
    },
    // 선택 해제: 살짝 낮게 내려놓는 소리
    deselect() {
      tone(560, { type: 'triangle', dur: 0.06, gain: 0.09 });
    },
    // 누군가 패를 테이블에 냄: 마작패가 부딪히는 청량한 소리(2~3개 겹쳐 냄새를 살림)
    play() {
      tileClack(0, 1.0);
      tileClack(0.045, 0.9);
      tileClack(0.085, 1.12);
    },
    // 페어 이상 조합을 한꺼번에 "쾅" 내려칠 때: 강력한 임팩트 + 청량한 패 소리
    slam() {
      slamHit();
      tileClack(0.02, 1.05);
      tileClack(0.06, 0.92);
    },
    // 패스: "패스" 음성 안내
    pass() {
      speak('패스');
    },
    // 내 차례 시작: 놓치기 쉬우므로 밝은 2음 알림 벨 + 음성 안내로 명확하게 알린다
    myTurn() {
      tone(660, { type: 'sine', dur: 0.09, gain: 0.17 });
      tone(880, { type: 'sine', dur: 0.16, gain: 0.2, delay: 0.1 });
      setTimeout(() => speak('내 차례입니다'), 260);
    },
    // 입장: 밝은 3음 아르페지오
    join() {
      tone(523, { type: 'sine', dur: 0.1, gain: 0.14 });
      tone(659, { type: 'sine', dur: 0.1, gain: 0.14, delay: 0.08 });
      tone(784, { type: 'sine', dur: 0.14, gain: 0.14, delay: 0.16 });
    },
    // 퇴장: 차분히 내려가는 2음
    leave() {
      tone(500, { type: 'sine', dur: 0.11, gain: 0.13 });
      tone(360, { type: 'sine', dur: 0.16, gain: 0.12, delay: 0.09 });
    },
    // 칩을 놓거나 가져올 때: 짧고 가벼운 동전 딸깍 소리(노땡스)
    chip() {
      tone(1200, { type: 'sine', dur: 0.045, gain: 0.12, endFreq: 900 });
      tone(1600, { type: 'sine', dur: 0.035, gain: 0.08, delay: 0.02, endFreq: 1300 });
    },
  };

  window.Sound = Sound;
})();
