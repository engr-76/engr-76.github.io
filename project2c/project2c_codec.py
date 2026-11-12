"""Byte framing and bounds; all seven algorithms come from the uploaded notebook.

The header and payload are independently terminated convolutional blocks. This
lets the receiver Viterbi-decode the length before demodulating the whole frame,
without requiring the sender's message, length or any out-of-band packet.
"""

from functools import wraps
import numbers

import numpy as np
from project2c_importer import import_notebook, REQUIRED_FUNCTIONS, NotebookImportError

fs = 44_100
CARRIER = 2_000
RATES = (50, 100, 200)
MAX_PAYLOAD = 256
MAX_SEND_SECONDS = 15
MAX_CAPTURE_SECONDS = 20
GUARD_SAMPLES = 4_410  # host leading 100 ms
TRAILER_SAMPLES = fs  # reserve the provided add_silence helper's one-second tail
PREAMBLE = b"\xd3\x91"
HEADER_BITS = 32
ENCODED_HEADER_BITS = 2 * (HEADER_BITS + 2)
OVERHEAD_BITS = ENCODED_HEADER_BITS + 4  # payload's two terminating message bits


class DecodeError(ValueError):
    """Could not locate a bounded message; safe to show the reason to the user."""


def _rate(rate):
    if isinstance(rate, (bool, np.bool_)) or not isinstance(rate, numbers.Real) or rate not in RATES:
        raise ValueError("Choose 50, 100 or 200 bits/s on both devices.")
    return int(rate)


def _carrier(carrier):
    if (isinstance(carrier, (bool, np.bool_)) or not isinstance(carrier, numbers.Real)
            or not np.isfinite(carrier) or not 200 <= carrier <= 8000 or carrier >= fs / 2):
        raise ValueError("Choose a carrier frequency from 200 to 8000 Hz.")
    return float(carrier)


def _samples(signal):
    # Inspect size before converting/copying a possibly large input.
    array = np.asarray(signal)
    if array.ndim != 1 or not 0 < array.size <= fs * MAX_CAPTURE_SECONDS:
        raise ValueError("Audio must be a nonempty, one-dimensional recording of at most 20 seconds.")
    if array.dtype.kind not in "fiu" or not np.all(np.isfinite(array)):
        raise ValueError("Audio samples must be finite real numbers.")
    return array.astype(np.float64, copy=False)


def _sample_count(bits, rate):
    return (bits * fs + rate - 1) // rate


