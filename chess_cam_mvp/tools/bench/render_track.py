"""Render tracked (green) and reference (red) board grids onto video frames.
usage: python -I tools/bench/render_track.py <video> <track.json> <out.jpg> <frame,frame,...>"""
import json
import sys

import cv2
import numpy as np

video, track, out, ids = sys.argv[1], sys.argv[2], sys.argv[3], [int(x) for x in sys.argv[4].split(',')]
d = json.load(open(track))
rows = {r['i']: r for r in d['rows']}
rows[d['report']['video']['acquired_at']] = dict(H=d['report']['video']['acquireH'], refH=None)


def grid(img, H, col):
    H = np.array(H).reshape(3, 3)
    for k in range(9):
        for a, b in (((k / 8, 0), (k / 8, 1)), ((0, k / 8), (1, k / 8))):
            p = H @ [a[0], a[1], 1]
            q = H @ [b[0], b[1], 1]
            if p[2] <= 0 or q[2] <= 0:
                continue
            cv2.line(img, (int(p[0] / p[2]), int(p[1] / p[2])), (int(q[0] / q[2]), int(q[1] / q[2])), col,
                     3 if k in (0, 8) else 1)
    p = H @ [1 / 16, 15 / 16, 1]  # mark board square (0,7) corner cell
    cv2.circle(img, (int(p[0] / p[2]), int(p[1] / p[2])), 7, col, -1)


cap = cv2.VideoCapture(video)
tiles = []
for i in ids:
    cap.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, img = cap.read()
    r = rows.get(i, {})
    if r.get('refH'):
        grid(img, r['refH'], (0, 0, 255))
    if r.get('H'):
        grid(img, r['H'], (0, 255, 0))
    cv2.putText(img, str(i), (10, 40), 0, 1.2, (255, 0, 255), 3)
    tiles.append(cv2.resize(img, (232, 424)))
cv2.imwrite(out, np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 75])
