# ChessCam v0.13 (branch `feature/board-memory-v0.13`): audit, benchmark and changes

All numbers below come from the user's private footage: 19 photos plus the
15.2 s, 455-frame `IMG_2225.MOV`. They were measured with the tools in
`tools/bench/`, and every tool takes the dataset path as an argument. No
images, video or overlays are stored in this repository or in `dist/`.

## 1. Audit: root causes found in v0.12

| Symptom | Cause (evidence) | File |
|---|---|---|
| Only one move recognized, then nothing | In physical mode auto-accept was forced off, and a pending suggestion **stopped all scanning** (`readTrainedCamera` returned on `pendingMove`, and so did the auto-scan interval) until the user tapped Accept. | `src/main.js` |
| Wrong squares and partial calibration | The board corners came from the 4 extreme x-corner detections plus a fixed 1/6 extrapolation. On real photos the x-corner model rarely finds all 7x7 points, so the quad covered about 6x6 of the 8x8 squares (see overlays). | `src/physical-vision.js` `decodeCorners` |
| Pieces missing at random | `decodeYolo` ran no NMS. The 130-box cap filled with duplicate anchors of a few pieces, which dropped other pieces entirely. | `src/physical-geometry.js` |
| Off-by-one rank on tilted views | The piece base was a fixed `bottom - w/3`, which ignores board tilt. | `src/physical-geometry.js` |
| Tracking lost after camera motion | Frame-to-frame homographies were applied to EMA-smoothed corners, so 28% of each motion step was lost and the overlay drifted behind the phone. A pose was only valid while all four corners stayed in frame (±12%), so zoom or a partial view meant loss. Recovery required a full 7x7 grid. | `src/moving-board-tracker.js` |
| Black / rotation orientation flips | Orientation came from white-vs-black piece centroids and was re-voted every scan. Low-evidence scans flipped it. | `src/physical-orientation.js`, `src/physical-vision.js` |
| Per-frame allocations | `CameraVision.frame()` created a new canvas on every call. | `src/vision.js` |

## 2. What changed

* **`src/board-lattice.js` + `src/homography.js`**
  * RANSAC lattice fit of the x-corners, with Gauss basis reduction. Sheared (diagonal) bases were being accepted on the real video.
  * The 8x8 window is chosen by checker contrast versus the frame, by piece support and, when available, by the **verified game position**.
  * Degenerate fits are rejected.
* **`src/board-memory.js`, the persistent board map**
  * KLT points keep their board (u,v) coordinates, are forward-backward checked, and the solve is board→image with RANSAC every frame.
  * Corners may leave the image.
  * ORB keyframes are restricted to the board and frame plane, so table background is excluded. They are used for relocalization after loss.
  * Later lattice detections **vote on whole-square shifts** of the map (progressive verification), never on resets.
  * Losing the pose never touches the game state.
* **Recognition**
  * `SquareEvidence` keeps temporal per-square evidence since the last verified FEN. Missing ≠ empty. A visibly vacated square gives weak support only.
  * `OcclusionGuard` checks the count drop against recent scans of the same view.
  * `OrientationLock` votes against the verified FEN. Weak votes cannot flip it.
  * Scanning continues while a suggestion is pending, and repeated "unchanged" readings withdraw a stale suggestion.
* **Tracking cadence**: adaptive, up to 20 Hz, capped at about 40% main-thread duty. Previously it was fixed at about 5.5 Hz.
* **Engine**
  * Lite starts directly on devices with `deviceMemory <= 2`.
  * The latency from a confirmed camera move to the first engine arrow is measured and shown. `window.chessCamMetrics` holds the samples.

## 3. Results

### Board geometry and piece mapping on the 19 photos

All photos show the starting position. The labels come from a visual review by Claude and **still need human confirmation**. Orientation is the oracle (best of 4 sides); auto-orientation is scored separately.

| Pipeline | Boards placed | Pieces mapped | Square occupied | Colour correct | Exact type |
|---|---|---|---|---|---|
| v0.12 (extreme points, no NMS) | 10 | 98 | 88.8% | 84.7% | 53.1% |
| v0.13, single photo, no game prior | 10 | 139 | 72.7% | 66.2% | 46.0% |
| v0.13 + verified game position (normal app use) | 10 | 146 | **93.2%** | **91.8%** | **74.0%** |

The v0.12 precision is flattered by the start position. Its undersized quads still put many pieces on occupied squares, and it maps a third fewer pieces. A single photo without the position prior is often truly ambiguous by one rank when the edge ranks are hidden. That is why the app now uses the verified FEN at acquisition and keeps verifying over time.

### Board tracking on the real video (orbit of about 90°, start position)

