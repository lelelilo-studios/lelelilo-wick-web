// Lelelilo: Wick: the sound, on the browser's audio thread. The mixer is a small WebAssembly module of its own
// (audio.wasm, which imports nothing: see crates/audio-web). The game posts it commands as bytes, and the clips it
// has decoded as 16-bit pieces, each answered so the next can follow.
//
// Messages in: a Uint8Array (commands); {op: 'begin', clip, channels, frames, rate}; {op: 'piece', clip, pcm}
// (an Int16Array); {op: 'commit', clip}; {op: 'ask'}. Each but the commands is answered with {op, clip, ok}
// (and the clips' memory, `bytes`, after a commit or an ask). It says {op: 'ready'} once it runs, or
// {op: 'error', error} if it cannot.
class WickAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // (if the mixer could not be started, what the game sends is dropped: the game goes on in silence)
    this.port.onmessage = e => { if (this.w) this.take(e.data); };
    try {
      // Compiling here, off the page's main thread, is allowed synchronously
      const module = new WebAssembly.Module(options.processorOptions.wasm);
      const w = new WebAssembly.Instance(module, {}).exports;
      w.init(sampleRate);
      this.w = w;
      this.port.postMessage({ op: 'ready', rate: sampleRate });
    } catch (e) {
      this.port.postMessage({ op: 'error', error: String(e) });
    }
  }
  take(data) {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) return this.send(data);
    const w = this.w, op = data && data.op, clip = data && data.clip;
    let ok = 0;
    if (op === 'begin') {
      ok = w.clip_begin(clip, data.channels, data.frames, data.rate);
    } else if (op === 'piece') {
      // (into the mixer's own memory, at most the scratch's length at a time, then kept)
      const pcm = data.pcm, most = 65536;
      ok = 1;
      for (let at = 0; ok && at < pcm.length; at += most) {
        const part = pcm.subarray(at, Math.min(pcm.length, at + most));
        new Int16Array(w.memory.buffer, w.clip_space(), part.length).set(part);
        ok = w.clip_write(clip, part.length);
      }
    } else if (op === 'commit') {
      ok = w.clip_commit(clip);
    } else if (op !== 'ask') {
      return;
    }
    this.port.postMessage({ op, clip, ok: ok === 1, bytes: w.clip_bytes() });
  }
  send(data) {
    const bytes = new Uint8Array(data), p = this.w.inbox(bytes.length);
    new Uint8Array(this.w.memory.buffer, p, bytes.length).set(bytes);
    this.w.commands(bytes.length);
  }
  process(_, outputs) {
    const out = outputs[0];
    if (!this.w || !out || !out.length) return true;
    const n = out[0].length, p = this.w.render(n), memory = this.w.memory.buffer;
    // (the views onto the mixer's two sides are kept, made anew only when its memory moves or grows, so the audio
    // thread makes no garbage)
    if (this.memory !== memory || this.at !== p || this.n !== n) {
      [this.memory, this.at, this.n] = [memory, p, n];
      this.left = new Float32Array(memory, p, n);
      this.right = new Float32Array(memory, p + n * 4, n);
    }
    out[0].set(this.left);
    if (out[1]) out[1].set(this.right);
    return true;
  }
}
registerProcessor('wick-audio', WickAudio);
