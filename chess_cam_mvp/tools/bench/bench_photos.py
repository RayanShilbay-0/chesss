"""Run the CURRENT LeYOLO piece + x-corner models on real photos and export
annotated overlays plus JSON predictions.

usage: python -I tools/bench/bench_photos.py <dataset_dir> <out_dir> [--models public/models]

<dataset_dir> must contain original_images/ and/or video_frames/. <out_dir>
must be OUTSIDE the repository: overlays contain the user's private photos.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from leyolo_pipeline import LeYolo, js_extreme_quad, nms  # noqa: E402


START = ('rnbqkbnr' 'pppppppp' + '1' * 32 + 'PPPPPPPP' 'RNBQKBNR')


def lattice_boards(items, position=None):
    """Run src/board-lattice.js (the browser implementation) through Node."""
    with tempfile.TemporaryDirectory() as tmp:
        jobs = []
        for k, (rgb, pts, feet) in enumerate(items):
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            path = os.path.join(tmp, f'{k}.raw')
            gray.tofile(path)
            jobs.append(dict(id=k, width=rgb.shape[1], height=rgb.shape[0], gray=path,
                             points=[dict(x=p['x'], y=p['y'], confidence=p['conf']) for p in pts],
                             pieces=feet, position=position))
        jp, rp = os.path.join(tmp, 'jobs.json'), os.path.join(tmp, 'res.json')
        json.dump(jobs, open(jp, 'w'))
        subprocess.run(['node', 'tools/bench/fit-board.mjs', jp, rp], check=True)
        return json.load(open(rp))


def crop_box(quad, w, h, margin=.85, upper=.85):
    xs, ys = [p['x'] for p in quad], [p['y'] for p in quad]
    ww, hh = max(1, max(xs) - min(xs)), max(1, max(ys) - min(ys))
    l = max(0, int(np.floor(min(xs) - ww * margin)))
    r = min(w, int(np.ceil(max(xs) + ww * margin)))
    t = max(0, int(np.floor(min(ys) - hh * upper)))
    b = min(h, int(np.ceil(max(ys) + hh * margin)))
    if r - l < 150 or b - t < 150:
        return 0, 0, w, h
    return l, t, r, b


def draw(img, quad, xpts, dets, homog):
    out = img.copy()
    for p in xpts:
        cv2.circle(out, (int(p['x']), int(p['y'])), 4, (0, 255, 255), -1)
    if quad is not None:
        Hinv = np.linalg.inv(homog)
        for k in range(9):
            for a, b in (((k / 8, 0), (k / 8, 1)), ((0, k / 8), (1, k / 8))):
                pa = cv2.perspectiveTransform(np.float32([[a]]), Hinv)[0, 0]
                pb = cv2.perspectiveTransform(np.float32([[b]]), Hinv)[0, 0]
                cv2.line(out, tuple(int(v) for v in pa), tuple(int(v) for v in pb),
                         (0, 220, 0) if k in (0, 8) else (0, 160, 0), 2 if k in (0, 8) else 1)
    for d in dets:
        x0, y0 = int(d['cx'] - d['w'] / 2), int(d['cy'] - d['h'] / 2)
        col = (255, 255, 255) if d['cls'].isupper() else (40, 40, 40)
        cv2.rectangle(out, (x0, y0), (int(x0 + d['w']), int(y0 + d['h'])), col, 2)
        cv2.putText(out, f"{d['cls']}{int(d['conf'] * 100)}", (x0, y0 - 3), 0, .5, (0, 0, 255), 2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dataset')
    ap.add_argument('out')
    ap.add_argument('--models', default='public/models')
    ap.add_argument('--subdir', default='original_images')
    ap.add_argument('--board', choices=['legacy', 'lattice'], default='legacy')
    ap.add_argument('--nms', action='store_true', help='apply class-agnostic NMS to piece boxes')
    ap.add_argument('--game-prior', choices=['none', 'start'], default='none',
                    help='verified game position known to the app at acquisition time')
    a = ap.parse_args()
    repo = os.path.abspath('.')
    if os.path.abspath(a.out).startswith(repo):
        sys.exit('Refusing to write private overlays inside the repository')
    os.makedirs(a.out, exist_ok=True)
    model = LeYolo(os.path.join(a.models, 'chesscam-physical-pieces.onnx'),
                   os.path.join(a.models, 'chesscam-physical-corners.onnx'))
    files = sorted(glob.glob(os.path.join(a.dataset, a.subdir, '*.jpg')))
    report = []
    loaded = []
    for f in files:
        bgr = cv2.imread(f)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        loaded.append((f, bgr, rgb, model.detect_xcorners(rgb)))
    def feet(rgb):
        return [dict(cx=d['cx'], cy=d['cy'], w=d['w'], h=d['h'], confidence=d['conf'], className=d['cls'])
                for d in nms(model.detect_pieces(rgb)) if d['conf'] >= .4]
    boards = lattice_boards([(rgb, x, feet(rgb)) for _, _, rgb, x in loaded],
                            START if a.game_prior == 'start' else None) if a.board == 'lattice' else None
    for k, (f, bgr, rgb, xpts) in enumerate(loaded):
        h, w = rgb.shape[:2]
        board_quality = None
        if boards is not None:
            res = boards[k]
            quad = [dict(x=p['x'], y=p['y']) for p in res['corners']] if res['ok'] else None
            board_quality = res.get('quality') or {'reason': res.get('reason')}
        else:
            quad = js_extreme_quad(xpts, w, h)
        homog = None
        if quad is not None:
            homog = cv2.getPerspectiveTransform(
                np.float32([[p['x'], p['y']] for p in quad]),
                np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]))
            l, t, r, b = crop_box(quad, w, h)
        else:
            l, t, r, b = 0, 0, w, h
        dets = model.detect_pieces(rgb[t:b, l:r])
        if a.nms:
            dets = nms(dets)
        for d in dets:
            d['cx'] += l
            d['cy'] += t
        full = model.detect_pieces(rgb)
        if a.nms:
            full = nms(full)
        squares = {}
        if homog is not None:
            for d in dets:
                if d['conf'] < .26:
                    continue
                foot = np.float32([[[d['cx'], d['cy'] + d['h'] * .5 - d['w'] / 3]]])
                u, v = cv2.perspectiveTransform(foot, homog)[0, 0]
                if -.04 <= u <= 1.04 and -.04 <= v <= 1.04:
                    tile = (min(7, max(0, int(v * 8))), min(7, max(0, int(u * 8))))
                    key = f'{tile[0]},{tile[1]}'
                    if key not in squares or squares[key]['conf'] < d['conf']:
                        squares[key] = dict(cls=d['cls'], conf=round(d['conf'], 3))
        name = os.path.splitext(os.path.basename(f))[0]
        cv2.imwrite(os.path.join(a.out, name + '_overlay.jpg'), draw(bgr, quad, xpts, dets, homog),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])
        strong = [d for d in dets if d['conf'] >= .44]
        row = dict(file=os.path.relpath(f, a.dataset).replace(os.sep, '/'), width=w, height=h,
                   xcorners=len(xpts), quad_found=quad is not None, board_quality=board_quality,
                   quad=[[round(p['x'], 1), round(p['y'], 1)] for p in quad] if quad else None,
                   crop=[l, t, r, b], detections=len(dets), strong_detections=len(strong),
                   full_frame_detections=len(full),
                   classes=dict(Counter(d['cls'] for d in strong)),
                   white=sum(d['cls'].isupper() for d in strong),
                   black=sum(d['cls'].islower() for d in strong),
                   mapped_squares=len(squares), squares=squares,
                   pieces=[{k: (round(v, 1) if isinstance(v, float) else v) for k, v in d.items()} for d in dets])
        report.append(row)
        print(f"{name}: xcorners={len(xpts)} quad={quad is not None} dets={len(dets)} "
              f"strong={len(strong)} W={row['white']} B={row['black']} mapped={len(squares)} "
              f"full_frame={len(full)}")
    with open(os.path.join(a.out, 'predictions.json'), 'w') as fp:
        json.dump(report, fp, indent=1)


if __name__ == '__main__':
    main()
