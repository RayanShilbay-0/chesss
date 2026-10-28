"""Decode a private video once and cache what the Node tracking benchmark needs:
grayscale frames (raw uint8, concatenated) and per-frame LeYOLO x-corner and
piece detections (NMS applied), using the same preprocessing as the browser.

usage: python -I tools/bench/dump_video.py <video> <out_dir> [--models public/models] [--step 1]
<out_dir> must be outside the repository.
"""
import argparse
import json
import os
import sys
import time

import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from leyolo_pipeline import LeYolo, nms  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('out')
    ap.add_argument('--models', default='public/models')
    ap.add_argument('--step', type=int, default=1)
    a = ap.parse_args()
    if os.path.abspath(a.out).startswith(os.path.abspath('.')):
        sys.exit('Refusing to write private frames inside the repository')
    os.makedirs(a.out, exist_ok=True)
    model = LeYolo(os.path.join(a.models, 'chesscam-physical-pieces.onnx'),
                   os.path.join(a.models, 'chesscam-physical-corners.onnx'))
    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames, k = [], 0
    with open(os.path.join(a.out, 'gray.raw'), 'wb') as raw:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if k % a.step == 0:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).tofile(raw)
                t = time.perf_counter()
                xc = model.detect_xcorners(rgb)
                t1 = time.perf_counter()
                pieces = nms(model.detect_pieces(rgb))
                t2 = time.perf_counter()
                frames.append(dict(index=k, time=k / fps, xcorners=xc,
                                   pieces=[dict(cx=d['cx'], cy=d['cy'], w=d['w'], h=d['h'],
                                                className=d['cls'], confidence=d['conf']) for d in pieces],
                                   ms_corners=(t1 - t) * 1000, ms_pieces=(t2 - t1) * 1000))
            k += 1
    json.dump(dict(width=int(cap.get(3)), height=int(cap.get(4)), fps=fps, frames=frames),
              open(os.path.join(a.out, 'detections.json'), 'w'))
    print('frames', len(frames), 'size', int(cap.get(3)), int(cap.get(4)))


if __name__ == '__main__':
    main()
