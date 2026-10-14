// 確認ダイアログ・テキスト入出力ダイアログ・トースト
const $ = (id) => document.getElementById(id);

// buttons: [{label, value, cls}] → 押されたボタンの value を返す
export function ask(message, buttons, text = null) {
  return new Promise((resolve) => {
    $('dlgMsg').textContent = message;
    const ta = $('dlgText');
    ta.classList.toggle('hide', text === null);
    if (text !== null) { ta.value = text.value || ''; ta.readOnly = !!text.readOnly; ta.placeholder = text.placeholder || ''; }
    const row = $('dlgBtns');
    row.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.onclick = async () => {
        if (b.copy) {
          try { await navigator.clipboard.writeText(ta.value); el.textContent = 'コピーしました'; }
          catch { ta.focus(); ta.select(); el.textContent = '選択しました。長押しでコピー'; }
          return;
        }
        $('dialog').classList.add('hide');
        resolve({ value: b.value, text: ta.value });
      };
      row.appendChild(el);
    }
    $('dialog').classList.remove('hide');
  });
}

export async function confirmBox(message, okLabel = 'はい', danger = false) {
  const r = await ask(message, [{ label: 'やめる', value: false }, { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }]);
  return r.value;
}

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
