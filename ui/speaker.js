"use strict";

// Every sound is synthesised; there are no audio files.
function createSpeaker(ctx) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 12;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(limiter);

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  let drone = null;                          // the sound that is still rising

  function gain(out, value = 0) {
    const g = ctx.createGain();
    g.gain.value = value;
    g.connect(out);
    return g;
  }

  function noise(out, type, from, to, at, seconds, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + seconds);
    src.connect(filter).connect(out);
    src.start(at);
    src.stop(at + seconds + 0.1);
  }

  function tone(out, type, from, to, at, seconds) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + seconds);
    osc.connect(out);
    osc.start(at);
    osc.stop(at + seconds + 0.1);
  }

  function envelope(g, at, attack, peak, release) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  }

  function hush(seconds) {
    if (!drone) return;
    const g = drone.gain, at = ctx.currentTime;
    g.cancelAndHoldAtTime(at);
    g.linearRampToValueAtTime(0, at + seconds);
    drone = null;
  }

  const cues = {
    // A drone that swells for as long as there is time to undo.
    devour(at, seconds) {
      hush(0.05);
      const g = drone = gain(master);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.03, at + Math.min(0.6, seconds / 3));
      g.gain.exponentialRampToValueAtTime(0.14, at + seconds);
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(110, at);
      low.frequency.exponentialRampToValueAtTime(620, at + seconds);
      low.connect(g);
      const length = seconds + 2;
      tone(low, "sawtooth", 46, 58, at, length);
      tone(low, "sawtooth", 46.7, 59.4, at, length);
      tone(low, "sine", 92, 116, at, length);
      noise(g, "bandpass", 240, 1500, at, length, 1.4);
    },
    // Everything rushes inward, then cuts to silence.
    implode(at) {
      hush(0.5);
      const g = gain(master);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(1.25, at + 0.5);
      g.gain.linearRampToValueAtTime(0, at + 0.58);
      noise(g, "bandpass", 300, 5200, at, 0.6, 2);
    },
    impact(at) {
      hush(0.02);
      const boom = gain(master);
      envelope(boom, at, 0.006, 1.5, 1.6);
      tone(boom, "sine", 130, 30, at, 1.4);
      const crack = gain(master);
      envelope(crack, at, 0.003, 0.5, 0.16);
      noise(crack, "lowpass", 6000, 500, at, 0.2);
      const tail = gain(master);
      envelope(tail, at, 0.05, 0.1, 2.2);
      noise(tail, "lowpass", 900, 120, at, 2.3);
    },
    // The page flies back out.
    spit(at) {
      hush(0.08);
      const cough = gain(master);
      envelope(cough, at, 0.01, 0.9, 0.4);
      tone(cough, "triangle", 210, 70, at, 0.3);
      const paper = gain(master);
      envelope(paper, at, 0.06, 0.8, 0.7);
      noise(paper, "bandpass", 3200, 500, at, 0.7, 1.2);
    },
    fail(at) {
      const g = gain(master);
      envelope(g, at, 0.05, 0.35, 1.1);
      tone(g, "triangle", 98, 92, at, 1.2);
      tone(g, "triangle", 104, 97, at, 1.2);
    },
  };

  return (name, volume, seconds) => {
    if (!Object.hasOwn(cues, name)) return;
    master.gain.value = Math.min(1, Math.max(0, volume));
    cues[name](ctx.currentTime + 0.02, Math.min(12, Math.max(1, seconds || 3)));
  };
}

const audio = new AudioContext();
const play = createSpeaker(audio);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "limbo:cue") return;
  audio.resume();
  play(message.name, message.volume, message.seconds);
});
