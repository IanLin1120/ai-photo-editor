"""GitHub Actions 雲端工作：下載加密原檔 → 解密 → LibRaw 解碼 → SCUNet AI 降噪 → node render.js（同一份修圖引擎）→ 加密上傳結果
本機測試：python cloud/run_job.py --local 資料夾（資料夾內有 <job>.json / <job>.in，用環境變數 CLOUD_KEY）"""
import os, sys, json, time, base64, subprocess, tempfile, threading
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY = base64.b64decode(os.environ['CLOUD_KEY'].strip())
REPO, REL, JOB, TOKEN = os.environ.get('REPO'), os.environ.get('RELEASE_ID'), os.environ.get('JOB'), os.environ.get('GH_TOKEN')
LOCAL = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--local' else None
MODEL_URL = 'https://github.com/cszn/KAIR/releases/download/v1.0/scunet_color_real_psnr.pth'
CACHE = os.path.expanduser('~/.cache/aip'); os.makedirs(CACHE, exist_ok=True)

def dec(b):
    assert b[:4] == b'AIP1', '不是 AI修圖的加密檔'
    return AESGCM(KEY).decrypt(b[4:16], b[16:], None)
def enc(b):
    iv = os.urandom(12); return b'AIP1' + iv + AESGCM(KEY).encrypt(iv, b, None)

# ---------------- GitHub ----------------
import requests
S = requests.Session()
if TOKEN: S.headers.update({'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
def assets():
    return S.get(f'https://api.github.com/repos/{REPO}/releases/{REL}/assets?per_page=100').json()
def get_asset(name):
    if LOCAL: return open(os.path.join(LOCAL, name), 'rb').read()
    a = next(x for x in assets() if x['name'] == name)
    r = S.get(f'https://api.github.com/repos/{REPO}/releases/assets/{a["id"]}', headers={'Accept': 'application/octet-stream'}, allow_redirects=True)
    r.raise_for_status(); return r.content
def put_asset(name, data):
    if LOCAL: open(os.path.join(LOCAL, name), 'wb').write(data); return
    for a in assets():
        if a['name'] == name: S.delete(f'https://api.github.com/repos/{REPO}/releases/assets/{a["id"]}')
    r = S.post(f'https://uploads.github.com/repos/{REPO}/releases/{REL}/assets?name={name}', data=data, headers={'Content-Type': 'application/octet-stream'})
    r.raise_for_status()
_last = [0]
def status(msg, pct, force=False):
    print(f'[{pct*100:5.1f}%] {msg}', flush=True)
    if LOCAL or (not force and time.time() - _last[0] < 25): return
    _last[0] = time.time()
    try: put_asset(f'{JOB}.status', json.dumps({'msg': msg, 'pct': pct}, ensure_ascii=False).encode())
    except Exception as e: print('status upload failed', e)

# ---------------- 影像 ----------------
def decode(raw_bytes, is_raw):
    if is_raw:
        import rawpy
        with tempfile.NamedTemporaryFile(delete=False) as f: f.write(raw_bytes); p = f.name
        with rawpy.imread(p) as r:
            flip = r.sizes.flip          # 要在 postprocess 之前讀（之後會被 user_flip 覆蓋）
            rgb = r.postprocess(use_camera_wb=True, no_auto_bright=True, gamma=(1, 1), output_bps=16, output_color=rawpy.ColorSpace.ProPhoto,
                                highlight_mode=rawpy.HighlightMode.Blend, half_size=False, user_flip=0)
        os.unlink(p); return rgb.astype(np.float32) / 65535.0, flip
    from PIL import Image, ImageOps
    import io
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw_bytes))).convert('RGB')
    a = np.asarray(im, np.float32) / 255
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    PP2XYZ = np.array([[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.8252100]])
    XYZ50_SRGB = np.array([[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.0334540], [0.0719453, -0.2289914, 1.4052427]])
    M = np.linalg.inv(XYZ50_SRGB @ PP2XYZ)   # 線性 sRGB → 線性 ProPhoto（與 engine.js 相同常數）
    return (lin @ M.T).astype(np.float32), 0

