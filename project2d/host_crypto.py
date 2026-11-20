"""Byte/JSON boundary around the selected notebook's original declarations.

This host supplies validation and presentation, never encryption algorithms.
Notebook declarations execute with Python privileges inside a dedicated worker;
the declaration importer and worker are not a security sandbox.
"""
import hashlib
import json
import secrets
from notebook_importer import import_notebook, NotebookImportError

MAX_BYTES = 4096


def _packet(packet, expected_length=None):
    if not isinstance(packet, dict) or set(packet) != {'nonce', 'ciphertext'}:
        raise ValueError("Packet must contain exactly nonce and ciphertext.")
    if not all(isinstance(packet[key], bytes) for key in packet):
        raise ValueError("Notebook packet values must be bytes.")
    if len(packet['nonce']) != 16:
        raise ValueError("Packet nonce must contain exactly 16 bytes.")
    if len(packet['ciphertext']) > MAX_BYTES:
        raise ValueError(f"Packet is limited to {MAX_BYTES} ciphertext bytes.")
    if expected_length is not None and len(packet['ciphertext']) != expected_length:
        raise ValueError("Ciphertext length must match the message's UTF-8 byte length.")
    return packet


def _public(packet):
    return {key: packet[key].hex() for key in ('nonce', 'ciphertext')}


def _parse_packet(content):
    if not isinstance(content, str) or len(content) > 2 * MAX_BYTES + 1024:
        raise ValueError("Paste a public packet JSON object (up to 4096 ciphertext bytes).")
    try:
        # Reject duplicate fields rather than silently selecting one.
        def fields(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError(f"Duplicate packet field: {key}.")
                value[key] = item
            return value
        packet = json.loads(content, object_pairs_hook=fields)
        if not isinstance(packet, dict) or set(packet) != {'nonce', 'ciphertext'}:
            raise ValueError("Packet must contain exactly nonce and ciphertext.")
        for key, value in packet.items():
            if not isinstance(value, str) or len(value) % 2 or any(char not in '0123456789abcdefABCDEF' for char in value):
                raise ValueError(f"Packet {key} must be an even-length hexadecimal string.")
        return _packet({key: bytes.fromhex(value) for key, value in packet.items()})
    except (ValueError, TypeError) as error:
        raise ValueError(f"Invalid public packet: {error}") from error


def _recovered(value, expected_length):
    if not isinstance(value, bytes) or len(value) != expected_length:
        raise ValueError("Notebook decrypt must return bytes matching the ciphertext length.")
    try:
        text = value.decode('utf-8')
    except UnicodeDecodeError:
        text = None
    return {'hex': value.hex(), 'text': text, 'byte_length': len(value)}


def crypto_check():
    """Exercise the browser runtime's exact required stdlib primitives."""
    nonce = bytes(range(16))
    key = hashlib.pbkdf2_hmac('sha256', b'Project 2d browser check', nonce, 100_000, dklen=32)
    stream = hashlib.shake_256(key).digest(32)
    if len(secrets.token_bytes(16)) != 16:
        raise RuntimeError('Secure random nonce generation is unavailable.')
    return {'pbkdf2_sha256_shake256_hex': stream.hex(), 'secure_nonce_bytes': 16}


class NotebookCrypto:
    def __init__(self, content):
        self.module = import_notebook(content)
        try:
            if self.module.xor_bytes(b'\x00\xff', b'\xff\x0f') != b'\xff\xf0':
                raise ValueError('xor_bytes returned incorrect bytes.')
            if self.module.xor_bytes(b'', b'') != b'':
                raise ValueError('xor_bytes must accept empty inputs.')
            try:
                self.module.xor_bytes(b'ab', b'a')
            except ValueError:
                pass
            else:
                raise ValueError('xor_bytes must reject unequal lengths with ValueError.')
            stream = self.module.keystream('Project 2d browser check', bytes(range(16)), 32)
            if not isinstance(stream, bytes) or len(stream) != 32:
                raise ValueError('keystream must return the requested number of bytes.')
            for text in ('', 'Notebook ready: Café 🌲'):
                packet = _packet(self.module.encrypt(text, 'local notebook check'), len(text.encode('utf-8')))
                recovered = self.module.decrypt(packet, 'local notebook check')
                if not isinstance(recovered, bytes) or recovered != text.encode('utf-8'):
                    raise ValueError('encrypt/decrypt did not recover the exact UTF-8 bytes.')
        except NotImplementedError as error:
            raise NotebookImportError('Notebook is incomplete. Finish xor_bytes, encrypt and decrypt, save the notebook, then choose it again.') from error
        except Exception as error:
            raise NotebookImportError(f'Notebook readiness check failed: {error}') from error
        self.check = crypto_check()
        if stream.hex() != self.check['pbkdf2_sha256_shake256_hex']:
            raise NotebookImportError('Notebook keystream does not match the supplied PBKDF2-HMAC-SHA256 + SHAKE256 helper.')

    def source_info(self):
        return {'functions': list(self.module.__declarations__), 'crypto_check': self.check}

    def encrypt_message(self, message, password):
        if not isinstance(message, str) or not isinstance(password, str):
            raise ValueError('Message and password must be strings.')
        if len(message.encode('utf-8')) > MAX_BYTES:
            raise ValueError(f'Message is limited to {MAX_BYTES} UTF-8 bytes.')
        return _public(_packet(self.module.encrypt(message, password), len(message.encode('utf-8'))))

    def decrypt_packet(self, content, password):
        if not isinstance(password, str):
            raise ValueError('Password must be a string.')
        packet = _parse_packet(content)
        return _recovered(self.module.decrypt(packet, password), len(packet['ciphertext']))

    def flip_bit(self, content, password, byte_index, bit_index):
        packet = _parse_packet(content)
        if type(byte_index) is not int or not 0 <= byte_index < len(packet['ciphertext']):
            raise ValueError('Choose a byte index within a non-empty ciphertext (first byte is 0).')
        if type(bit_index) is not int or not 0 <= bit_index <= 7:
            raise ValueError('Choose a bit index from 0 (least significant) to 7.')
        changed = bytearray(packet['ciphertext'])
        changed[byte_index] ^= 1 << bit_index
        damaged = dict(packet, ciphertext=bytes(changed))
        original = self.module.decrypt(packet, password)
        recovered = self.module.decrypt(damaged, password)
        before = _recovered(original, len(changed))
        after = _recovered(recovered, len(changed))
        return {'packet': _public(damaged), 'before': before, 'after': after,
                'changed_bits': sum(bin(a ^ b).count('1') for a, b in zip(original, recovered))}


def create_demo(content):
    return NotebookCrypto(content)
