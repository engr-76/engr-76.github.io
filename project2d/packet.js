import { maxBytes, validateRate } from './limits.js';

export const NONCE_BYTES = 16;

export function maxMessageBytes(rate) {
  return maxBytes(rate) - NONCE_BYTES;
}

export function messageInfo(text, rate) {
  validateRate(rate);
  if (typeof text !== 'string') throw new Error('Enter a message.');
  // Do not silently replace malformed UTF-16 before the notebook sees it.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error('Message contains invalid Unicode.');
  }
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxMessageBytes(rate)) {
    throw new Error(`At ${rate} bits/s, use at most ${maxMessageBytes(rate)} message UTF-8 bytes (plus the 16-byte nonce).`);
  }
  return { bytes, packetBytes: bytes + NONCE_BYTES, seconds: 1.1 + (72 + 16 * (bytes + NONCE_BYTES)) / rate };
}

function hexBytes(hex, label) {
  if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error(`Notebook ${label} must be even-length hexadecimal bytes.`);
  }
  return Uint8Array.from(hex.match(/../g) || [], value => Number.parseInt(value, 16));
}

export function packetToBytes(packet, rate, expectedMessageBytes) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet) ||
      Object.keys(packet).sort().join(',') !== 'ciphertext,nonce') {
    throw new Error('Notebook packet must contain exactly nonce and ciphertext.');
  }
  const nonce = hexBytes(packet.nonce, 'nonce');
  const ciphertext = hexBytes(packet.ciphertext, 'ciphertext');
  if (nonce.length !== NONCE_BYTES) throw new Error('Notebook nonce must contain exactly 16 bytes.');
  if (nonce.length + ciphertext.length > maxBytes(rate)) throw new Error('Encrypted packet exceeds this transmission rate’s byte limit.');
  if (expectedMessageBytes !== undefined && ciphertext.length !== expectedMessageBytes) {
    throw new Error('Ciphertext length must match the message’s UTF-8 byte length.');
  }
  const wire = new Uint8Array(nonce.length + ciphertext.length);
  wire.set(nonce);
  wire.set(ciphertext, NONCE_BYTES);
  return wire;
}

export function bytesToPacket(wire, rate) {
  if (!(wire instanceof Uint8Array) || wire.length < NONCE_BYTES || wire.length > maxBytes(rate)) {
    throw new Error('Received packet has an invalid length. It must contain a 16-byte nonce and bounded ciphertext.');
  }
  const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return { nonce: hex(wire.subarray(0, NONCE_BYTES)), ciphertext: hex(wire.subarray(NONCE_BYTES)) };
}
