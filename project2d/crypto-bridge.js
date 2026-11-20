// This is the only boundary into Python. No cipher implementation lives in JS.
export function createCryptoBridge(pyodide, notebookContent) {
  const host = pyodide.pyimport('host_crypto');
  let demo;
  try { demo = host.create_demo(notebookContent); }
  finally { host.destroy(); }
  function converted(result) {
    try { return result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false }); }
    finally { result.destroy(); }
  }
  return {
    sourceInfo: () => converted(demo.source_info()),
    encrypt: (message, password) => converted(demo.encrypt_message(message, password)),
    decrypt: (packet, password) => converted(demo.decrypt_packet(packet, password)),
    flip: (packet, password, byteIndex, bitIndex) => converted(demo.flip_bit(packet, password, byteIndex, bitIndex)),
    destroy: () => demo.destroy(),
  };
}
