# ChessCam — third-party components and licenses

ChessCam builds on established open-source chess engines and recognition tools.

- **Fenshot** `@scoriiu/fenshot`, © SORTINO LABS S.R.L. and contributors,
  MIT license: https://github.com/scoriiu/fenshot/blob/main/LICENSE
  - Uses the pretrained 13-class chess-tile CNN `chess-tiles-v2.onnx`.
  - Uses the square-grid chessboard detector from Fenshot for optional automatic calibration.
- **ONNX Runtime Web**, Microsoft and contributors, MIT license:
  https://github.com/microsoft/onnxruntime/blob/main/LICENSE
- **Stockfish / Stockfish.js 19**, GNU GPLv3 license:
  https://github.com/nmrugg/stockfish.js
  https://github.com/official-stockfish/Stockfish
  - Both Stockfish 19 Lite and Full are included in the free static website.
  - Full is an opt-in, large (~94 MB) CPU/WASM NNUE model.
  - Stockfish source is available from the repositories linked above.
- **chess.js**, BSD-2-Clause license:
  https://github.com/jhlywa/chess.js

The generated build is intended for local, browser-side computer vision.
It does not upload camera frames to a third-party inference service.

The default chess-piece CNN is trained for 2D online boards, not a universal
physical chessboard detector. Full engine downloads are optional.
