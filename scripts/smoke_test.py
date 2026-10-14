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
    for _ in range(8):
        pg.wait_for_timeout(800)
        p1 = G(f'const p = g.world.people.find(x => x.id === {p0["id"]}); return {{x: p.x, z: p.z}};')
        if abs(p1['x'] - p0['x']) + abs(p1['z'] - p0['z']) > 1.0: break
    check('person_moved', abs(p1['x'] - p0['x']) + abs(p1['z'] - p0['z']) > 1.0)
    shot('3_moving.png')

    # 長押し（地面）でアクション一覧
    pg.mouse.move(150, 500); pg.mouse.down(); pg.wait_for_timeout(1300); pg.mouse.up()
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
    pg.mouse.move(330, 250); pg.mouse.down(); pg.wait_for_timeout(1300); pg.mouse.up(); pg.wait_for_timeout(200)
    pg.click('#pop .grid .btn >> nth=1')  # 全員をここへ
    pg.wait_for_timeout(300)
    check('all_move', G('return g.world.people.filter(x=>x.kind==="party").every(x => x.goal || x.path.length);'))

    # セーブ（スロット1）→書き出し
    pg.tap('#menuBtn'); pg.wait_for_timeout(300)
    pg.click('#tabs [data-tab="save"]'); pg.wait_for_timeout(200)
    shot('6_save.png')
    pg.click('.slot >> nth=1 >> button:text-is("保存")'); pg.wait_for_timeout(500)
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
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('.slot >> nth=2 >> button:text-is("保存")'); pg.wait_for_timeout(400)
    pg.click('.slot >> nth=2 >> text=読込'); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1200)
    check('v2_roundtrip', G('const P = g.world.people.filter(x=>x.kind==="party"); return P[2].body.legL.lost && P[2].body.legR.lost && P[0].skills && P[0].inv;'))

    # ---- Phase 3：戦闘・捕縛・担ぐ・あさる ----
    G('const w = g.world; w.debugFast = false; w.timeScale = 1; w.hour = 11; const P = w.people.filter(x=>x.kind==="party"); P.forEach(p=>{ p.state="ok"; p.blood=100; for (const b of Object.values(p.body)) { b.hp = 60; b.bleed = 0; b.lost=false; b.prosthetic=null; } }); g.debug.bandits(w, P[0]); g.rig.target.x = P[0].x + 8; g.rig.target.z = P[0].z + 3; g.rig.dist = 16; g.rig.pitch = 0.75; window.__hits = 0;')
    pg.wait_for_timeout(4000)
    shot('17_combat.png')
    check('fighting', G('return g.world.people.some(p => p.faction === "bandit" && p.fight && (p.fight.target || p.fight.act));'))
    check('retreat_button', pg.inner_text('#restBtn') == '退却')
    # 敵を1人気絶させて縛る・担ぐ・あさる
    G('const w = g.world; const P0 = w.people.find(x=>x.kind==="party"); const e = w.people.filter(p => p.faction === "bandit").sort((a,b)=>Math.hypot(a.x-P0.x,a.z-P0.z)-Math.hypot(b.x-P0.x,b.z-P0.z))[0]; e.state = "ko"; e.koTimer = 99; e.body.chest.hp = -5; const P = w.people.filter(x=>x.kind==="party"); w.people.filter(p=>p.faction==="bandit" && p!==e).forEach(b=>{ b.state="dead"; }); P[0].state="ok"; P[0].body.armL.hp=50; P[0].body.armR.hp=50; g.orderBind(w, P[0], e); window.__e = e.id; w.timeScale = 3; window.__dbg = () => JSON.stringify({task: P[0].task, st: P[0].state, d: Math.hypot(P[0].x-e.x,P[0].z-e.z), ts: w.timeScale});')
    for _ in range(20):
        pg.wait_for_timeout(1000)
        if G('return g.world.people.find(p => p.id === window.__e).bound === true;'): break
    check('bound', G('return g.world.people.find(p => p.id === window.__e).bound === true;'))
    G('const w = g.world; const e = w.people.find(p => p.id === window.__e); const P = w.people.filter(x=>x.kind==="party"); g.orderCarry(w, P[0], e);')
    for _ in range(10):
        pg.wait_for_timeout(700)
        if G('const P = g.world.people.filter(x=>x.kind==="party"); return P[0].carrying === window.__e;'): break
    check('carrying', G('const P = g.world.people.filter(x=>x.kind==="party"); return P[0].carrying === window.__e;'))
    G('g.world.timeScale = 1; const P = g.world.people.filter(x=>x.kind==="party"); g.rig.target.x = P[0].x; g.rig.target.z = P[0].z; g.rig.dist = 8; P[0].path=[{x:P[0].x+5, z:P[0].z}]; P[0].goal={x:P[0].x+5, z:P[0].z};')
    pg.wait_for_timeout(900)
    shot('18_carry.png')
    G('g.selected.clear(); const P = g.world.people.filter(x=>x.kind==="party"); g.selected.add(P[1].id); g.openPerson(window.__e, "equip");')
    pg.wait_for_timeout(400)
    shot('19_loot.png')
    before = G('const P = g.world.people.filter(x=>x.kind==="party"); return P[1].inv.length;')
    if pg.query_selector('#psub [data-act="takeEquip"]'):
        pg.click('#psub [data-act="takeEquip"] >> nth=0'); pg.wait_for_timeout(200)
    check('looted', G('const P = g.world.people.filter(x=>x.kind==="party"); return P[1].inv.length;') > before)
    pg.click('.subtabs [data-sub="equip"]')
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.openPerson(P[1].id, "inv");')
    pg.wait_for_timeout(300)
    if pg.query_selector('#psub [data-act="equip"]'):
        pg.click('#psub [data-act="equip"] >> nth=0'); pg.wait_for_timeout(200)
    G('const P = g.world.people.filter(x=>x.kind==="party"); g.openPerson(P[1].id, "equip");')
    pg.wait_for_timeout(300)
    shot('20_equip.png')
    pg.click('#closeSheet')
    # セーブ v3 の往復
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('.slot >> nth=3 >> button:text-is("保存")'); pg.wait_for_timeout(400)
    pg.click('.slot >> nth=3 >> text=読込'); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1200)
    check('v3_roundtrip', G('return g.world.people.some(p => p.bound) && g.world.people.filter(x=>x.kind==="party").every(p => p.equip);'))

    # ---- Phase 4：町・店・派閥・通行料・地図 ----
    G('const w = g.world; w.timeScale = 1; w.hour = 10; const P = w.people.filter(x=>x.kind==="party"); P.forEach((p,i)=>{ p.state="ok"; p.bound=false; p.carrying=null; p.carriedBy=null; p.x = 240 + i*1.5; p.z = -150; p.path=[]; p.goal=null; }); w.people.filter(x=>x.faction==="bandit").forEach(b=>b.state="dead"); g.rig.target.x = 240; g.rig.target.z = -165; g.rig.dist = 38; g.rig.pitch = 0.8; g.selected.clear(); g.selected.add(P[0].id);')
    pg.wait_for_timeout(2500)
    shot('21_town.png')
    check('entered_town', G('return !!(g.world.inTown && g.world.inTown.sunamachi);'))
    # 店主に話しかけて買う
    G('const w = g.world; const k = w.people.find(p => p.role === "shopkeeper" && p.town === "sunamachi" && p.shop === "general"); const P = w.people.filter(x=>x.kind==="party"); P[0].x = k.x + 1; P[0].z = k.z + 1; window.__k = k.id; g.talk(k);')
    pg.wait_for_timeout(400)
    shot('22_talk.png')
    pg.click('#dlgBtns >> text=店を見る'); pg.wait_for_timeout(400)
    shot('23_shop.png')
    money0 = G('return g.world.money;')
    pg.click('#shopList [data-i] >> nth=0'); pg.wait_for_timeout(200)
    check('bought', G('return g.world.money;') < money0)
    pg.click('#sheet [data-mode="sell"]'); pg.wait_for_timeout(200)
    money1 = G('return g.world.money;')
    if pg.query_selector('#shopList [data-sell]'):
        pg.click('#shopList [data-sell] >> nth=0'); pg.wait_for_timeout(200)
    check('sold', G('return g.world.money;') > money1)
    pg.click('#tabs [data-tab="factions"]'); pg.wait_for_timeout(200)
    shot('24_factions.png')
    pg.click('#closeSheet')
    # 賞金首の引き渡し
    G('const w = g.world; const police = w.people.find(p => p.role === "police" && p.town === "sunamachi"); const boss = w.people.find(p => p.role === "boss"); boss.state = "ko"; boss.koTimer = 99; boss.bound = true; boss.x = police.x + 2; boss.z = police.z + 1; const P = w.people.filter(x=>x.kind==="party"); P[0].x = police.x + 1; P[0].z = police.z - 1; window.__m = w.money; window.__b = boss.bounty; g.talk(police);')
    pg.wait_for_timeout(300)
    if pg.query_selector('#dlgBtns >> text=引き渡す'):
        pg.click('#dlgBtns button >> nth=0'); pg.wait_for_timeout(300)
    check('bounty', G('return g.world.money >= window.__m + window.__b;'))
    # 地図
    G('g.openMap();')
    pg.wait_for_timeout(6000)
    G('g.openMap();')
    pg.wait_for_timeout(500)
    shot('25_map.png')
    pg.click('#mapClose')
    # 通行料（祈りの泉）
    G('const w = g.world; const P = w.people.filter(x=>x.kind==="party"); P.forEach((p,i)=>{ p.x = 420 + 60 + i; p.z = 700; }); g.rig.target.x = 440; g.rig.target.z = 700;')
    pg.wait_for_timeout(800)
    G('const w = g.world; const P = w.people.filter(x=>x.kind==="party"); P.forEach((p,i)=>{ p.x = 420 + 20 + i; p.z = 700; });')
    pg.wait_for_timeout(2500)
    shot('26_toll.png')
    check('toll_dialog', pg.is_visible('#dialog') and '通行料' in pg.inner_text('#dlgMsg'))
    if pg.is_visible('#dialog'):
        pg.click('#dlgBtns button >> nth=0'); pg.wait_for_timeout(300)
    G('g.rig.target.x = 420; g.rig.target.z = 690; g.rig.dist = 45;')
    pg.wait_for_timeout(2500)
    shot('27_holy_town.png')
    # セーブ v4 の往復
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('.slot >> nth=1 >> button:text-is("保存")'); pg.wait_for_timeout(300)
    for _ in range(15):
        pg.wait_for_timeout(200)
        if pg.is_visible('#dialog'): pg.click('#dlgBtns >> text=上書き'); break
    pg.wait_for_timeout(800)
    pg.click('.slot >> nth=1 >> text=読込'); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1500)
    check('v4_roundtrip', G('return g.world.people.some(p => p.role === "shopkeeper") && g.world.discovered && g.world.discovered.sunamachi;'))

    # ---- Phase 5：拠点建築・仕事・研究 ----
    G('const w = g.world; w.timeScale = 1; w.hour = 11; w.debugFast = false; const P = w.people.filter(x=>x.kind==="party"); P.forEach((p,i)=>{ p.state="ok"; p.bound=false; p.jailUntil=0; p.x = 60 + i*1.5; p.z = -60; p.path=[]; p.goal=null; p.task=null; p.inv.push({id:"stone", qty: 20}); p.inv.push({id:"trade_cloth", qty: 4}); p.inv.push({id:"trade_iron", qty: 3}); p.jobs = {build:1, mine:2, farm:2, cook:3, craft:3, research:2}; }); g.rig.target.x = 66; g.rig.target.z = -52; g.rig.dist = 28; g.rig.pitch = 0.85; g.selected.clear(); g.selected.add(P[0].id);')
    pg.wait_for_timeout(800)
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="base"]'); pg.wait_for_timeout(300)
    shot('28_base_tab.png')
    pg.click('[data-build="storage"]'); pg.wait_for_timeout(1500)
    shot('29_build_mode.png')
    pg.click('#buildBtns >> text=確定'); pg.wait_for_timeout(400)
    check('site_placed', G('return g.ensureBase(g.world).buildings.length >= 1;'))
    pg.click('#buildBtns >> text=やめる')
    # 壁：始点→終点
    G('g.enterBuild("wall"); g.rig.target.x = 56; g.rig.target.z = -46;')
    pg.wait_for_timeout(1200)
    pg.click('#buildBtns >> text=始点')
    G('g.rig.target.x = 72; g.rig.target.z = -44;')
    pg.wait_for_timeout(1500)
    shot('30_wall_preview.png')
    pg.click('#buildBtns >> text=終点'); pg.wait_for_timeout(300)
    pg.click('#buildBtns >> text=やめる')
    check('walls_placed', G('return g.ensureBase(g.world).buildings.filter(b=>b.wallSeg).length >= 3;'))
    # ほかの建物を置いて早送り
    G('''const w = g.world; const c = {x: 66, z: -60}; for (const [t,dx,dz,r] of [["bed",4,0,0],["hut",-8,6,0],["farm",10,8,0],["research",-4,0,0],["well",4,-6,0],["cookstove",-2,-6,0]]) { for (const [ox,oz] of [[0,0],[4,0],[-4,0],[0,4],[0,-4],[8,8],[-8,-8]]) { const s = g.snapPos(t, c.x+dx+ox, c.z+dz+oz, r); if (g.placeBuilding(w, t, s.x, s.z, r).ok) break; } } g.ensureBase(w).research.current = "smelting"; w.debugFast = true; g.rig.target.x = 64; g.rig.target.z = -54; g.rig.dist = 34;''')
    for _ in range(25):
        pg.wait_for_timeout(1000)
        if G('return g.ensureBase(g.world).buildings.filter(b=>b.done).length >= 6;'): break
    G('g.world.debugFast = false;')
    pg.wait_for_timeout(1500)
    shot('31_base_built.png')
    G('window.__w5 = g.world;')
    check('built', G('return g.ensureBase(g.world).buildings.filter(b=>b.done).length >= 6;'))
    G('g.setBaseSub("jobs"); g.openSheet("base");'); pg.wait_for_timeout(300); shot('32_jobs.png')
    G('g.setBaseSub("research"); g.openSheet("base");'); pg.wait_for_timeout(300); shot('33_research.png')
    pg.click('#closeSheet')
    pg.tap('#menuBtn'); pg.click('#tabs [data-tab="save"]'); pg.click('.slot >> nth=2 >> button:text-is("保存")'); pg.wait_for_timeout(300)
    for _ in range(15):
        pg.wait_for_timeout(200)
        if pg.is_visible('#dialog'): pg.click('#dlgBtns >> text=上書き'); break
    pg.wait_for_timeout(800)
    pg.click('.slot >> nth=2 >> text=読込'); pg.click('#dlgBtns >> text=読み込む'); pg.wait_for_timeout(1500)
    check('v5_roundtrip', G('return g.ensureBase(g.world).buildings.filter(b=>b.done).length >= 6;'))
    b.close()
srv.shutdown()

print(json.dumps(checks, ensure_ascii=False))
bad = [e for e in errors if 'GPU stall' not in e and 'WebGL' not in e]
for e in bad: print('ERR', e)
sys.exit(1 if bad or not all(checks.values()) else 0)
