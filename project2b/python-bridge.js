// The only boundary into Python. The receive call has no text/length argument.
export function createCodecBridge(pyodide, notebookContent) {
  const host = pyodide.pyimport('host_codec');
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
