"""スマホ画面サイズのヘッドレスChromiumで起動確認し、スクリーンショットを撮る。
使い方: python3 scripts/smoke_test.py [出力フォルダ]
"""
import http.server, socketserver, threading, sys, os, functools, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'screenshots')
os.makedirs(OUT, exist_ok=True)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
Handler.log_message = lambda *a: None
srv = socketserver.TCPServer(('127.0.0.1', 0), Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, device_scale_factor=2.75, is_mobile=True, has_touch=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    pg.wait_for_timeout(2500)
    pg.screenshot(path=os.path.join(OUT, '1_title.png'))
    pg.tap('#startBtn')
    pg.wait_for_timeout(3000)
    pg.screenshot(path=os.path.join(OUT, '2_game.png'))
    # 1本指ドラッグ相当：カメラ移動・ズームを直接操作して別アングルを確認
    pg.evaluate('() => { const g = window.__game; g.rig.dist = 18; g.rig.pitch = 0.62; g.rig.target.x = g.world.agents[0].x; g.rig.target.z = g.world.agents[0].z; }')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, '3_close.png'))
    pg.evaluate('() => { const g = window.__game; g.world.hour = 18.2; g.rig.dist = 60; g.rig.pitch = 0.6; }')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, '4_dusk.png'))
    pg.evaluate('() => { const g = window.__game; g.world.hour = 23; }')
    pg.wait_for_timeout(1200)
    pg.screenshot(path=os.path.join(OUT, '5_night.png'))
    pg.evaluate('() => { const g = window.__game; g.world.hour = 11; g.rig.target.x = 600; g.rig.target.z = -300; g.rig.dist = 90; }')
    pg.wait_for_timeout(4000)
    pg.screenshot(path=os.path.join(OUT, '6_far.png'))
    pg.tap('#menuBtn')
    pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(OUT, '7_settings.png'))
    info = pg.evaluate('() => ({ build: window.__game.BUILD, chunks: window.__game.terrain.chunks.size, agents: window.__game.world.agents.length, err: !!document.getElementById("errPanel") })')
    b.close()
srv.shutdown()

print(json.dumps(info, ensure_ascii=False))
ignore = ('GPU stall', 'swiftshader', 'WebGL', 'Automatic fallback')
bad = [e for e in errors if not any(s in e for s in ignore)]
for e in bad:
    print('ERR', e)
sys.exit(1 if bad or info['err'] else 0)
