"""docs/manual.md から docs/manual.html（スマホで読める）と docs/manual.pdf を作る。
使い方: python3 scripts/manual.py
"""
import os, subprocess, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
md = ROOT / 'docs' / 'manual.md'
html_path = ROOT / 'docs' / 'manual.html'

body = subprocess.run(['pandoc', str(md), '-f', 'gfm', '-t', 'html'], capture_output=True, text=True, check=True).stdout
css = """
:root{--ink:#2b241d;--sub:#6d6154;--accent:#9c5a2c;--line:#e2d7c6;--bg:#faf6ef}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 system-ui,"Noto Sans JP","Noto Sans CJK JP",sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 18px 48px}
h1{font-size:24px;line-height:1.35;margin:0 0 4px;padding-bottom:12px;border-bottom:3px solid var(--accent)}
h1+p{color:var(--sub);font-size:14px;margin-top:8px}
h2{font-size:19px;margin:32px 0 10px;padding-left:10px;border-left:5px solid var(--accent)}
h3{font-size:16px;margin:22px 0 6px;color:var(--accent)}
table{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:15px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#efe5d6}
li{margin:4px 0}
strong{color:#7a3f1c}
@media print{body{background:#fff}main{max-width:none;padding:0}h2{break-after:avoid}table,tr{break-inside:avoid}}
"""
html = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>操作マニュアル｜砂錆の地</title>
<style>{css}</style></head><body><main>{body}</main></body></html>"""
html_path.write_text(html, encoding='utf-8')

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(html_path.as_uri())
    pg.pdf(path=str(ROOT / 'docs' / 'manual.pdf'), format='A4', print_background=True,
           margin={'top': '18mm', 'bottom': '18mm', 'left': '16mm', 'right': '16mm'},
           display_header_footer=True, header_template='<span></span>',
           footer_template='<div style="font-size:9px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>')
    b.close()
print('manual.html / manual.pdf を出力しました')
