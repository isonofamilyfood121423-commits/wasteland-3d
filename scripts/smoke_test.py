"""スマホ画面サイズのヘッドレスChromiumで起動・操作確認し、スクリーンショットを撮る。
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

errors, checks = [], {}
def check(name, ok):
    checks[name] = bool(ok)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, device_scale_factor=2.75, is_mobile=True, has_touch=True,
                        user_agent='Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    shot = lambda n: pg.screenshot(path=os.path.join(OUT, n))
    G = lambda js: pg.evaluate('() => { const g = window.__game; ' + js + ' }')

    pg.goto(f'http://127.0.0.1:{port}/index.html')
    pg.wait_for_timeout(2000)
    shot('1_title.png')
    pg.tap('#newBtn')
    pg.wait_for_timeout(1500)
    # 自動画質判定を止めて「中」で固定（ヘッドレスは遅いため）
    G('g.settings.quality = "mid"; g.settings.decidedQuality = "mid";')
    shot('2_start.png')

    # 地面タップで移動（選択中＝1人目）
    p0 = G('const p = g.world.people.find(x => x.kind === "party"); return {x: p.x, z: p.z, id: p.id};')
    # 人のいない地面を探してタップ（顔ぶれと位置は毎回ランダム）
    spot = pg.evaluate('''() => { const g = window.__game; for (const [x, y] of [[200,330],[120,300],[290,300],[200,250],[100,420],[300,430],[60,250],[330,250]]) if (!g.pick(x, y)) return [x, y]; return [200,330]; }''')
    pg.touchscreen.tap(*spot)
    pg.wait_for_timeout(300)
    moving = G(f'const p = g.world.people.find(x => x.id === {p0["id"]}); return !!p.goal || p.path.length > 0;')
    check('tap_ground_moves', moving)
    pg.wait_for_timeout(2500)
    p1 = G(f'const p = g.world.people.find(x => x.id === {p0["id"]}); return {{x: p.x, z: p.z}};')
    check('person_moved', abs(p1['x'] - p0['x']) + abs(p1['z'] - p0['z']) > 1.0)
    shot('3_moving.png')

    # 長押し（地面）でアクション一覧
    pg.mouse.move(150, 500); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up()
    pg.wait_for_timeout(200)
    check('longpress_menu', pg.is_visible('#pop'))
    shot('4_longpress.png')
    pg.click('#pop .cancel')

    # 範囲選択：画面全体を囲む
    pg.tap('#boxBtn')
    pg.mouse.move(20, 120); pg.mouse.down(); pg.mouse.move(200, 400, steps=5); pg.mouse.move(380, 720, steps=5)
    shot('5_boxselect.png')
    pg.mouse.up(); pg.wait_for_timeout(200)
    nsel = G('return g.selected.size;')
    check('box_select', nsel >= 1)

    # 全員を長距離移動（経路探索の再探索）
    G('const sp = g.world.spawn; const ids = g.world.people.filter(x=>x.kind==="party").map(x=>x.id); window.__orderFar = ids;')
    pg.tap('#allBtn')
    pg.mouse.move(330, 250); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(200)
    pg.click('#pop .grid .btn >> nth=1')  # 全員をここへ
    pg.wait_for_timeout(300)
    check('all_move', G('return g.world.people.filter(x=>x.kind==="party").every(x => x.goal || x.path.length);'))

    # セーブ（スロット1）→書き出し
    pg.tap('#menuBtn'); pg.wait_for_timeout(300)
    pg.click('#tabs [data-tab="save"]'); pg.wait_for_timeout(200)
    shot('6_save.png')
    pg.click('.slot >> nth=1 >> text=保存'); pg.wait_for_timeout(500)
    check('slot_saved', G('return !!JSON.parse(localStorage.getItem("w3d.slots") || "{}").s1;'))
    pg.click('text=書き出す'); pg.wait_for_timeout(500)
    text = pg.input_value('#dlgText')
    check('export_text', text.startswith('W3D1:') or text.startswith('W3D0:'))
    pg.click('#dlgBtns >> text=閉じる')
    pg.click('#tabs [data-tab="log"]'); pg.wait_for_timeout(200)
    shot('7_log.png')
    pg.click('#closeSheet')

    # 画面オフ相当 → 自動セーブ
    G('document.dispatchEvent(new Event("visibilitychange"));')
    pg.evaluate('() => { Object.defineProperty(document, "hidden", {configurable: true, get: () => true}); document.dispatchEvent(new Event("visibilitychange")); }')
    pg.wait_for_timeout(500)
    check('autosave', pg.evaluate('() => !!localStorage.getItem("w3d.autosave")'))

    # 再読み込み → つづきから
    pg.reload(); pg.wait_for_timeout(2000)
    check('continue_visible', pg.is_visible('#contBtn'))
    shot('8_title_continue.png')
    pg.tap('#contBtn'); pg.wait_for_timeout(1500)
    check('loaded', G('return g.world.people.filter(x=>x.kind==="party").length === 3;'))

    # テキストから読み込み
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('text=読み込む >> nth=-1')
    pg.fill('#dlgText', text); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1200)
    check('import_text', G('return g.world.people.length > 3;'))
    shot('9_after_import.png')

    # ---- Phase 2：負傷・治療・欠損・休息 ----
    pg.tap('#allBtn')
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.rig.target.x = P[0].x; g.rig.target.z = P[0].z; g.rig.dist = 9; g.rig.pitch = 0.7; P.forEach(p=>{p.path=[];p.goal=null;});')
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.debug.hurt(g.world, P[0]); g.debug.hurt(g.world, P[0]); g.debug.heavy(g.world, P[0]);')
    pg.wait_for_timeout(600)
    check('injured', G('const p = g.world.people.find(x=>x.kind==="party"); return p.state !== "ok" || Object.values(p.body).some(b=>b.bleed>0);'))
    shot('10_injured.png')
    G('const p = g.world.people.find(x=>x.kind==="party"); g.openPerson(p.id, "body");')
    pg.wait_for_timeout(400)
    shot('11_body_sheet.png')
    pg.click('.subtabs [data-sub="skills"]'); pg.wait_for_timeout(200); shot('12_skills.png')
    pg.click('.subtabs [data-sub="inv"]'); pg.wait_for_timeout(200); shot('13_inventory.png')
    pg.click('#closeSheet')
    # 治療（自動の止血＋指示による治療）を早送りで進める
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.orderTreat(g.world, [P[1].id], P[0].id); g.world.debugFast = true;')
    pg.wait_for_timeout(1200)
    shot('14_treating.png')
    pg.wait_for_timeout(2500)
    G('g.world.debugFast = false;')
    check('bleeding_stopped', G('const p = g.world.people.find(x=>x.kind==="party"); return Object.values(p.body).every(b=>b.bleed===0);'))
    # 脚を失う → 這う
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.debug.loseLeg(g.world, P[2]); g.debug.loseLeg(g.world, P[2]); P[2].body.chest.hp = 80; P[2].blood = 100; P[2].state = "ok"; Object.values(P[2].body).forEach(b=>b.bleed=0); g.rig.target.x = P[2].x; g.rig.target.z = P[2].z;')
    G('const P = g.world.people.filter(x=>x.kind==="party"); P[2].path=[{x:P[2].x+6,z:P[2].z}]; P[2].goal={x:P[2].x+6,z:P[2].z};')
    pg.wait_for_timeout(1500)
    check('crawl', G('const P = g.world.people.filter(x=>x.kind==="party"); return P[2].moveMode === "crawl";'))
    shot('15_crawl.png')
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.orderRest(g.world, [P[1].id]); g.rig.target.x = P[1].x; g.rig.target.z = P[1].z;')
    pg.wait_for_timeout(800)
    shot('16_rest.png')
    # セーブ v2 の往復
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('.slot >> nth=2 >> text=保存'); pg.wait_for_timeout(400)
    pg.click('.slot >> nth=2 >> text=読込'); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1200)
    check('v2_roundtrip', G('const P = g.world.people.filter(x=>x.kind==="party"); return P[2].body.legL.lost && P[2].body.legR.lost && P[0].skills && P[0].inv;'))
    b.close()
srv.shutdown()

print(json.dumps(checks, ensure_ascii=False))
bad = [e for e in errors if 'GPU stall' not in e and 'WebGL' not in e]
for e in bad: print('ERR', e)
sys.exit(1 if bad or not all(checks.values()) else 0)
