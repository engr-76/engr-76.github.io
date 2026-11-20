import { IndependentAudio } from './audio.js';
import { PythonRuntime } from './runtime.js';
import { CryptoRuntime } from './crypto-runtime.js';
import { ClientController } from './controller.js';
import { maxMessageBytes, messageInfo } from './packet.js';

export function recoveredText(result) {
  // Pyodide's Python None converts to undefined; JSON fixtures may use null.
  return result.text == null ? 'These bytes are not valid UTF-8.' : result.text === '' ? '(empty message)' : result.text;
}

export function mount(document, window, { crypto = new CryptoRuntime(), codec = new PythonRuntime(), audio = new IndependentAudio() } = {}) {
  const get = id => document.getElementById(id);
  const rate = get('rate');
  const message = get('message');
  const password = get('password');
  const secure = window.isSecureContext;
  get('secure-notice').hidden = secure;

  function describeMessage() {
    const hint = get('message-info');
    hint.classList.remove('invalid');
    try {
      const info = messageInfo(message.value, Number(rate.value));
      hint.textContent = `${info.bytes} / ${maxMessageBytes(Number(rate.value))} message UTF-8 bytes + 16 nonce bytes · about ${info.seconds.toFixed(1)} seconds`;
    } catch (error) {
      hint.textContent = error.message;
      hint.classList.add('invalid');
    }
  }

  const controller = new ClientController({ crypto, codec, audio, update({ state, status, ready, files, result, experiment, packet }) {
    const busy = !['idle', 'error'].includes(state);
    get('send').disabled = !ready || busy;
    get('receive').disabled = !ready || busy || !secure;
    get('stop').disabled = state !== 'receiving';
    get('cancel').hidden = !busy;
    get('retry').hidden = !files.crypto || !files.codec || ready || state === 'loading';
    for (const [kind, id] of [['crypto', 'crypto-status'], ['codec', 'codec-status']]) {
      get(id).textContent = !files[kind] ? 'No notebook selected.'
        : `${ready ? 'Ready' : state === 'loading' ? 'Loading' : 'Selected'}: ${files[kind].name}`;
    }
    for (const id of ['rate', 'carrier', 'message', 'password', 'use-filter', 'experiment-password', 'byte-index', 'bit-index']) {
      get(id).disabled = busy;
    }
    get('filter-min').disabled = busy || !get('use-filter').checked;
    get('filter-max').disabled = busy || !get('use-filter').checked;
    get('try-password').disabled = !ready || busy || !packet;
    get('flip').disabled = !ready || busy || !packet?.ciphertext;
    get('status').textContent = status;
    get('state-dot').dataset.state = state;
    get('packet-info').textContent = packet
      ? `Last local packet: 16 nonce bytes and ${packet.ciphertext.length / 2} ciphertext bytes. These experiments do not send audio.`
      : 'Send or receive a packet first. These experiments run locally on that packet.';
    get('byte-index').max = Math.max(0, (packet?.ciphertext.length || 0) / 2 - 1);
    get('recovered-text').textContent = result ? recoveredText(result) : 'Your received message will appear here.';
    get('recovered-text').classList.toggle('empty', !result);
    get('recovered-hex').textContent = result ? result.hex || '(empty bytes)' : '—';
    get('recovered-info').textContent = result
      ? `${result.byte_length} recovered bytes. No password or authenticity check is available.` : '';
    get('experiment-result').hidden = !experiment;
    if (experiment?.kind === 'password') {
      get('experiment-text').textContent = recoveredText(experiment.recovered);
      get('experiment-hex').textContent = experiment.recovered.hex || '(empty bytes)';
      get('bit-result').textContent = `${experiment.recovered.byte_length} recovered bytes. Readability does not prove authenticity.`;
      get('before-row').hidden = true;
    } else if (experiment?.kind === 'flip') {
      get('experiment-text').textContent = recoveredText(experiment.after);
      get('experiment-hex').textContent = experiment.after.hex || '(empty bytes)';
      get('before-hex').textContent = experiment.before.hex || '(empty bytes)';
      get('before-row').hidden = false;
      get('bit-result').textContent = `${experiment.changed_bits} recovered bit${experiment.changed_bits === 1 ? '' : 's'} changed. The nonce and ciphertext length stayed the same. The last original packet was preserved.`;
    }
  } });

  for (const [kind, id] of [['crypto', 'crypto-notebook'], ['codec', 'codec-notebook']]) {
    get(id).addEventListener('change', () => {
      const file = get(id).files?.[0] || null;
      get(id).value = ''; // Allow selecting the same filename after saving corrections.
      password.value = '';
      get('experiment-password').value = '';
      void controller.selectNotebook(kind, file);
    });
  }
  get('send').addEventListener('click', () => void controller.send(message.value, password.value, Number(rate.value), Number(get('carrier').value)));
  // Receive reads no sender message or packet. Only microphone audio crosses devices.
  get('receive').addEventListener('click', () => void controller.receive(Number(rate.value), password.value, {
    useFilter: get('use-filter').checked,
    fmin: get('filter-min').value === '' ? NaN : Number(get('filter-min').value),
    fmax: get('filter-max').value === '' ? NaN : Number(get('filter-max').value),
  }));
  get('stop').addEventListener('click', () => void controller.finishReceive());
  get('cancel').addEventListener('click', () => controller.cancel());
  get('retry').addEventListener('click', () => void controller.initialize());
  get('try-password').addEventListener('click', () => void controller.experimentWithPassword(get('experiment-password').value));
  get('flip').addEventListener('click', () => void controller.experimentWithPassword(get('experiment-password').value, {
    byteIndex: get('byte-index').value === '' ? NaN : Number(get('byte-index').value),
    bitIndex: get('bit-index').value === '' ? NaN : Number(get('bit-index').value),
  }));
  get('use-filter').addEventListener('change', () => {
    get('filter-min').disabled = !get('use-filter').checked;
    get('filter-max').disabled = !get('use-filter').checked;
  });
  message.addEventListener('input', describeMessage);
  rate.addEventListener('change', describeMessage);
  window.addEventListener('pagehide', () => controller.dispose());
  window.addEventListener('beforeunload', () => controller.dispose());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !['idle', 'error'].includes(controller.state)) controller.dispose();
  });
  describeMessage();
  void controller.initialize();
  return controller;
}

if (typeof document !== 'undefined') mount(document, window);