The reference is an independent per-frame lattice detection: unambiguous, at least 25 inliers. Error is in **square widths** and is symmetry-invariant, so one-square shifts count as errors.

| Tracker | Frames with a pose | Median error | p90 | p95 | Time per frame (desktop Node) |
|---|---|---|---|---|---|
| v0.12 `MovingBoardTracker` | 20 / 427 (4.7%) | 0.635 | 0.788 | 0.795 | p90 51.7 ms |
| v0.13 `BoardMemory` | 427 / 427 (100%) | **0.108** | 0.879 | 1.009 | median 14.3, p90 22.8, p95 39.8 ms |

There were 16 frames with error > 0.5 square, and every one was inspected visually. Frames 28–30 are real tracker errors, before the first verification vote corrected the acquisition offset. In the other 13 frames the tracked grid is correct and the **reference** is wrong.

Stress test on the same footage (`--perturb`):
* 20 blank frames: the pose is invalidated and relocalized from keyframes on the first frame back.
* Abrupt 2x zoom in and out: 1 lost frame each, then relocalized.
* Abrupt 90° image rotation in and out: 1 lost frame on the way in, then relocalized. The return produced 2 wrong frames before recovery.

### Move recognition replay on the real video (85 scans, no moves played)

* **0 phantom moves accepted** and 0 move readings.
* Orientation stayed locked on the correct side for all 54 scored scans.
* Occlusion guard: 3 false positives (39 with the first, position-based version).
* Square mapping through the tracked pose, over 878 detections: occupancy 99.2%, colour 90.4%, exact type 72.6%.

### Tests

* `npm run check`: 11 unit files, all pass. New: `board-lattice`, `physical-temporal` (consecutive W/B moves, camera motion with no moves, single-frame noise, missing ≠ empty).
* Chromium browser suites `test:physical-e2e`, `test:full-engine-e2e`, `test:ai-e2e` and `test:live-ai-e2e` pass. `test:physical-e2e` now includes a board-memory relocalization test.
* `test:e2e` (the legacy flow, not run in CI) fails identically on unmodified `main`, so it is not a regression.

## 4. Not verified, known limits (honest status)

* **No footage of real moves exists.** Move recognition on the physical board is validated only by unit tests and by the no-move video (0 phantoms). Auto-accept stays opt-in until real move recordings confirm recall and precision. The ≥95% precision target cannot be claimed yet.
* **No iPhone measurements.** All timings are desktop Node or Chromium. The per-frame OpenCV work runs on the main thread; moving it to a Worker is the next performance step.
* **Piece classes**: exact-type precision is about 72–74% on this wooden set (colour about 90%). The LeYOLO model was not trained on it. It needs human-checked labels before fine-tuning (see §5).
* **Hand detection** is a count-drop heuristic. MediaPipe Hand Landmarker was not integrated.
* **Candidate models** (YOLO11-seg + ByteTrack from chessnut-vision-tracker, chess-move-recognition) were **not benchmarked** in this round. Their licences and weights still need to be checked before any integration.
* Relocalization uses ORB on a repetitive checkerboard. It works on this footage, but a severe viewpoint change relative to all keyframes may need a fresh lattice acquisition. The app falls back to that automatically.
* ARKit world tracking is **not** available in Safari. This is a planar-homography system. A native Swift + Vision + ARKit companion would add 6-DoF tracking and LiDAR/plane anchoring; that is a separate project.

## 5. Next priorities

1. Record 3–5 short iPhone clips **with real moves**: captures, castling, hand occlusion, and moves by both sides. Label the move list per clip, then run `recognize-video.mjs` to measure move precision and recall.
2. Have a human confirm `labels_claude_visual.json`. Then label piece boxes on about 150 frames split by viewpoint, and fine-tune the piece model. A licence check on AGPL vs. Ultralytics weights is needed first.
3. Move `BoardMemory` into a Web Worker (OffscreenCanvas / transferable frames) and profile on the iPhone.
4. Integrate a MediaPipe Hand Landmarker and compare it with the count-drop guard on the move clips.

## Reproduce

```
python -I tools/bench/bench_photos.py <dataset> <out> --board lattice --nms --game-prior start
node tools/bench/eval-squares.mjs <out>/predictions.json <dataset>/labels_claude_visual.json --remap
python -I tools/bench/dump_video.py <dataset>/IMG_2225.MOV <video_out>
node tools/bench/track-video.mjs <video_out> [--perturb] --out track.json
python -I tools/bench/crop_pieces.py <dataset>/IMG_2225.MOV track.json crops.json
node tools/bench/recognize-video.mjs crops.json
```

All output directories must lie outside the repository. The Python tools refuse paths inside it.
