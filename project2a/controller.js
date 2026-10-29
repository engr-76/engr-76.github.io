import { messageInfo, validateRate, validateCarrier, DEFAULT_CARRIER, SAMPLE_RATE, MAX_NOTEBOOK_BYTES } from './limits.js';
import { resampleToCodec } from './audio.js';

export class ClientController {
  constructor({ runtime, audio, update }) {
    Object.assign(this, { runtime, audio, update });
    this.generation = 0;
    this.state = 'idle';
    this.ready = false;
    this.notebookFile = null;
  }

  show(state, status, result) {
    this.state = state;
    this.update({ state, status, result, ready: this.ready, notebookName: this.notebookFile?.name || null });
  }

  selectNotebook(file) {
    this.notebookFile = file;
    return this.initialize();
  }

  async initialize() {
    const generation = ++this.generation;
    this.audio.cancel();
    this.runtime.dispose();
    this.ready = false;
    const file = this.notebookFile;
    if (!file) {
      this.show('idle', 'Choose your completed Project 2a notebook to begin.', '');
      return;
    }
    this.show('loading', 'Loading your notebook, Python and NumPy… The first visit may take a moment.', '');
    try {
      if (!/\.ipynb$/i.test(file.name)) throw new Error('Choose an .ipynb notebook.');
      if (file.size > MAX_NOTEBOOK_BYTES) throw new Error('Choose a notebook up to 8 MiB. Clear stored notebook outputs if necessary.');
      const notebookContent = await file.text();
      if (generation !== this.generation) return;
      await this.runtime.init({ notebookContent });
      if (generation !== this.generation) return;
      this.ready = true;
      this.show('idle', 'Ready. Choose Send or Receive.');
    } catch (error) {
      if (generation !== this.generation) return;
      this.ready = false;
      this.show('error', `Could not load your notebook. ${error.message} Choose a corrected notebook or use Retry.`);
    }
  }

  fail(error, generation) {
    if (generation !== this.generation) return;
    this.audio.cancel();
    this.ready = this.runtime.ready;
    this.show('error', error.message || 'Something went wrong. Please try again.');
  }

  async send(text, rate, carrier = DEFAULT_CARRIER) {
    if (!this.ready || !['idle', 'error'].includes(this.state)) return;
    const generation = ++this.generation;
    try {
      messageInfo(text, rate);
      validateCarrier(carrier);
      this.show('preparing', 'Preparing the tone…');
      await this.audio.preparePlayback();
      if (generation !== this.generation) return;
      const samples = await this.runtime.encode(text, rate, carrier);
      if (generation !== this.generation) return;
      const playback = this.audio.play(samples);
      this.show('sending', `Sending through the speaker · ${(samples.length / SAMPLE_RATE).toFixed(1)} seconds.`, '');
      await playback;
      if (generation === this.generation) this.show('idle', 'Tone finished. On the receiving device, press Stop to decode.');
    } catch (error) { this.fail(error, generation); }
  }

  async receive(rate) {
    if (!this.ready || !['idle', 'error'].includes(this.state)) return;
    const generation = ++this.generation;
    try {
      validateRate(rate);
      this.receiveRate = rate; // snapshot only the selected rate, never sender data
      this.show('permission', 'Opening the microphone… Allow access if your browser asks.', '');
      await this.audio.startCapture({
        onLimit: () => { if (generation === this.generation) void this.stop(); },
        onError: error => this.fail(error, generation),
      });
      if (generation === this.generation && this.state === 'permission') {
        this.show('receiving', 'Microphone is listening. Send from the other device, then press Stop. Ends after 20 seconds.');
      }
    } catch (error) { this.fail(error, generation); }
  }

  async stop() {
    if (this.state === 'receiving') {
      const generation = this.generation;
      const rate = this.receiveRate;
      this.show('decoding', 'Microphone stopped. Decoding the recording…');
      try {
        const capture = await this.audio.finishCapture();
        if (generation !== this.generation) return;
        const samples = resampleToCodec(capture.samples, capture.sampleRate);
        const decoded = await this.runtime.decode(samples, rate);
        if (generation === this.generation) this.show('idle', 'Recording decoded. Errors may remain.', decoded.text);
      } catch (error) { this.fail(error, generation); }
      return;
    }
    const previous = this.state;
    ++this.generation; // invalidate every late permission, init or codec continuation
    this.audio.cancel();
    if (['loading', 'preparing', 'decoding'].includes(previous)) {
      this.runtime.dispose();
      this.ready = false;
    }
    this.show('idle', this.ready ? 'Stopped. Ready to send or receive again.' : 'Stopped. Use Retry to load Python again.');
  }

  dispose() {
    ++this.generation;
    this.audio.cancel();
    this.runtime.dispose();
    this.ready = false;
    this.show('idle', 'Paused. Use Retry to load Python again.');
  }
}
