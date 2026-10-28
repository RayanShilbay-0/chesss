"""Python mirror of the browser LeYOLO pipeline (src/physical-vision-worker.js,
src/physical-vision.js decodeCorners, src/physical-geometry.js decodeYolo).

Used only for offline benchmarking on the user's PRIVATE footage. The dataset
path is always passed on the command line; nothing here reads or writes media
inside the repository.
"""
import numpy as np
import onnxruntime as ort

W, H = 480, 288
PIECES = 'bknpqrBKNPQR'


class LeYolo:
    def __init__(self, pieces_path, corners_path, providers=None):
        providers = providers or ['CPUExecutionProvider']
        self.pieces = ort.InferenceSession(pieces_path, providers=providers)
        self.corners = ort.InferenceSession(corners_path, providers=providers)

    @staticmethod
    def letterbox(rgb):
        """Nearest-neighbour letterbox identical to resize() in the worker."""
        h, w = rgb.shape[:2]
        scale = min(W / w, H / h)
        dw, dh = int(w * scale), int(h * scale)
        off_x, off_y = (W - dw) // 2, (H - dh) // 2
        xs = np.minimum(w - 1, ((np.arange(dw) + .5) / scale).astype(int))
        ys = np.minimum(h - 1, ((np.arange(dh) + .5) / scale).astype(int))
        canvas = np.full((H, W, 3), 114, np.uint8)
        canvas[off_y:off_y + dh, off_x:off_x + dw] = rgb[ys][:, xs]
        tensor = (canvas.astype(np.float32) / 255).transpose(2, 0, 1)[None].astype(np.float16)
        return tensor, scale, off_x, off_y

    def _run(self, session, rgb):
        tensor, scale, off_x, off_y = self.letterbox(rgb)
        out = session.run(None, {'images': tensor})[0].astype(np.float32)
        return out, scale, off_x, off_y

    def detect_pieces(self, rgb, confidence=.23, max_det=130):
        out, scale, ox, oy = self._run(self.pieces, rgb)
        raw = out[0]  # [16, N]
        cls = raw[4:16]
        best = cls.max(0)
        ids = cls.argmax(0)
        keep = np.where(best >= confidence)[0]
        dets = []
        for i in keep:
            cx, cy, w, h = raw[0:4, i]
            if w < 2 or h < 2:
                continue
            dets.append(dict(cx=float((cx - ox) / scale), cy=float((cy - oy) / scale),
                             w=float(w / scale), h=float(h / scale),
                             cls=PIECES[ids[i]], conf=float(best[i])))
        dets.sort(key=lambda d: -d['conf'])
        return dets[:max_det]

    def detect_xcorners(self, rgb, confidence=.35):
        out, scale, ox, oy = self._run(self.corners, rgb)
        raw = out[0]
        h, w = rgb.shape[:2]
        pts = []
        order = np.argsort(-raw[4])
        for i in order:
            c = raw[4, i]
            if c < confidence:
                break
            x, y = (raw[0, i] - ox) / scale, (raw[1, i] - oy) / scale
            if x < -20 or x > w + 20 or y < -20 or y > h + 20:
                continue
            if any(np.hypot(p['x'] - x, p['y'] - y) < 8 for p in pts):
                continue
            pts.append(dict(x=float(x), y=float(y), conf=float(c)))
        return pts


def js_extreme_quad(points, width, height):
    """Port of PhysicalChessVision.decodeCorners extreme-point heuristic."""
    if len(points) < 15:
        return None
    ranked = [p for p in points if p['conf'] >= .45]
    pool = ranked if len(ranked) >= 12 else points
    tl = min(pool, key=lambda p: p['x'] + p['y'])
    tr = max(pool, key=lambda p: p['x'] - p['y'])
    br = max(pool, key=lambda p: p['x'] + p['y'])
    bl = max(pool, key=lambda p: p['y'] - p['x'])
    if len({id(tl), id(tr), id(br), id(bl)}) != 4:
        return None
    if np.hypot(tr['x'] - tl['x'], tr['y'] - tl['y']) < 70:
        return None

    def expand(p, hz, vt):
        return dict(x=p['x'] + hz[0] / 6 + vt[0] / 6, y=p['y'] + hz[1] / 6 + vt[1] / 6)

    def d(a, b):
        return (a['x'] - b['x'], a['y'] - b['y'])
    q = [expand(tl, d(tl, tr), d(tl, bl)), expand(tr, d(tr, tl), d(tr, br)),
         expand(br, d(br, bl), d(br, tr)), expand(bl, d(bl, br), d(bl, tl))]
    for p in q:
        if p['x'] < -.25 * width or p['y'] < -.25 * height or p['x'] > 1.25 * width or p['y'] > 1.25 * height:
            return None
    return q


def nms(dets, iou=.45, max_det=64):
    """Class-agnostic greedy NMS, mirrors nmsBoxes() in src/physical-geometry.js."""
    keep = []
    for d in sorted(dets, key=lambda d: -d['conf']):
        ok = True
        for k in keep:
            x0 = max(d['cx'] - d['w'] / 2, k['cx'] - k['w'] / 2)
            x1 = min(d['cx'] + d['w'] / 2, k['cx'] + k['w'] / 2)
            y0 = max(d['cy'] - d['h'] / 2, k['cy'] - k['h'] / 2)
            y1 = min(d['cy'] + d['h'] / 2, k['cy'] + k['h'] / 2)
            inter = max(0, x1 - x0) * max(0, y1 - y0)
            union = d['w'] * d['h'] + k['w'] * k['h'] - inter
            if union > 0 and inter / union > iou:
                ok = False
                break
        if ok:
            keep.append(d)
            if len(keep) >= max_det:
                break
    return keep