def denoise(x, strength, prog):
    import torch
    from network_scunet import SCUNet
    mp = os.path.join(CACHE, 'scunet_color_real_psnr.pth')
    if not os.path.exists(mp):
        r = requests.get(MODEL_URL, timeout=300); r.raise_for_status(); open(mp, 'wb').write(r.content)
    torch.set_num_threads(os.cpu_count() or 4)
    m = SCUNet(in_nc=3, config=[4, 4, 4, 4, 4, 4, 4], dim=64); m.load_state_dict(torch.load(mp, map_location='cpu'), strict=True); m.eval()
    s = max(float(np.percentile(x, 99.9)), 1e-6)
    e = np.clip(x / s, 0, 1); enc_ = np.where(e <= 0.0031308, 12.92 * e, 1.055 * np.power(e, 1 / 2.4) - 0.055).astype(np.float32)
    H, W, _ = enc_.shape; T, ov = 384, 48; st = T - ov
    out = np.zeros_like(enc_); ws = np.zeros((H, W, 1), np.float32)
    win = (np.outer(np.hanning(T + 2)[1:-1], np.hanning(T + 2)[1:-1]).astype(np.float32) + 1e-3)[..., None]
    ys = list(range(0, max(H - T, 0) + 1, st)); xs = list(range(0, max(W - T, 0) + 1, st))
    if ys[-1] != max(H - T, 0): ys.append(max(H - T, 0))
    if xs[-1] != max(W - T, 0): xs.append(max(W - T, 0))
    n, tot = 0, len(ys) * len(xs)
    with torch.no_grad():
        for y in ys:
            for xx in xs:
                t = enc_[y:y + T, xx:xx + T]; h, w = t.shape[:2]
                pad = np.pad(t, ((0, T - h), (0, T - w), (0, 0)), mode='reflect')
                r = m(torch.from_numpy(pad.transpose(2, 0, 1)[None].copy())).numpy()[0].transpose(1, 2, 0)[:h, :w]
                out[y:y + h, xx:xx + w] += r * win[:h, :w]; ws[y:y + h, xx:xx + w] += win[:h, :w]; n += 1
                if n % 10 == 0: prog(n / tot)
    den = np.clip(out / ws, 0, 1)
    den = enc_ * (1 - strength) + den * strength
    lin = np.where(den <= 0.04045, den / 12.92, ((den + 0.055) / 1.055) ** 2.4).astype(np.float32) * s
    return np.where(x > s, x, lin)

def main():
    status('下載加密原檔', 0.02, True)
    spec = json.loads(dec(get_asset(f'{JOB}.json')))
    orig = dec(get_asset(f'{JOB}.in'))
    status(f'解碼 {spec["name"]}', 0.08, True)
    lin, flip = decode(orig, spec['raw'])
    if spec.get('opt', {}).get('half'):
        h, w = lin.shape[:2]; lin = lin[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2, 3).mean((1, 3))
    H, W = lin.shape[:2]
    status(f'AI 降噪 {W}×{H}', 0.12, True)
    lin = denoise(lin, float(spec.get('strength', 1)), lambda f: status(f'AI 降噪 {int(f * 100)}%', 0.12 + 0.6 * f))
    tmp = tempfile.mkdtemp(); lf, of, jf, rf = [os.path.join(tmp, n) for n in ('lin.f32', 'orig.bin', 'job.json', 'out.bin')]
    lin.astype(np.float32).tofile(lf); open(of, 'wb').write(orig)
    json.dump({'spec': spec, 'w': W, 'h': H, 'flip': int(flip)}, open(jf, 'w'))
    status('套用修圖設定（全解析度）', 0.75, True)
    p = subprocess.Popen(['node', os.path.join(HERE, 'render.js'), jf, lf, of, rf])
    while p.poll() is None:
        time.sleep(5)
        try: s = json.load(open(os.path.join(tmp, 'render.status'))); status(s['msg'], s['pct'])
        except Exception: pass
    if p.returncode: raise RuntimeError('渲染失敗')
    status('加密並上傳結果', 0.97, True)
    put_asset(f'{JOB}.out', enc(open(rf, 'rb').read()))
    print('done')

if __name__ == '__main__':
    try: main()
    except Exception as e:
        import traceback; traceback.print_exc()
        try: put_asset(f'{JOB}.err', str(e)[:300].encode())
        except Exception: pass
        sys.exit(1)
