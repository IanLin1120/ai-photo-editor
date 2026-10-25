"""組裝 AI修圖軟體：src/web/*.js → dist/AI修圖軟體.html（單一檔案）＋ GitHub Pages（dist/gh/）＋ Android assets
用法：VER=1.0.0 CODE=1 MINAPK=1 NOTES="…" python3 src/build.py"""
import json, os, shutil, re
HERE = os.path.dirname(os.path.abspath(__file__)); W = HERE + '/web/'; ROOT = os.path.dirname(HERE); SDK = os.environ.get('SDK', '/home/claude/sdk')
rd = lambda f: open(W + f, encoding='utf8').read()
VER = os.environ.get('VER') or open(HERE + '/VERSION').read().split()[0]
CODE = int(os.environ.get('CODE') or 1); MINAPK = int(os.environ.get('MINAPK') or CODE)
nacl = open(SDK + '/node_modules/tweetnacl/nacl-fast.min.js', encoding='utf8').read()
bu = open(SDK + '/node_modules/blakejs/util.js', encoding='utf8').read(); bb = open(SDK + '/node_modules/blakejs/blake2b.js', encoding='utf8').read()
blake = "window.BLAKE=(function(){var U=(function(){var module={exports:{}};" + bu + "\nreturn module.exports})();var module={exports:{}};var require=function(){return U};" + bb + "\nreturn module.exports})();"
lib = nacl + '\n' + blake + '\n' + rd('profiles.js') + '\n' + rd('engine.js') + '\n' + rd('exif.js')
app = ''.join(rd(f) + '\n' for f in ['core.js', 'library.js', 'editor.js', 'geo.js', 'export.js', 'cloud.js', 'update.js', 'settings.js'])
app = app.replace('__APP_VER__', VER)
worker = rd('profiles.js') + '\n' + rd('engine.js') + '\n' + rd('exif.js') + '\n' + rd('wk.js')
t = rd('template.html')
rep = {'/*@@GL_CSS@@*/': rd('maplibre-gl.css'), '/*@@APP_CSS@@*/': rd('app.css'), '/*@@GL_JS@@*/': rd('maplibre-gl.js'), '/*@@LIB_JS@@*/': lib, '/*@@APP_JS@@*/': app, '/*@@WORKER_JS@@*/': worker}
for k, v in rep.items(): t = t.replace(k, v.replace('</script', '<\\/script'))
D = ROOT + '/dist/'; G = D + 'gh/'; os.makedirs(G + 'lib/libraw', exist_ok=True)
open(D + 'AI修圖軟體.html', 'w', encoding='utf8').write(t)
open(G + 'index.html', 'w', encoding='utf8').write(t)
for f in ['index.js', 'worker.js', 'libraw.js', 'libraw.wasm']: shutil.copy(SDK + '/node_modules/libraw-wasm/dist/' + f, G + 'lib/libraw/' + f)
json.dump({'app': VER, 'apk': CODE, 'apkName': VER, 'minApk': MINAPK, 'notes': os.environ.get('NOTES', '')}, open(G + 'version.json', 'w', encoding='utf8'), ensure_ascii=False)
# Android assets
A = HERE + '/android/assets/'; shutil.rmtree(A, ignore_errors=True); os.makedirs(A + 'lib/libraw', exist_ok=True)
shutil.copy(G + 'index.html', A + 'index.html')
for f in ['index.js', 'worker.js', 'libraw.js', 'libraw.wasm']: shutil.copy(G + 'lib/libraw/' + f, A + 'lib/libraw/' + f)
print(VER, len(t))
