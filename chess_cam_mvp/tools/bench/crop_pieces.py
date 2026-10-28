"""Piece detections on board crops (as the app does in recognize()), using the
tracked board pose from track-video.mjs. Writes JSON next to the track file.
usage: python -I tools/bench/crop_pieces.py <video> <track.json> <out.json> [--every 5]"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from leyolo_pipeline import LeYolo, nms  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('track'); ap.add_argument('out')
ap.add_argument('--every', type=int, default=5)
ap.add_argument('--models', default='public/models')
a = ap.parse_args()
model = LeYolo(os.path.join(a.models, 'chesscam-physical-pieces.onnx'),
               os.path.join(a.models, 'chesscam-physical-corners.onnx'))
rows = {r['i']: r for r in json.load(open(a.track))['rows']}
cap = cv2.VideoCapture(a.video)
out, i = [], -1
while True:
    ok, bgr = cap.read()
    i += 1
    if not ok:
        break
    r = rows.get(i)
    if i % a.every or not r or not r.get('H'):
        continue
    H = np.array(r['H']).reshape(3, 3)
    q = [H @ [u, v, 1] for u, v in ((0, 0), (1, 0), (1, 1), (0, 1))]
    xs = [p[0] / p[2] for p in q]; ys = [p[1] / p[2] for p in q]
    h, w = bgr.shape[:2]
    ww, hh = max(xs) - min(xs), max(ys) - min(ys)
    # cropPhysicalBoard defaults: margin .24, upper .42
    l = max(0, int(min(xs) - ww * .24)); rr = min(w, int(max(xs) + ww * .24))
    t = max(0, int(min(ys) - hh * .42)); b = min(h, int(max(ys) + hh * .24))
    if rr - l < 150 or b - t < 150:
        l, t, rr, b = 0, 0, w, h
    rgb = cv2.cvtColor(bgr[t:b, l:rr], cv2.COLOR_BGR2RGB)
    dets = nms(model.detect_pieces(rgb, confidence=.23))
    out.append(dict(i=i, H=r['H'], width=w, height=h,
                    pieces=[dict(cx=d['cx'] + l, cy=d['cy'] + t, w=d['w'], h=d['h'], className=d['cls'],
                                 confidence=d['conf']) for d in dets]))
json.dump(out, open(a.out, 'w'))
print('frames', len(out))
