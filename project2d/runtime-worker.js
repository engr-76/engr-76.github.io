import { createCodecBridge } from './python-bridge.js';

const CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let codec;

async function source(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname.split('/').at(-1)} (${response.status}).`);
  return response.text();
}

self.onmessage = async ({ data }) => {
  const { id, kind } = data;
  try {
    if (kind === 'init') {
      if (typeof data.notebookContent !== 'string') throw new Error('Choose your completed .ipynb notebook.');
      const { loadPyodide } = await import(`${CDN}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: CDN, enableRunUntilComplete: false });
      await pyodide.loadPackage(['numpy', 'scipy']);
      const [importer, host] = await Promise.all([
        source(new URL('./project2c_importer.py', import.meta.url)),
        source(new URL('./project2c_codec.py', import.meta.url)),
      ]);
      const notebook = data.notebookContent;
      pyodide.FS.writeFile('/home/pyodide/project2c_importer.py', importer);
      pyodide.FS.writeFile('/home/pyodide/project2c_codec.py', host);
      codec = createCodecBridge(pyodide, notebook);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(notebook));
      self.postMessage({ id, result: {
        notebook: 'selected local notebook',
        sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
        ...codec.sourceInfo(),
      } });
    } else if (kind === 'encode' && codec) {
      const result = codec.encode(data.text, data.rate, data.carrier);
      self.postMessage({ id, result }, [result.buffer]);
    } else if (kind === 'decode' && codec) {
      self.postMessage({ id, result: codec.decode(data.samples, data.rate, data.settings) });
    } else if (kind === 'encodeBytes' && codec) {
      const result = codec.encodeBytes(data.payload, data.rate, data.carrier);
      self.postMessage({ id, result }, [result.buffer]);
    } else if (kind === 'decodeBytes' && codec) {
      const result = codec.decodeBytes(data.samples, data.rate, data.settings);
      self.postMessage({ id, result }, [result.buffer]);
    } else {
      throw new Error('Python is not ready. Reload the page and try again.');
    }
  } catch (error) {
    // Keep Python tracebacks out of the primary UI; preserve the operative reason.
    const lines = String(error.message || error).trim().split('\n');
    self.postMessage({ id, error: lines.at(-1).replace(/^(?:\w+\.)?\w*Error: /, '') });
  }
};
