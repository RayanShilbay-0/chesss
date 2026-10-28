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

- **CameraChessWeb LeYOLO physical pieces** (AGPL-3.0):
  https://github.com/Pbatch/CameraChessWeb
  Model mirrored at https://github.com/samegardner/chess-vision/blob/9517ce421f3896ef3e922ee2bc10f306ba32a761/models/chesscam_pieces.onnx
  The integrated physical-detection feature is subject to AGPL-3.0
  source-disclosure and redistribution obligations. Sources and updates
  remain publicly available in the ChessCam repository.
- **OpenCV.js**, OpenCV/TecStark (Apache-2.0):
  https://github.com/TechStark/opencv-js
  Sparse pyramidal Lucas–Kanade tracking and RANSAC homography.
