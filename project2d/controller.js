import { validateCarrier, validateFilter, validateRate, DEFAULT_CARRIER, SAMPLE_RATE, MAX_NOTEBOOK_BYTES } from './limits.js';
import { messageInfo, packetToBytes, bytesToPacket } from './packet.js';
import { resampleToCodec } from './audio.js';

const idle = state => ['idle', 'error'].includes(state);

export class ClientController {
  constructor({ crypto, codec, audio, update }) {
    Object.assign(this, { crypto, codec, audio, update });
    this.generation = 0;
    this.state = 'idle';
    this.ready = false;
    this.files = { crypto: null, codec: null };
    this.lastPacket = null;
    this.receiveConfig = null;
    this.result = null;
    this.experiment = null;
  }

  show(state, status) {
    this.state = state;
    this.update({ state, status, ready: this.ready, files: { ...this.files },
      result: this.result, experiment: this.experiment, packet: this.lastPacket });
  }

  clearResults() {
    this.lastPacket = null;
    this.receiveConfig = null;
    this.result = null;
    this.experiment = null;
  }

  stopWorkers() {
    this.crypto.dispose();
    this.codec.dispose();
    this.ready = false;
  }

  selectNotebook(kind, file) {
    if (!Object.hasOwn(this.files, kind)) throw new Error('Unknown notebook type.');
    this.files[kind] = file || null;
    return this.initialize();
  }

  async initialize() {
    const generation = ++this.generation;
    this.audio.cancel();
    this.stopWorkers();
    this.clearResults();
    const files = { ...this.files };
    try {
      for (const [kind, file] of Object.entries(files)) {
        if (!file) continue;
        const project = kind === 'crypto' ? '2d' : '2c';
        if (!/\.ipynb$/i.test(file.name)) throw new Error(`Choose an .ipynb file for Project ${project}.`);
        if (!file.size) throw new Error(`The Project ${project} file is empty. Choose your saved, completed notebook.`);
        if (file.size > MAX_NOTEBOOK_BYTES) throw new Error(`Project ${project} notebook exceeds 8 MiB. Clear stored outputs and save it again.`);
      }
      if (!files.crypto || !files.codec) {
        this.show('idle', `Choose your completed Project ${!files.crypto && !files.codec ? '2d and Project 2c notebooks' : !files.crypto ? '2d notebook' : '2c notebook'} to begin.`);
        return;
      }
      this.show('loading', 'Loading both notebooks and checking your functions… The first visit may take a minute.');
      const contents = await Promise.all([files.crypto.text(), files.codec.text()]);
      if (generation !== this.generation) return;
      if (contents.some(content => !content.trim())) throw new Error('A notebook is empty. Choose both saved, completed notebooks.');
      await Promise.all([
        this.crypto.init({ notebookContent: contents[0] }),
        this.codec.init({ notebookContent: contents[1] }),
      ]);
      if (generation !== this.generation) return;
      this.ready = true;
      this.show('idle', 'Ready. On the receiving device, press Receive before the sender presses Send.');
    } catch (error) {
      if (generation !== this.generation) return;
      this.stopWorkers();
      this.show('error', `${error.message} Choose corrected notebooks or use Retry.`);
    }
  }

  fail(error, generation) {
    if (generation !== this.generation) return;
    this.audio.cancel();
    this.receiveConfig = null;
    this.ready = this.crypto.ready && this.codec.ready;
    if (!this.ready) this.stopWorkers();
    this.show('error', error.message || 'Something went wrong. Please try again.');
  }

