// 実行時エラーを画面に表示し、コピーで報告できるようにする（スマホからの不具合報告用）
export function installErrorPanel(buildInfo) {
  const list = [];
  let panel = null;

  function show() {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'errPanel';
      panel.innerHTML = `
        <div class="errHead">エラーが発生しました</div>
        <pre class="errBody"></pre>
        <div class="errBtns">
          <button class="btn" data-a="copy">コピー</button>
          <button class="btn ghost" data-a="close">閉じる</button>
        </div>`;
      panel.addEventListener('click', async (e) => {
        const a = e.target?.dataset?.a;
        if (a === 'close') { panel.remove(); panel = null; }
        if (a === 'copy') {
          const text = report();
          try { await navigator.clipboard.writeText(text); e.target.textContent = 'コピーしました'; }
          catch { selectText(panel.querySelector('.errBody')); e.target.textContent = '長押しでコピー'; }
        }
      });
      document.body.appendChild(panel);
    }
    panel.querySelector('.errBody').textContent = report();
  }

  function report() {
    return `ビルド ${buildInfo.build} (${buildInfo.time})\n${navigator.userAgent}\n\n` +
      list.slice(-5).map((e) => e).join('\n---\n');
  }

  function add(msg) {
    list.push(msg);
    show();
  }

  window.addEventListener('error', (e) => {
    add(`${e.message}\n${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}\n${e.error?.stack || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    add(`Promise: ${e.reason?.message || e.reason}\n${e.reason?.stack || ''}`);
  });
  return { add };
}

function selectText(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = getSelection();
  s.removeAllRanges(); s.addRange(r);
}