def max_payload_bytes(rate):
    rate = _rate(rate)
    available = fs * MAX_SEND_SECONDS - GUARD_SAMPLES - TRAILER_SAMPLES
    return min(MAX_PAYLOAD, (available * rate // fs - OVERHEAD_BITS) // 16)


def transmission_samples(byte_length, rate):
    """Demo-based preflight byte budget, never an output buffer allocation."""
    rate = _rate(rate)
    if isinstance(byte_length, (bool, np.bool_)) or not isinstance(byte_length, numbers.Integral) or not 1 <= byte_length <= MAX_PAYLOAD:
        raise ValueError("Payload must contain 1–256 bytes.")
    count = GUARD_SAMPLES + TRAILER_SAMPLES + _sample_count(OVERHEAD_BITS + 16 * int(byte_length), rate)
    if count > fs * MAX_SEND_SECONDS:
        raise ValueError(f"At {rate} bits/s, use at most {max_payload_bytes(rate)} payload bytes (15-second limit).")
    return count


def _call(function, *args):
    try:
        return function(*args)
    except Exception as error:
        raise DecodeError(f"{function.__name__}: {error}") from error


def _returned_array(result, function):
    try:
        return np.asarray(result)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"{function} must return a numeric array (got invalid output).") from error


def _wave(result, function, limit):
    array = _returned_array(result, function)
    if array.ndim != 1 or not 0 < array.size <= limit or array.dtype.kind not in "fiu":
        raise ValueError(f"{function} must return a nonempty 1-D real sample array within the 15-second send limit (got None/invalid output or too many samples).")
    if not np.all(np.isfinite(array)) or np.any(np.abs(array) > np.finfo(np.float32).max):
        raise ValueError(f"{function} must return finite samples representable as float32.")
    return array.astype(np.float64, copy=False)


class Codec:
    def __init__(self, algorithms):
        self.algorithms = algorithms
        original_start = algorithms.detect_start

        @wraps(original_start)
        def checked_start(signal, visual_test=False):
            if visual_test:
                raise DecodeError("detect_start: optional visualization is unsupported in the browser audio path.")
            result = _call(original_start, signal, visual_test)
            if isinstance(result, (bool, np.bool_)) or not isinstance(result, numbers.Integral) or not 0 <= result < len(signal):
                raise DecodeError("detect_start must return an integer sample index within the capture (got None/invalid output).")
            return result

        # A return-value boundary, not an algorithm rewrite: demodulate still
        # invokes the original detect_start body through this checked call.
        algorithms.detect_start = checked_start

    def source_info(self):
        return {"functions": list(REQUIRED_FUNCTIONS), "declarations": list(self.algorithms.__declarations__)}

    def encode_message(self, text, rate, carrier=CARRIER):
        """UTF-8 convenience method over the reusable byte-payload interface."""
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Enter a nonempty message.")
        if len(text) > MAX_PAYLOAD:
            raise ValueError("Message exceeds 256 UTF-8 bytes.")
        try:
            payload = text.encode("utf-8", errors="strict")
        except UnicodeEncodeError as error:
            raise ValueError("Message contains invalid Unicode.") from error
        return self.encode_bytes(payload, rate, carrier)

    @staticmethod
    def _bits(result, function, expected):
        bits = _returned_array(result, function)
        if (bits.ndim != 1 or bits.size != expected or bits.dtype.kind not in "biuf"
                or not np.all((bits == 0) | (bits == 1))):
            raise DecodeError(f"{function} must return exactly {expected} bits containing only 0 and 1.")
        return bits.astype(np.uint8, copy=False)

    def _encode_bits(self, bits):
        return self._bits(_call(self.algorithms.conv_encode, bits.copy()),
                          "conv_encode", 2 * (bits.size + 2))

    def _decode_bits(self, bits):
        return self._bits(_call(self.algorithms.viterbi_decode, bits.copy()),
                          "viterbi_decode", bits.size // 2 - 2)

    def encode_bytes(self, payload, rate, carrier=CARRIER):
        """Return mono float32 audio at 44.1 kHz for a nonempty bytes payload."""
        rate, carrier = _rate(rate), _carrier(carrier)
        if not isinstance(payload, (bytes, bytearray, memoryview)):
            raise ValueError("Payload must be bytes, bytearray or a byte memoryview.")
        payload = bytes(payload)
        transmission_samples(len(payload), rate)
        header = PREAMBLE + len(payload).to_bytes(2, "big")
        blocks = [np.unpackbits(np.frombuffer(block, dtype=np.uint8), bitorder="big")
                  for block in (header, payload)]
        bits = np.concatenate([self._encode_bits(block) for block in blocks])
        wave = _wave(_call(self.algorithms.generate_modulated_signal, bits, rate, carrier),
                     "generate_modulated_signal", fs * MAX_SEND_SECONDS)
        padded = _wave(_call(self.algorithms.add_silence, wave), "add_silence",
                       fs * MAX_SEND_SECONDS - GUARD_SAMPLES)
        if np.max(np.abs(padded)) > 1.25:
            raise ValueError("Your modulation and padding must produce audio with peak amplitude at most 1.25.")
        return np.concatenate((np.zeros(GUARD_SAMPLES), 0.8 * padded)).astype(np.float32)

    def _demodulate(self, array, rate, length):
        start = self.algorithms.detect_start(array, False)
        if start + _sample_count(length, rate) > array.size:
            raise DecodeError("The recording ends before the complete frame. Wait for the tone to finish before Stop.")
        return self._bits(_call(self.algorithms.demodulate, array.copy(), rate, length),
                          "demodulate", length)

    def prepare_recording(self, samples, use_filter=True, fmin=1500, fmax=2500):
        """Keep the raw capture private; only the uploaded bandpass filters it."""
        array = _samples(samples).copy()
        if not isinstance(use_filter, (bool, np.bool_)):
            raise ValueError("Choose whether to use your bandpass filter.")
        if not use_filter:
            return array
        for bound in (fmin, fmax):
            if (isinstance(bound, (bool, np.bool_)) or not isinstance(bound, numbers.Real)
                    or not np.isfinite(bound)):
                raise ValueError("Choose finite lower and upper filter frequencies.")
        if not 0 <= fmin < fmax <= fs / 2:
            raise ValueError("Choose filter bounds with 0 ≤ lower < upper ≤ 22050 Hz.")
        spectrum = np.fft.rfft(array)
        expected_shape = spectrum.shape
        result = _call(self.algorithms.bandpass, spectrum, fs, fmin, fmax)
        if result is None:
            raise DecodeError("Complete the Part 3 bandpass helper: return your filtered spectrum.")
        filtered = _returned_array(result, "bandpass")
        if (filtered.ndim != 1 or filtered.shape != expected_shape
                or filtered.dtype.kind not in "fciu" or not np.all(np.isfinite(filtered))):
            raise DecodeError("bandpass must return a finite numeric spectrum with the same 1-D shape as its input.")
        # n is essential: an odd recording otherwise reconstructs one sample short.
        with np.errstate(over="ignore", invalid="ignore"):
            restored = np.fft.irfft(filtered, n=array.size)
        if not np.all(np.isfinite(restored)):
            raise DecodeError("bandpass produced audio with nonfinite samples.")
        return restored

    def decode_bytes(self, samples, rate, use_filter=True, fmin=1500, fmax=2500):
        """Receive samples + rate + receiver settings, without sender information."""
        rate = _rate(rate)
        array = self.prepare_recording(samples, use_filter, fmin, fmax)
        header_bits = self._decode_bits(self._demodulate(array, rate, ENCODED_HEADER_BITS))
        header = np.packbits(header_bits, bitorder="big").tobytes()
        if header[:2] != PREAMBLE:
            raise DecodeError("Preamble not found. Check that both devices use the same rate and try a quieter room.")
        byte_length = int.from_bytes(header[2:4], "big")
        try:
            transmission_samples(byte_length, rate)  # bound BEFORE full-frame call
        except ValueError as error:
            raise DecodeError("Invalid length header. Check the rate or move the devices closer.") from error
        frame_bits = self._demodulate(array, rate, OVERHEAD_BITS + byte_length * 16)
        payload_bits = self._decode_bits(frame_bits[ENCODED_HEADER_BITS:])
        return np.packbits(payload_bits, bitorder="big").tobytes()

    def decode_recording(self, samples, rate, use_filter=True, fmin=1500, fmax=2500):
        payload = self.decode_bytes(samples, rate, use_filter, fmin, fmax)
        return {
            "text": payload.decode("utf-8", errors="replace"),
            "payload_bytes": list(payload),
            "payload_bits": np.unpackbits(np.frombuffer(payload, dtype=np.uint8)).tolist(),
        }


def create_codec(notebook_content):
    try:
        codec = Codec(import_notebook(notebook_content))
        # Exercise the uploaded declarations, so an unfilled trellis/decoder or
        # filter does not appear Ready. This supplies test input, never an answer.
        test_payload = b"\xa5\x00\xff"
        samples = codec.encode_bytes(test_payload, 100)
        if codec.decode_bytes(samples, 100) != test_payload:
            raise NotebookImportError("The uploaded helpers did not recover a short clean test message.")
        return codec
    except (ValueError, TypeError, NameError) as error:
        raise NotebookImportError(
            "Complete conv_encode, viterbi_cell, viterbi_decode and the Part 3 helpers "
            "in your Project 2c notebook. " + str(error)
        ) from error