  async send(text, password, rate, carrier = DEFAULT_CARRIER) {
    if (!this.ready || !idle(this.state)) return;
    const generation = ++this.generation;
    this.clearResults();
    try {
      const info = messageInfo(text, rate);
      validateCarrier(carrier);
      if (typeof password !== 'string') throw new Error('Enter your shared password.');
      this.show('preparing', 'Encrypting your message, then preparing the tone…');
      // Unlock audio immediately within the Send gesture, before Python awaits.
      await this.audio.preparePlayback();
      if (generation !== this.generation) return;
      const packet = await this.crypto.encrypt(text, password);
      if (generation !== this.generation) return;
      const wire = packetToBytes(packet, rate, info.bytes);
      const samples = await this.codec.encodeBytes(wire, rate, carrier);
      if (generation !== this.generation) return;
      const playback = this.audio.play(samples);
      this.lastPacket = { ...packet };
      this.show('sending', `Sending encrypted bytes through the speaker · ${(samples.length / SAMPLE_RATE).toFixed(1)} seconds.`);
      await playback;
      if (generation === this.generation) this.show('idle', 'Tone finished. On the receiving device, press Stop & decode.');
    } catch (error) { this.fail(error, generation); }
  }

  async receive(rate, password, settings = { useFilter: true, fmin: 1500, fmax: 2500 }) {
    if (!this.ready || !idle(this.state)) return;
    const generation = ++this.generation;
    this.clearResults();
    try {
      validateRate(rate);
      validateFilter(settings);
      if (typeof password !== 'string') throw new Error('Enter your shared password.');
      // The receive path has no message, nonce, ciphertext or sender state.
      this.receiveConfig = { rate, password, settings: { ...settings } };
      this.show('permission', 'Opening the microphone… Allow access if your browser asks.');
      await this.audio.startCapture({
        onLimit: () => { if (generation === this.generation) void this.finishReceive(); },
        onError: error => this.fail(error, generation),
      });
      if (generation === this.generation && this.state === 'permission') {
        this.show('receiving', 'Microphone is listening. Send from the other device, then press Stop & decode. Ends after 20 seconds.');
      }
    } catch (error) { this.fail(error, generation); }
  }

  async finishReceive() {
    if (this.state !== 'receiving') return;
    const generation = this.generation;
    const { rate, password, settings } = this.receiveConfig;
    this.receiveConfig = null;
    this.show('decoding', 'Microphone stopped. Decoding sound, then decrypting the recovered packet…');
    try {
      const capture = await this.audio.finishCapture();
      if (generation !== this.generation) return;
      const samples = resampleToCodec(capture.samples, capture.sampleRate);
      const wire = await this.codec.decodeBytes(samples, rate, settings);
      if (generation !== this.generation) return;
      const packet = bytesToPacket(wire, rate);
      this.lastPacket = { ...packet };
      const result = await this.crypto.decrypt(JSON.stringify(packet), password);
      if (generation !== this.generation) return;
      this.result = result;
      this.show('idle', 'Recovered bytes displayed. Compare with the original; readable text does not prove the password or authenticity.');
    } catch (error) { this.fail(error, generation); }
  }

  async experimentWithPassword(password, flip = null) {
    if (!this.ready || !idle(this.state) || !this.lastPacket) return;
    const generation = ++this.generation;
    const packet = JSON.stringify(this.lastPacket);
    this.experiment = null;
    this.show('experiment', flip ? 'Changing one ciphertext bit and decrypting both packets…' : 'Decrypting the last packet with this password…');
    try {
      const result = flip
        ? await this.crypto.flip(packet, password, flip.byteIndex, flip.bitIndex)
        : await this.crypto.decrypt(packet, password);
      if (generation !== this.generation) return;
      this.experiment = flip ? { kind: 'flip', ...result } : { kind: 'password', recovered: result };
      this.show('idle', flip ? 'Changed bytes displayed. This construction does not detect tampering.' : 'Recovered bytes displayed. No password or authenticity check is available.');
    } catch (error) { this.fail(error, generation); }
  }

  cancel() {
    const previous = this.state;
    ++this.generation;
    this.audio.cancel();
    this.receiveConfig = null;
    if (['loading', 'preparing', 'decoding', 'experiment'].includes(previous)) this.stopWorkers();
    this.show('idle', this.ready ? 'Cancelled. Ready to send or receive again.' : 'Cancelled. Use Retry to reload both notebooks.');
  }

  dispose() {
    ++this.generation;
    this.audio.cancel();
    this.stopWorkers();
    this.receiveConfig = null;
    this.clearResults();
    this.show('idle', 'Paused. Use Retry to reload both notebooks.');
  }
}
