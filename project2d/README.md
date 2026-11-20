# Project 2d audio demo

Open [Project 2d encrypted audio demo](https://engr-76.github.io/project2d/) in a browser on each device. No terminal, local server or downloaded demo folder is needed. The page runs your own notebook functions; it contains no student answers, default completed notebook or fallback implementation of the assigned algorithms.

## Use

On each device, choose your completed Project 2d notebook and your completed Project 2c notebook. The latter must include convolutional encoding, the completed trellis, Viterbi decoding and the Part 3 signal helpers, including the bandpass filter. Transfer both notebook files to the other device using AirDrop or your usual file-transfer method. The step-by-step guide is linked from the demo.

Wait for Ready, enter the same demonstration password independently on each device and use the same transmission rate. Start with 100 bits/s and the default 2000 Hz carrier / 1500-2500 Hz receiver bandpass. The receiver presses Receive first, allows microphone access and waits for listening. The sender then presses Send. When the entire tone has ended, the receiver presses Stop & decode. Compare the recovered message with the original. Cancel releases audio resources; Retry restarts the workers after a cancelled Python operation.

Trying the live audio demo and providing feedback in the reflection survey are required. If a technical problem prevents completion, describe what you tried and what went wrong; a successful transmission is not required.

The optional experiment panel decrypts the last local packet using a chosen password, or changes one ciphertext bit and compares the recovered bytes. It does not transmit a tone or mutate the original stored packet. No packet JSON copy/paste is needed for the audio flow. Optional Diffie-Hellman remains a separate notebook exercise.

## Contracts and boundaries

- `crypto-runtime.js` / `crypto-worker.js` load the uploaded 2d declarations in
  a dedicated Pyodide 0.29.5 worker with the bundled `hashlib` package. This
  version provides PBKDF2-HMAC-SHA256 and SHAKE256 required by the notebook.
- `runtime.js` / `runtime-worker.js` load the uploaded 2c declarations in a
  separate Pyodide 314.0.7 worker with NumPy and SciPy. The independent versions
  do not share modules or Python state.
- `host_crypto.py` calls the uploaded `encrypt(message, password)` and
  `decrypt(packet, password)`. The Python packet is exactly
  `{'nonce': bytes(16), 'ciphertext': bytes}`. The JavaScript bridge represents
  those fields as hex; `packet.js` converts them to/from the audio bytes.
- Wire bytes are exactly **16-byte nonce followed by ciphertext**. Neither the
  password nor plaintext is passed to the acoustic worker. The receiver starts
  from captured audio, rate and local filter settings; it gets no sender text,
  nonce, message length or packet out of band.
- The acoustic wrapper supplies framing, bounds and typed-array conversion.
  It calls the uploaded `conv_encode`, `viterbi_decode`,
  `generate_modulated_signal`, `add_silence`, `detect_start`, `demodulate` and
  `bandpass` declarations, with the uploaded `viterbi_cell` dependency.
  The 2c frame uses a preamble and length header plus independently terminated
  header/payload convolutional blocks. There is no CRC/checksum or authentication
  tag, and residual channel errors may produce altered packet bytes.
- `audio.js` uses Web Audio for playback and an AudioWorklet for microphone
  capture. Input is never monitored aloud. Actual hardware sample rates are
  handled by browser playback resampling and explicit receive resampling to
  44.1 kHz. Sending is bounded to 15 seconds; capturing to 20 seconds.
- At 50 / 100 / 200 bits/s, total packet budgets are 38 / 82 / 169 bytes. After
  the 16-byte nonce, messages may use **22 / 66 / 153 UTF-8 bytes**. Empty messages
  are valid; multibyte characters count by encoded byte length.
- The declaration importers execute the uploaded function bodies and necessary
  imports/literal constants, skipping unrelated notebook experiments. They reject
  ambiguous declarations, unsupported dynamic dependencies and incomplete
  required functions. They are not a security sandbox. Load only trusted local
  notebooks. No uploaded code or message is intentionally sent to a server.

Recovered plaintext is displayed as exact UTF-8 when valid, otherwise as an
explicit non-UTF-8 result with hexadecimal bytes. This construction has no
password or authenticity check. Readable output is not proof of either.

## Static package scope

The static assets contain no solution notebooks, tests, fixtures or review records. Local loopback checks do not establish successful acoustic reception between physical devices.
