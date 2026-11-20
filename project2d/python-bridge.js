// The only boundary into Python. The receive call has no text/length argument.
export function createCodecBridge(pyodide, notebookContent) {
  const host = pyodide.pyimport('project2c_codec');
  let codec;
  try { codec = host.create_codec(notebookContent); }
  finally { host.destroy(); }
  return {
    sourceInfo() {
      const result = codec.source_info();
      try { return result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false }); }
      finally { result.destroy(); }
    },
    encode(text, rate, carrier = 2000) {
      const result = codec.encode_message(text, rate, carrier);
      try { return new Float32Array(result.toJs()); }
      finally { result.destroy(); }
    },
    encodeBytes(payload, rate, carrier = 2000) {
      if (!(payload instanceof Uint8Array)) throw new TypeError('Payload must be Uint8Array.');
      const input = pyodide.toPy(payload);
      const builtins = pyodide.pyimport('builtins');
      let bytes;
      try {
        bytes = builtins.bytes(input);
        const result = codec.encode_bytes(bytes, rate, carrier);
        try { return new Float32Array(result.toJs()); }
        finally { result.destroy(); }
      } finally { bytes?.destroy(); builtins.destroy(); input.destroy(); }
    },
    decodeBytes(samples, rate, { useFilter = true, fmin = 1500, fmax = 2500 } = {}) {
      const input = pyodide.toPy(samples);
      try {
        const result = codec.decode_bytes(input, rate, useFilter, fmin, fmax);
        try { return new Uint8Array(result.toJs()); }
        finally { result.destroy(); }
      } finally { input.destroy(); }
    },
    decode(samples, rate, { useFilter = true, fmin = 1500, fmax = 2500 } = {}) {
      const input = pyodide.toPy(samples);
      try {
        const result = codec.decode_recording(input, rate, useFilter, fmin, fmax);
        try { return result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false }); }
        finally { result.destroy(); }
      }
      finally { input.destroy(); }
    },
    destroy() { codec.destroy(); },
  };
}
