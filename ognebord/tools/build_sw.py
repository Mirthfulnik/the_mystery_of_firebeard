# Собирает sw.js: список файлов игры для офлайн-кэша и версия по их содержимому.
# Запуск после изменений в игре: python3 tools/build_sw.py
import hashlib, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE = ['index.html', 'play.html', 'gm.html', 'manifest.webmanifest', 'audio/files.json']
DIRS = ['css', 'js', 'vendor', 'fonts', 'img', 'icons', 'audio']
files = set(INCLUDE)
for d in DIRS:
    for base, _, names in os.walk(os.path.join(ROOT, d)):
        for n in names:
            if n.startswith('.'):
                continue
            files.add(os.path.relpath(os.path.join(base, n), ROOT).replace(os.sep, '/'))
files = sorted(f for f in files if os.path.exists(os.path.join(ROOT, f)))
h = hashlib.sha1()
for f in files:
    h.update(f.encode()); h.update(open(os.path.join(ROOT, f), 'rb').read())
tpl = open(os.path.join(ROOT, 'tools', 'sw.template.js'), encoding='utf-8').read()
out = tpl.replace('__VERSION__', h.hexdigest()[:10]).replace('__FILES__', json.dumps(['./'] + files, ensure_ascii=False, indent=1))
open(os.path.join(ROOT, 'sw.js'), 'w', encoding='utf-8').write(out)
print(len(files), 'files, version', h.hexdigest()[:10])
