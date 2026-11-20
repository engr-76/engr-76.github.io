import { createCryptoBridge } from './crypto-bridge.js';

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';
let demo;
let busy = false;

async function source(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split('/').at(-1)} (${response.status}).`);
  return response.text();
}

self.onmessage = async ({ data }) => {
  const { id, kind } = data;
  if (busy) { self.postMessage({ id, error: 'Python is busy. Wait for the current action.' }); return; }
  busy = true;
  try {
    let result;
    if (kind === 'init') {
      if (demo) throw new Error('Choose the notebook again to start a fresh worker.');
      if (typeof data.notebookContent !== 'string') throw new Error('Choose your completed .ipynb notebook.');
      const { loadPyodide } = await import(`${CDN}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: CDN, enableRunUntilComplete: false });
      // 314.x removed OpenSSL-backed hashlib. This pinned compatible release
      // provides the actual stdlib extension; load it before any hashlib import.
      await pyodide.loadPackage('hashlib');
      const [importer, host] = await Promise.all([
        source(new URL('./notebook_importer.py', import.meta.url)),
        source(new URL('./host_crypto.py', import.meta.url)),
      ]);
      pyodide.FS.writeFile('/home/pyodide/notebook_importer.py', importer);
      pyodide.FS.writeFile('/home/pyodide/host_crypto.py', host);
      demo = createCryptoBridge(pyodide, data.notebookContent);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.notebookContent));
      result = { sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''), ...demo.sourceInfo() };
    } else if (!demo) {
      throw new Error('Choose your completed notebook before using the demo.');
    } else if (kind === 'encrypt') {
      result = demo.encrypt(data.message, data.password);
    } else if (kind === 'decrypt') {
      result = demo.decrypt(data.packet, data.password);
    } else if (kind === 'flip') {
      result = demo.flip(data.packet, data.password, data.byteIndex, data.bitIndex);
    } else {
      throw new Error('Unknown demo action.');
    }
    self.postMessage({ id, result });
  } catch (error) {
    const lines = String(error.message || error).trim().split('\n');
    self.postMessage({ id, error: lines.at(-1).replace(/^(?:\w+\.)?\w*Error: /, '') });
  } finally {
    busy = false;
  }
};
