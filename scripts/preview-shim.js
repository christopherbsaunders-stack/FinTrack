// Loaded first in the online preview, before the dashboard: answers the
// dashboard's requests from the baked-in example data, and turns what the
// preview can't do (saving, downloading, printing, pop-up dialogs) into a
// short message at the bottom of the screen.
(() => {
  const NOTE = "This preview uses made-up accounts, so changes aren't saved. Install FinTrack on your computer to use your own.";
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  let box, timer;
  function toast(text) {
    if (!document.body) return;
    if (!box) {
      box = document.createElement('div');
      box.className = 'preview-toast';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { box.hidden = true; }, 6000);
  }
  window.previewToast = toast;

  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.includes('/api/')) return realFetch(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET' && url.pathname.endsWith('/api/summary')) return json(structuredClone(window.PREVIEW_SUMMARY));
    // Remembering the tour, or the report's name and notes, needs no message.
    if (url.pathname.endsWith('/api/settings') && /tourDone|reportName|reportNotes/.test(String(opts.body || ''))) return json({ ok: true });
    toast(NOTE);
    return json({ error: NOTE }, 400);
  };

  // The preview frame doesn't show alert, confirm or prompt windows.
  window.alert = (m) => toast(String(m));
  window.confirm = () => { toast(NOTE); return false; };
  window.prompt = () => { toast(NOTE); return null; };

  document.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a[href*="/api/export/"]');
    if (a) { ev.preventDefault(); toast('Spreadsheet downloads work in the installed app, not the preview.'); }
    const back = ev.target.closest?.('a[data-preview-back]');
    if (back) { ev.preventDefault(); history.length > 1 ? history.back() : (location.href = back.dataset.previewBack); }
  }, true);

  addEventListener('DOMContentLoaded', () => {
    const print = document.getElementById('printBtn');
    if (print) {
      print.hidden = true;
      const note = document.createElement('span');
      note.className = 'muted small';
      note.textContent = 'In the installed app, this prints or saves the report as a PDF.';
      print.after(note);
    }
  });
})();
