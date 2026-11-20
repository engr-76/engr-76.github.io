export const SAMPLE_RATE = 44100;
export const MAX_CAPTURE_SECONDS = 20;
export const MAX_SEND_SECONDS = 15;
export const RATES = [50, 100, 200];
export const MAX_NOTEBOOK_BYTES = 8 * 1024 * 1024;

export const DEFAULT_CARRIER = 2000;

export function validateCarrier(carrier) {
  if (!Number.isFinite(carrier) || carrier < 200 || carrier > 8000 || carrier >= SAMPLE_RATE / 2) {
    throw new Error('Choose a carrier frequency from 200 to 8000 Hz.');
  }
  return carrier;
}

export function validateRate(rate) {
  if (!RATES.includes(rate)) throw new Error('Choose 50, 100 or 200 bits/s on both devices.');
  return rate;
}

export function maxBytes(rate) {
  validateRate(rate);
  return Math.min(256, Math.floor((Math.floor(13.9 * rate) - 72) / 16));
}

export function messageInfo(text, rate) {
  validateRate(rate);
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a nonempty message.');
  // TextEncoder replaces lone surrogates; reject them rather than changing text.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error('Message contains invalid Unicode.');
  }
  if (text.length > 512) throw new Error('Message exceeds 256 UTF-8 bytes.');
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > maxBytes(rate)) throw new Error(`At ${rate} bits/s, use at most ${maxBytes(rate)} UTF-8 bytes (15-second limit).`);
  return { bytes, seconds: 1.1 + (72 + 16 * bytes) / rate };
}

export function validateFilter({ useFilter, fmin, fmax }) {
  if (typeof useFilter !== 'boolean') throw new Error('Choose whether to use your bandpass filter.');
  if (useFilter && (!Number.isFinite(fmin) || !Number.isFinite(fmax) || fmin < 0 || fmin >= fmax || fmax > SAMPLE_RATE / 2)) {
    throw new Error('Choose filter bounds with 0 ≤ lower < upper ≤ 22050 Hz.');
  }
}
