import os, sys, time, json, traceback, subprocess
import numpy as np
from PIL import Image
log = {'nproc': os.cpu_count()}
try: log['mem'] = open('/proc/meminfo').read().split('\n')[0]
except Exception: pass
def save(): json.dump(log, open('out/log.json', 'w'), indent=1, ensure_ascii=False)
os.makedirs('out', exist_ok=True)
img = Image.open('scene.jpg').convert('RGB'); mask = Image.open('mask.png').convert('L').resize(img.size)
# ---------- OmniEraser（Hugging Face Space，免費 GPU）----------
if 'omni' in sys.argv:
    try:
        from gradio_client import Client, handle_file
        t = time.time(); c = Client('iosca/Omnieraser'); log['omni_api'] = str(c.view_api(return_format='dict'))[:3000]
        r = c.predict(handle_file('scene.jpg'), handle_file('mask.png'), 28, 1234, 3.5, 'There is nothing here.', api_name='/infer')
        log['omni_t'] = time.time() - t; log['omni_r'] = str(r)[:2000]
        p = r[0][0]['image'] if isinstance(r, (list, tuple)) and isinstance(r[0], list) else None
        if p: Image.open(p).save('out/omni.jpg', quality=92)
    except Exception as e: log['omni_err'] = traceback.format_exc()[-3000:]
    save()
# ---------- ObjectClear（CPU）----------
if 'oc' in sys.argv:
    try:
        from huggingface_hub import hf_hub_download
        for f in ['pipeline_objectclear.py', 'model.py', 'utils.py']: 
            p = hf_hub_download('jixin0101/ObjectClear', f, repo_type='space', local_dir='oc')
        sys.path.insert(0, 'oc'); import torch
        torch.set_num_threads(os.cpu_count())
        from pipeline_objectclear import ObjectClearPipeline
        t = time.time()
        pipe = ObjectClearPipeline.from_pretrained_with_custom_modules('jixin0101/ObjectClear', torch_dtype=torch.float32, variant='fp16', apply_attention_guided_fusion=True)
        log['oc_load'] = time.time() - t; save()
        W, H = img.size; s = 512 / min(W, H); w, h = int(W * s) // 8 * 8, int(H * s) // 8 * 8
        im = img.resize((w, h), Image.BICUBIC); mk = mask.resize((w, h), Image.NEAREST).convert('RGB')
        for steps, gs in [(20, 2.5), (10, 2.5)]:
            t = time.time()
            r = pipe(prompt='remove the instance of object', image=im, mask_image=mk, generator=torch.Generator().manual_seed(300000), num_inference_steps=steps, guidance_scale=gs, height=h, width=w)
            log[f'oc_{steps}'] = time.time() - t; r.images[0].save(f'out/oc_{steps}.jpg', quality=92); save()
    except Exception as e: log['oc_err'] = traceback.format_exc()[-4000:]
    save()
