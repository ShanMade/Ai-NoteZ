async function openWikiLink(title) {
      const target = noteByTitle(title);
      if (target) return openNote(target.id);
      if (await uiConfirm({ title: `No note called “${title}”`, message: 'Create a new note with this title and link to it?', confirmLabel: 'Create note' })) {
        openEditor(); setTimeout(() => { const input = $('#note-title-input'); if (input) input.value = title; }, 60);
      }
    }
    $('#viewer-content').addEventListener('click', event => {
      const link = event.target.closest('a.nz-wiki');
      if (!link) return;
      event.preventDefault();
      openWikiLink(link.dataset.wiki);
    });
    function printableNote(note) {
      const body = markdownToHtml(note.body || '');
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(note.title)}</title><style>
        body { font: 12.5pt/1.6 Georgia, 'Noto Naskh Arabic', serif; color: #111; margin: 0; padding: 24px 32px; }
        h1 { font-size: 22pt; margin: 0 0 4pt; } .meta { font: 9pt system-ui, sans-serif; color: #555; margin-bottom: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 8pt; }
        h2 { font-size: 15pt; margin: 14pt 0 4pt; } h3 { font-size: 13pt; } pre, code { font-family: ui-monospace, monospace; font-size: 10pt; }
        pre { background: #f4f4f4; padding: 8pt; white-space: pre-wrap; } blockquote { border-left: 3px solid #bbb; margin: 8pt 0; padding-left: 10pt; color: #333; }
        table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 3pt 6pt; } a { color: #111; text-decoration: none; }
        @page { margin: 18mm; }
      </style></head><body><h1>${esc(note.title)}</h1><div class="meta">${esc(note.folderPath || 'General')} · ${new Date(note.updatedAt).toLocaleDateString()}${(note.tags || []).length ? ' · ' + esc(note.tags.join(', ')) : ''}</div>${body || '<p><em>This note has no readable text. Open the original file to view it.</em></p>'}</body></html>`;
    }
    function printNote(note) {
      if (!note) return;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      frame.srcdoc = printableNote(note);
      frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (error) { toast('Your browser blocked printing. Try Export as JSON instead.', 'error'); } setTimeout(() => frame.remove(), 1500); };
    }

    // ================= Quick capture + weekly digest =================
    async function quickCaptureFromClipboard() {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { text = ''; }
      text = String(text || '').replace(/\r/g, '').trim();
      if (!text) { toast('Nothing to paste. Copy some text first, or allow clipboard access.', 'error', 5200); return; }
      const firstLine = text.split('\n').find(line => line.trim()) || 'Captured note';
      const stamp = Date.now();
      const created = normalizeNote({ id: uid(), title: firstLine.replace(/^#+\s*/, '').slice(0, 80) || 'Captured note', subject: 'Captured', folderPath: currentFolderPath || 'Captured', tags: ['captured'], kind: 'markdown', body: text.slice(0, 120000), createdAt: stamp, updatedAt: stamp, lastViewedAt: stamp });
      notes = [created, ...notes]; addFolderPath(created.folderPath);
      persistNote(created).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything(); openNote(created.id); toast('Captured as a new note.');
    }
    $('#top-new-note')?.addEventListener('contextmenu', event => { event.preventDefault(); quickCaptureFromClipboard(); });
    document.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && String(event.key).toLowerCase() === 'n' && currentSession) { event.preventDefault(); quickCaptureFromClipboard(); }
    });

    function weekDigest() {
      const weekAgo = Date.now() - 7 * 864e5, list = Array.isArray(notes) ? notes : [];
      const added = list.filter(note => (note.createdAt || 0) >= weekAgo).length;
      const reviewed = list.reduce((sum, note) => sum + ((note.lastReviewedAt || 0) >= weekAgo ? 1 : 0), 0);
      const covered = list.filter(note => progressOf(note) >= 0.9 && (progressMap[note.id]?.at || 0) >= weekAgo).length;
      let minutes = 0, activeDays = 0;
      try { const days = JSON.parse(localStorage.getItem('notez-focus-v1'))?.days || {}; Object.entries(days).forEach(([key, value]) => { if (new Date(key + 'T00:00:00').getTime() >= weekAgo - 864e5) { minutes += Number(value) || 0; if (value) activeDays++; } }); } catch {}
      return { added, reviewed, covered, minutes, activeDays };
    }
    function renderWeeklyDigest() {
      const anchor = $('.dashboard-stats'); if (!anchor) return;
      let card = $('#week-digest');
      if (!card) { card = document.createElement('section'); card.id = 'week-digest'; card.className = 'week-digest'; card.setAttribute('aria-label', 'This week'); anchor.before(card); }
      const d = weekDigest();
      const items = [[d.added, d.added === 1 ? 'note added' : 'notes added'], [d.covered, d.covered === 1 ? 'note covered' : 'notes covered'], [d.reviewed, d.reviewed === 1 ? 'review done' : 'reviews done'], [d.minutes, 'focus minutes']];
      const empty = !d.added && !d.covered && !d.reviewed && !d.minutes;
      card.innerHTML = `<div class="digest-head"><b>This week</b><span>${empty ? 'Nothing logged yet. Open a note or start a focus session to begin.' : `${d.activeDays} active day${d.activeDays === 1 ? '' : 's'}`}</span></div>${empty ? '' : `<div class="digest-grid">${items.map(([value, label]) => `<div><strong>${value}</strong><small>${label}</small></div>`).join('')}</div>`}`;
    }
    setInterval(renderWeeklyDigest, 30000);

    // ================= Settings hub (one place for every setting) =================
    const HUB_SECTIONS = [
      ['general', 'General'], ['study', 'Study'], ['privacy', 'Privacy & security'], ['data', 'Data & backup'],
      ['ai', 'NotezAi'], ['help', 'Help & diagnostics'], ['account', 'Account']
    ];
    function hubRow(title, detail, action, button = 'Open') {
      return `<div class="hub-row"><div><b>${title}</b><small>${detail}</small></div><button type="button" class="nzai-primary hub-btn" data-hub="${action}">${button}</button></div>`;
    }
    function hubSectionBody(id) {
      const cloud = currentSession?.mode === 'cloud';
      const sizes = [['0.85', '85%'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']];
      const current = (() => { try { return localStorage.getItem('notez-ui-scale') || 'auto'; } catch { return 'auto'; } })();
      if (id === 'general') return `
        <h3>Appearance</h3>
        <div class="hub-row"><div><b>Theme</b><small>Light or dark. Follows your system the first time.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="theme">${document.documentElement.dataset.theme === 'light' ? 'Switch to dark' : 'Switch to light'}</button></div>
        <div class="hub-row"><div><b>Display size</b><small>Fit more on screen or make text larger.</small></div><div class="hub-seg">${[['auto', 'Auto']].concat(sizes).map(([v, l]) => `<button type="button" data-hub-scale="${v}" aria-pressed="${String(current === v || (v === '1' && current === '1'))}">${l}</button>`).join('')}</div></div>
        <h3>Reading</h3>
        ${readingSettingsHtml()}
        <h3>Colour theme</h3>
        <div class="hub-row"><div><b>Accent colour</b><small>Changes buttons, highlights and the app logo. Saved on this device.</small></div><div class="hub-seg">${ACCENT_THEMES.map(([id, label, color]) => `<button type="button" data-hub-accent="${id}" aria-pressed="${String(currentAccent() === id)}" style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>${label}</button>`).join('')}</div></div>
        <h3>Keyboard</h3>
        ${hubRow('Keyboard shortcuts', 'See every shortcut. Press ? anywhere.', 'shortcuts')}`;
      if (id === 'study') return `
        <h3>Focus and goals</h3>
        <p class="hub-note">Use the Focus button (bottom right) to set your daily goal, exam date and timer.</p>
        ${hubRow('Focus timer', 'Pomodoro timer, daily goal, exam countdown and streak.', 'focus', 'Open')}
        ${hubRow('Weekly schedule', 'Which subject you study each day, and your off days.', 'schedule', 'Edit')}
        ${hubRow('Library insights', 'Coverage, activity and study statistics.', 'insights')}
        ${hubRow('Trash', 'Notes you deleted in the last 30 days.', 'trash')}`;
      if (id === 'privacy') return `
        <h3>Protection</h3>
        ${hubRow('App lock', 'Require a PIN to open Notez on this device.', 'lock', 'Set up')}
        ${hubRow('Account and privacy', 'Email verification, password reset and account deletion.', 'account-center')}
        <p class="hub-note">Notez stores your notes on this device, and in your account when you sign in. Nothing is shared with other people.</p>`;
      if (id === 'data') return `
        <h3>Backup</h3>
        ${hubRow('Export everything (ZIP)', 'Every note as files, in its folder structure.', 'export-all')}
        ${hubRow('Export notes (JSON)', 'A single file you can re-import.', 'export-json')}
        ${hubRow('Import Notez JSON', 'Restore from a JSON backup.', 'import-json')}
        <h3>Clean up</h3>
        ${hubRow('Find duplicate notes', 'Review notes with the same text.', 'duplicates')}
        ${hubRow('Clean up empty folders', 'Remove folders that hold no notes.', 'cleanup')}
        <h3>Storage</h3>${storageMeterHtml()}`;
      if (id === 'ai') return `
        <h3>NotezAi</h3>
        <p class="hub-note">Use your own free Gemini or Groq key. It is saved once on this device.</p>
        ${hubRow('Open NotezAi', 'Chat about your notes, quizzes, summaries.', 'ai')}
        ${hubRow('Provider, key and model', 'Change the provider, model or response style.', 'ai-settings', 'Configure')}`;
      if (id === 'help') return `
        <h3>Diagnostics</h3>
        <p class="hub-note">If something goes wrong, copy this report and send it with a description of what you did. It contains no note text.</p>
        <pre class="hub-diag" id="hub-diag">${esc(diagnosticsText())}</pre>
        <div class="hub-row"><div><b>Copy report</b><small>Copies the details above to your clipboard.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="copy-diag">Copy</button></div>`;
      return `
        <h3>Account</h3>
        <div class="hub-row"><div><b>${cloud ? 'Signed in' : 'Demo workspace'}</b><small>${cloud ? esc(currentSession.email || '') : 'Notes stay in this browser. Sign in to sync.'}</small></div></div>
        ${hubRow('Account and privacy', 'Verification, password reset, delete account.', 'account-center')}
        ${hubRow('Sign out or leave workspace', 'Return to the sign-in screen.', 'logout', 'Leave')}`;
    }
    function diagnosticsText() {
      let storage = '';
      try { storage = (JSON.parse(localStorage.getItem('notez-trash-v1-' + (currentSession?.mode === 'cloud' ? currentSession.user.uid : 'demo')) || '[]').length) + ' trashed'; } catch {}
      return [
        `Notez diagnostics · ${new Date().toISOString()}`,
        `Mode: ${currentSession ? currentSession.mode : 'signed out'}`,
        `Notes: ${Array.isArray(notes) ? notes.length : 0} · Folders: ${getAllFolderPaths().length}`,
        `Sync: ${($('#sync-label')?.textContent || '').trim() || 'n/a'} · Online: ${navigator.onLine ? 'yes' : 'no'}`,
        `Trash: ${storage || 'n/a'} · Theme: ${document.documentElement.dataset.theme || 'auto'} · Zoom: ${document.documentElement.style.zoom || '1'}`,
        `Browser: ${navigator.userAgent.slice(0, 160)}`,
        `Screen: ${innerWidth}×${innerHeight} · Language: ${navigator.language}`,
        `Service worker: ${'serviceWorker' in navigator ? 'supported' : 'not supported'} · Build: notez-v12`,
        `Recent errors (${NZ_ERRORS.length}):`,
        ...(NZ_ERRORS.length ? NZ_ERRORS.slice(0, 8).map(item => `  ${item.t.slice(11, 19)} ${item.kind}: ${item.message}`) : ['  none'])
      ].join('\n');
    }
    const HUB_ACTIONS = {
      theme: () => $('#theme-toggle')?.click(), shortcuts: () => $('#shortcuts-menu')?.click(), schedule: () => $('#schedule-menu')?.click(),
      insights: () => $('#insights-menu')?.click(), trash: () => $('#trash-menu')?.click(), lock: () => $('#lock-menu')?.click(), focus: () => setTimeout(() => window.nzToggleFocus?.(), 0),
      'account-center': () => $('#account-center-menu')?.click(), 'export-all': () => $('#export-all-menu')?.click(),
      'export-json': () => $('#export-library')?.click(), 'import-json': () => $('#import-backup')?.click(),
      duplicates: () => $('#dup-menu')?.click(), cleanup: () => $('#cleanup-folders-menu')?.click(),
      ai: () => openNotezAi(null), 'ai-settings': () => { openNotezAi(null); setTimeout(() => document.querySelector('[data-nzai="settings"]')?.click(), 60); },
      logout: () => $('#logout-button')?.click()
    };
    let hubSection = 'general';
    function showSettingsHub(section = hubSection) {
      hubSection = section;
      const dialog = showModal('settings-hub', 'Settings', `<div class="hub"><nav class="hub-nav" aria-label="Settings sections">${HUB_SECTIONS.map(([id, label]) => `<button type="button" data-hub-tab="${id}" aria-current="${id === section}">${label}</button>`).join('')}</nav><div class="hub-body" id="hub-body">${hubSectionBody(section)}</div></div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(760px,100%)';
        dialog.oninput = event => { const input = event.target.closest('[data-read]'); if (!input) return; const key = input.dataset.read; const value = Number(input.value); const next = applyReading({ [key]: value }); const preview = dialog.querySelector('#rd-preview'); if (preview) { preview.style.fontSize = next.size + 'px'; preview.style.lineHeight = String(next.lh); } };
        dialog.onclick = event => {
          const tab = event.target.closest('[data-hub-tab]')?.dataset.hubTab;
          if (tab) return showSettingsHub(tab);
          if (event.target.closest('[data-hub=read-reset]')) { applyReading({ ...READ_DEFAULTS }); return showSettingsHub(section); }
          const accent = event.target.closest('[data-hub-accent]')?.dataset.hubAccent;
          if (accent) { applyAccent(accent); return showSettingsHub(section); }
          const scale = event.target.closest('[data-hub-scale]')?.dataset.hubScale;
          if (scale) { if (scale === 'auto') { try { localStorage.removeItem('notez-ui-scale'); } catch {} applyUiScale(autoUiScale()); } else { applyUiScale(scale); try { localStorage.setItem('notez-ui-scale', scale); } catch {} } return showSettingsHub(section); }
          const act = event.target.closest('[data-hub]')?.dataset.hub;
          if (!act) return;
          if (act === 'copy-diag') { navigator.clipboard?.writeText(diagnosticsText()).then(() => toast('Diagnostics copied.'), () => toast('Your browser blocked clipboard access.', 'error')); return; }
          dialog.hidden = true;
          HUB_ACTIONS[act]?.();
        };
      });
    }
    $('#settings-hub-menu').addEventListener('click', () => { closeAccountMenu(); showSettingsHub('general'); });
    $('#record-menu').addEventListener('click', () => { closeAccountMenu(); openRecorder(); });
    const hubFix = document.createElement('style');
    hubFix.textContent = `.hub{display:grid;grid-template-columns:180px 1fr;gap:18px;min-height:340px}.hub-nav{display:flex;flex-direction:column;gap:2px;border-right:1px solid rgba(128,148,170,.22);padding-right:12px}.hub-nav button{text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;font:600 12.5px system-ui,sans-serif;opacity:.7}.hub-nav button[aria-current="true"]{background:color-mix(in srgb, var(--nz-accent) 14%, transparent);color:var(--nz-accent);opacity:1}.hub-body h3{font:700 10.5px system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;opacity:.55;margin:4px 0 8px}.hub-body h3:not(:first-child){margin-top:18px}.hub-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(128,148,170,.16)}.hub-row b{display:block;font-size:13px}.hub-row small,.hub-note{font-size:11.5px;opacity:.7;display:block;margin-top:2px}.hub-note{margin:0 0 8px}.hub-btn{white-space:nowrap}.hub-seg{display:flex;gap:4px;flex-wrap:wrap}.hub-seg button{border:1px solid rgba(128,148,170,.35);background:transparent;color:inherit;border-radius:7px;padding:5px 9px;font:600 11.5px system-ui,sans-serif;cursor:pointer}.hub-seg button[aria-pressed="true"]{background:var(--nz-accent);border-color:var(--nz-accent);color:#fff}.hub-diag{font:11px ui-monospace,monospace;white-space:pre-wrap;padding:10px;border-radius:9px;background:rgba(128,148,170,.1);max-height:180px;overflow:auto;margin:0 0 10px}@media(max-width:640px){.hub{grid-template-columns:1fr}.hub-nav{flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid rgba(128,148,170,.22);padding:0 0 8px}.hub-nav button{white-space:nowrap}}`;
    document.head.appendChild(hubFix);

    // ================= Dialog focus: trap Tab inside the open dialog, restore focus on close =================
    (function dialogFocusManager() {
      const visible = el => !el.hidden && el.getClientRects().length > 0;
      const focusable = root => [...root.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(visible);
      const openDialogs = () => [...document.querySelectorAll('.nz-modal-overlay, [role="dialog"][aria-modal="true"]')].filter(visible);
      const returns = new WeakMap();
      document.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const top = openDialogs().pop(); if (!top) return;
        const items = focusable(top); if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }, true);
      const watch = new MutationObserver(records => {
        records.forEach(record => {
          const el = record.target;
          if (el.getAttribute('role') !== 'dialog' || el.getAttribute('aria-modal') !== 'true') return;
          if (!el.hidden && record.oldValue === null) { returns.set(el, document.activeElement); setTimeout(() => { const first = focusable(el)[0]; first?.focus({ preventScroll: true }); }, 30); }
          if (el.hidden && record.oldValue !== 'hidden') {
            const back = returns.get(el);
            const target = back && back.isConnected && visible(back) ? back : (document.getElementById('top-avatar') && visible(document.getElementById('top-avatar')) ? document.getElementById('top-avatar') : null);
            target?.focus({ preventScroll: true });
          }
        });
      });
      watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
    })();

    // ================= Colour themes: each one has its own logo, cached on this device =================
    const ACCENT_THEMES = [['teal', 'Teal', '#085d43'], ['gold', 'Gold', '#9c7d14'], ['forest', 'Forest', '#0c4a2e'], ['sky', 'Sky', '#2c6e9e']];
    const ACCENT_ALIAS = { yellow: 'gold', green: 'forest', blue: 'sky' };
    const currentAccent = () => ACCENT_THEMES.some(([id]) => id === document.documentElement.dataset.accent) ? document.documentElement.dataset.accent : 'teal';
    function updateFaviconFromTheme() {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--nz-logo').trim();
      const match = raw.match(/url\("?(data:[^")]+)"?\)/);
      if (!match) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d'), k = Math.min(60 / img.width, 60 / img.height), w = img.width * k, h = img.height * k;
        ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
        let link = document.querySelector('link[rel="icon"]');
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.type = 'image/png'; link.href = canvas.toDataURL('image/png');
      };
      img.src = match[1];
    }
    function applyAccent(name) {
      name = ACCENT_ALIAS[name] || name;
      if (!ACCENT_THEMES.some(([id]) => id === name)) return;
      document.documentElement.dataset.accent = name;
      try { localStorage.setItem('notez-accent-v1', name); } catch {}
      updateFaviconFromTheme();
      const label = ACCENT_THEMES.find(([id]) => id === name)[1];
      toast(`${label} theme applied.`);
    }
    updateFaviconFromTheme();

    // ================= Live recording: real-time notes with provider failover =================
    const REC_SEGMENT_MS = () => window.__REC_SEGMENT_MS || 30000;   // each part is transcribed as soon as it is recorded
    const REC_NOTES_EVERY = 2;                                        // refresh the AI notes every 2 parts
    const REC_MAX_MS = 50 * 60 * 1000;
    const REC = { stream: null, recorder: null, mime: 'audio/webm', mode: 'class', dialog: null, timer: 0, segTimer: 0,
      status: 'idle', startedAt: 0, pausedMs: 0, pausedAt: 0, chunks: [], segIdx: 0, segTexts: [], queue: Promise.resolve(),
      noteId: '', provider: '', failovers: 0, notice: '', liveNotes: '', processed: 0, lastNotesAt: 0, busy: false, errors: 0 };
    const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || 'audio/webm';
    const recElapsed = () => Math.max(0, (REC.status === 'paused' ? REC.pausedAt : Date.now()) - REC.startedAt - REC.pausedMs);
    const fmtClock = ms => { const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
    const recTransient = error => error?.status === 429 || error?.status >= 500 || error instanceof TypeError || error?.name === 'AbortError' || error?.code === 'cut';
    const recLabel = provider => provider === 'gemini' ? 'Gemini' : 'Groq';
    const recSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Runs the steps in order. A step that fails (network cut, rate limit, server error, cut-off reply) hands over to the next one.
    async function recFailover(steps, tag) {
      let last = null;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await step.run();
            if (REC.provider && REC.provider !== step.name) { REC.notice = `${recLabel(step.name)} took over ${tag}.`; REC.failovers++; }
            REC.provider = step.name;
            updateRecLive();
            return { result, provider: step.name };
          } catch (error) {
            last = error; console.warn(`${recLabel(step.name)} failed ${tag}:`, error); (REC.failedOn ||= new Set()).add(step.name);
            if (!recTransient(error)) break;
            if (attempt === 0) await recSleep(700);
          }
        }
        if (i < steps.length - 1) { REC.notice = `${recLabel(step.name)} stopped (${aiErrorMessage(last)}). ${recLabel(steps[i + 1].name)} is taking over.`; REC.failovers++; updateRecLive(); }
      }
      throw last || new Error('No AI provider is available.');
    }
    const recProviders = () => ['gemini', 'groq'].filter(id => aiKey(id));
    async function recTextCall(prompt, options = {}) {
      const steps = recProviders().map(name => ({ name, run: () => aiCall(name, prompt, { temperature: options.temperature ?? 0.3, json: Boolean(options.json) }) }));
      if (!steps.length) throw Object.assign(new Error('Add a Gemini or Groq key in NotezAi settings.'), { code: 'no-key' });
      const { result } = await recFailover(steps, 'while writing notes');
      return result.text;
    }
    async function recTranscribePart(blob, index) {
      const steps = [];
      if (aiKey('gemini')) steps.push({ name: 'gemini', run: async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const answer = await aiCall('gemini', RECORD_TRANSCRIBE_GEMINI_PART(index), { temperature: 0, images: [{ mime: blob.type || 'audio/webm', data: bytesToB64Safe(bytes) }] });
        return answer.text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      } });
      if (aiKey('groq')) steps.push({ name: 'groq', run: async () => {
        const raw = await recTranscribeGroq(blob);
        if (!raw) return '';
        return (await aiCall('groq', `${RECORD_LABEL_GROQ}\n\n<transcript>\n${raw}\n</transcript>`, { temperature: 0 })).text.trim();
      } });
      if (!steps.length) throw Object.assign(new Error('Add a Gemini or Groq key in NotezAi settings.'), { code: 'no-key' });
      const { result } = await recFailover(steps, `on part ${index + 1}`);
      return result;
    }
    const RECORD_TRANSCRIBE_GEMINI_PART = index => `Transcribe this short part (number ${index + 1}) of a classroom or meeting recording, completely and accurately.
Label every turn "Voice 1:", "Voice 2:" and so on. Keep the same numbers for the same people as in the earlier parts: ${recKnownVoices() || 'none yet, number them in order of first speaking'}.
One turn per line, in the form "Voice N: words", with a timestamp like [05:12] at the start when you can.
Transcribe the words exactly as spoken, in their original language (English, Urdu or others). Do not translate. Write [inaudible] for anything you cannot hear.
Output only the transcript.`;
    function recKnownVoices() { return recDetectVoices(REC.segTexts.join('\n')).join(', '); }
    function recLiveTranscript() { return REC.segTexts.filter(Boolean).join('\n'); }
    function recNoteBody(transcript, notesText, finishing) {
      const when = new Date(REC.startedAt);
      const providerLine = REC.provider ? `${recLabel(REC.provider)}` : 'AI';
      const state = finishing ? 'Recording finished' : REC.status === 'recording' || REC.status === 'paused' ? 'Recording in progress' : 'Recording';
      const header = `> ${state} · ${when.toLocaleString()} · ${REC.mode === 'meeting' ? 'Meeting' : 'Classroom'} · transcribed by ${providerLine}${REC.failovers ? ` (${REC.failovers} provider switch${REC.failovers === 1 ? '' : 'es'})` : ''}. AI transcription with speaker labels. Check names and key facts before relying on them.`;
      return `${header}\n\n## Transcript\n\n${transcript || '_Listening… the first part appears within about 30 seconds._'}${notesText ? `\n\n## AI notes\n\n${notesText}` : ''}`;
    }
    function recSaveNote(finishing = false, notesText = REC.liveNotes) {
      const note = notes.find(item => item.id === REC.noteId); if (!note) return;
      note.body = recNoteBody(recLiveTranscript(), notesText, finishing).slice(0, 200000);
      note.updatedAt = Date.now(); if (finishing) note.tags = ['RECORDING', REC.mode === 'meeting' ? 'MEETING' : 'CLASS'];
      persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything();
    }
    async function recRefreshNotes(final) {
      const transcript = recLiveTranscript(); if (!transcript) return;
      const key = REC.mode === 'meeting' ? 'meeting' : 'class';
      const choice = $('#rec-enhance')?.value || REC.choice || 'auto';
      if (choice === 'none') return;
      const instruction = RECORD_MODES[choice === 'auto' ? key : choice] || RECORD_MODES[key];
      try {
        if (final) {
          REC.liveNotes = await recEnhance(transcript, instruction, text => { REC.notice = text; updateRecLive(); });
        } else {
          const prior = REC.liveNotes ? `Current notes:\n${REC.liveNotes}\n\n` : '';
          REC.liveNotes = await recTextCall(`${instruction}\n\n${prior}Update the notes with the newest part of this recording. Keep earlier points, add new ones, and remove repeats. Keep every Voice label.\n\n<transcript>\n${transcript.slice(-14000)}\n</transcript>`);
        }
      } catch (error) { console.warn('Live notes update failed:', error); REC.notice = `Notes will refresh with the next part (${aiErrorMessage(error)}).`; }
      REC.lastNotesAt = Date.now();
    }
    // Keeps the words that were heard. Runs of [inaudible] or [unclear] lines are dropped; a part with no words becomes empty.
    function recCleanPart(raw) {
      const lines = String(raw || '').split('\n').filter(line => line.trim());
      const kept = lines.filter(line => {
        const words = line.replace(/^\s*(\[[\d:]+\]\s*)?\**\s*Voice\s+\d+\s*\**\s*:/i, '').replace(/\[(inaudible|unclear)\]/gi, '').trim();
        return words.length > 0;
      });
      return kept.join('\n').trim();
    }
    function enqueuePart(blob, index) {
      REC.queue = REC.queue.then(async () => {
        if (!blob || blob.size < 500) { REC.processed++; return; }   // a tiny fragment at the end is not speech
        try {
          const text = recCleanPart(await recTranscribePart(blob, index));
          if (!text) REC.notice = `Part ${index + 1} had no clear speech. Check the microphone and the room noise.`;
          REC.segTexts[index] = text;
          REC.processed++;
          const isLast = REC.status === 'finishing' && REC.processed >= REC.expectedParts;
          if (!isLast && REC.processed % REC_NOTES_EVERY === 0) await recRefreshNotes(false);
          recSaveNote(false);
        } catch (error) {
          REC.errors++; REC.notice = `Part ${index + 1} could not be transcribed (${aiErrorMessage(error)}).`;
          REC.segTexts[index] = ''; updateRecLive();
        }
        updateRecLive();
      });
      return REC.queue;
    }
    function startPart() {
      REC.chunks = [];
      const recorder = new MediaRecorder(REC.stream, { mimeType: REC.mime, audioBitsPerSecond: 32000 });
      const index = REC.segIdx++;
      recorder.ondataavailable = event => { if (event.data?.size) REC.chunks.push(event.data); };
      recorder.onstop = () => { const blob = new Blob(REC.chunks, { type: REC.mime.split(';')[0] }); REC.chunks = []; enqueuePart(blob, index); };
      recorder.start();
      REC.recorder = recorder;
      REC.expectedParts = index + 1;
    }
    function endPart() {
      const recorder = REC.recorder; REC.recorder = null;
      if (!recorder || recorder.state === 'inactive') return Promise.resolve();
      return new Promise(resolve => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
    }
    function clearRecTimers() { clearInterval(REC.timer); REC.timer = 0; clearInterval(REC.segTimer); REC.segTimer = 0; }
    function recRunTimers() {
      clearRecTimers();
      REC.timer = setInterval(() => { const clock = $('#rec-clock'); if (clock) clock.textContent = fmtClock(recElapsed()); if (REC.status === 'recording' && recElapsed() >= REC_MAX_MS) recStop(); }, 250);
      REC.segTimer = setInterval(() => { if (REC.status === 'recording') { endPart(); startPart(); } }, REC_SEGMENT_MS());
    }
    function openRecorder() {
      if (!currentSession) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio. Use Chrome or Edge on https.', 'error', 6000); return; }
      if (!recProviders().length) { toast('Add a Gemini or Groq key in NotezAi settings. Recording needs one to make notes.', 'error', 6000); return; }
      if (REC.status === 'done') { REC.status = 'idle'; REC.segTexts = []; REC.segIdx = 0; REC.processed = 0; REC.failovers = 0; REC.liveNotes = ''; REC.provider = ''; REC.failedOn = new Set(); REC.notice = ''; REC.errors = 0; REC.queue = Promise.resolve(); }
      REC.dialog = { set hidden(value) { if (value) nzaiClose(); else dockShow('voice'); }, get hidden() { return !nzai.open || nzai.dock !== 'voice'; } };
      dockShow('voice');
    }
    const REC_VOICE_CLASS = ['voice-a', 'voice-b', 'voice-c', 'voice-d'];
    function recTimeline() {
      const parts = REC.segTexts.map((text, index) => ({ index, text: text || '' })).filter(part => part.text.trim());
      if (!parts.length) return `<div class="rec-empty">${REC.status === 'idle' ? 'The live transcript appears here as you record.' : 'Listening… the first part appears within about 30 seconds.'}</div>`;
      const lastIndex = parts[parts.length - 1].index;
      return parts.map(part => {
        const lines = part.text.split('\n').filter(line => line.trim()).map(line => {
          const m = line.match(/^\s*(?:\[([\d:]+)\]\s*)?\**\s*(Voice\s+(\d+))\s*\**\s*:\s*(.*)$/i);
          if (!m) return `<p class="rec-line"><span class="rec-text">${esc(line.trim())}</span></p>`;
          const n = Number(m[3]) - 1;
          return `<p class="rec-line"><span class="rec-stamp">${esc(m[1] || '')}</span><span class="rec-speaker ${REC_VOICE_CLASS[n % 4]}">Voice ${m[3]}</span><span class="rec-text">${esc(m[4])}</span></p>`;
        }).join('');
        return `<section class="rec-part${part.index === lastIndex && REC.status === 'recording' ? ' current' : ''}"><header><b>Part ${part.index + 1}</b><span>${(part.index + 1) * Math.round(REC_SEGMENT_MS() / 1000)}s</span></header>${lines}</section>`;
      }).join('');
    }
    function recProviderStrip() {
      const failed = REC.failedOn || new Set();
      return ['gemini', 'groq'].filter(id => aiKey(id)).map(id => {
        const state = REC.provider === id && (REC.status === 'recording' || REC.status === 'finishing') ? 'active' : failed.has(id) && REC.provider !== id ? 'stopped' : REC.provider === id ? 'used' : 'standby';
        const label = { active: 'Working', used: 'Last used', stopped: 'Stopped, switched', standby: 'Standby' }[state];
        return `<span class="rec-prov ${state}"><i></i><b>${recLabel(id)}</b><small>${label}</small></span>`;
      }).join('') || '<span class="rec-prov standby"><b>No key</b></span>';
    }
    function recLiveHtml() {
      const pending = REC.expectedParts ? Math.max(0, REC.expectedParts - REC.processed) : 0;
      const notes = REC.liveNotes ? markdownToHtml(REC.liveNotes) : `<p class="rec-muted">${REC.status === 'idle' ? 'Notes are written as the recording goes on. Each refresh adds to the last.' : 'Notes appear after the second part, then refresh about every minute.'}</p>`;
      const notice = REC.notice ? `<div class="ai-notice rec-notice" role="status">${esc(REC.notice)}</div>` : '';
      if (REC.status === 'idle') return `<div class="rec-strip">${recProviderStrip()}</div>${notice}`;
      const tab = REC.tab === 'notes' ? 'notes' : 'transcript';
      const tabs = `<div class="rec-tabs" role="tablist" aria-label="Live view"><button type="button" role="tab" aria-selected="${tab === 'transcript'}" data-rec="tab" data-tab="transcript">Transcript<small>${pending ? `${pending} in progress` : REC.processed ? 'Up to date' : 'Listening'}</small></button><button type="button" role="tab" aria-selected="${tab === 'notes'}" data-rec="tab" data-tab="notes">Notes<small>${REC.failovers ? `${REC.failovers} switch${REC.failovers === 1 ? '' : 'es'}` : 'Live'}</small></button></div>`;
      const pane = tab === 'transcript' ? `<div class="rec-scroll" id="rec-transcript">${recTimeline()}</div>` : `<div class="rec-scroll ai-md">${notes}</div>`;
      return `<div class="rec-strip">${recProviderStrip()}</div>${notice}${tabs}<section class="rec-card">${pane}</section>`;
    }
    function updateRecLive() { const el = $('#rec-live'); if (el) el.innerHTML = recLiveHtml(); }
    function recBodyHtml() {
      const status = REC.status;
      const stateLabel = { idle: 'Ready', recording: 'Recording', paused: 'Paused', finishing: 'Finishing', done: 'Saved' }[status] || 'Ready';
      const ic = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
      const clock = `<span class="rec-clock" id="rec-clock">${fmtClock(recElapsed())}</span>`;
      const modeSeg = status === 'idle' ? `<div class="ai-seg rec-mode" role="radiogroup" aria-label="Recording type">${[['class', 'Classroom'], ['meeting', 'Meeting']].map(([v, l]) => `<label class="rec-opt"><input type="radio" name="rec-mode" id="rec-mode-${v}" value="${v}" ${REC.mode === v ? 'checked' : ''}>${l}</label>`).join('')}</div>` : '';
      const intro = status === 'idle' ? `<p class="rec-sub">Record a lecture or meeting. You get a live transcript with speakers, and notes written as you go.</p>${modeSeg}` : '';
      const stage = (() => {
        if (status === 'idle') return `<div class="rec-stage idle"><button type="button" class="rec-rec" data-rec="start" aria-label="Start recording"><i></i></button><div class="rec-stage-t"><b>Start recording</b><small>Saved to your library from the first second</small></div></div>`;
        const meter = status === 'recording' ? `<div class="rec-meter" aria-hidden="true"><i id="rec-level" style="width:0%"></i></div>` : '';
        const mid = status === 'paused' ? `<button type="button" class="rec-ctl" data-rec="resume">${ic('<path d="M7 4l13 8-13 8Z"/>')}<span>Resume</span></button>` : status === 'recording' ? `<button type="button" class="rec-ctl" data-rec="pause">${ic('<path d="M8 5v14M16 5v14"/>')}<span>Pause</span></button>` : '';
        const ctl = status === 'recording' || status === 'paused' ? `<div class="rec-ctls">${mid}<button type="button" class="rec-ctl stop" data-rec="stop">${ic('<rect x="6" y="6" width="12" height="12" rx="2"/>')}<span>Stop and finish</span></button><button type="button" class="rec-ctl quiet" data-rec="close" aria-label="Hide panel while recording continues" title="Hide panel (recording continues)">${ic('<path d="m6 9 6 6 6-6"/>')}</button></div>` : '';
        return `<div class="rec-stage ${status}"><div class="rec-state ${status}"><i></i><b>${stateLabel}</b></div>${status === 'done' ? '' : clock}${meter}${ctl}</div>`;
      })();
      const tail = (() => {
        if (status === 'idle') return `<label class="nzai-label" for="rec-enhance">Notes style</label><select class="nzai-field" id="rec-enhance">${[['auto', REC.mode === 'meeting' ? 'Meeting minutes' : 'Class notes'], ['summary', 'Summary and action items'], ['quiz', 'Quiz from this lecture'], ['clean', 'Clean transcript only'], ['none', 'Transcript only (no AI notes)']].map(([v, l]) => `<option value="${v}" ${(REC.choice || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><p class="rec-muted">Tell everyone you are recording, and get their agreement first.</p>`;
        if (status === 'finishing') return `<div class="rec-actions"><button type="button" class="ai-action" data-rec="close">Hide panel</button></div>`;
        if (status === 'done') return `<div class="rec-actions"><button type="button" class="ai-action primary big" data-rec="open">Open note</button><button type="button" class="ai-action big" data-rec="names">Name speakers</button><button type="button" class="ai-action" data-rec="close">Close</button></div>`;
        return '';
      })();
      return `${intro}${stage}<div id="rec-live" class="rec-live">${recLiveHtml()}</div>${tail}`;
    }
    let recMeterCtx = null, recMeterRaf = 0;
    function recStartMeter(stream) {
      try {
        recMeterCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = recMeterCtx.createMediaStreamSource(stream), analyser = recMeterCtx.createAnalyser();
        analyser.fftSize = 512; source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const frame = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          const level = $('#rec-level'); if (level) level.style.width = Math.min(100, peak / 128 * 140) + '%';
          recMeterRaf = requestAnimationFrame(frame);
        };
        frame();
      } catch { /* the level meter is cosmetic */ }
    }
    function recStopMeter() { cancelAnimationFrame(recMeterRaf); try { recMeterCtx?.close(); } catch {} recMeterCtx = null; }
    function recRender() { const body = $('#rec-body'); if (body) body.innerHTML = recBodyHtml(); }
    function recStart() {
      if (REC.status !== 'idle') return;
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(stream => {
        REC.stream = stream; REC.mime = recMime(); REC.choice = $('#rec-enhance')?.value || 'auto';
        REC.startedAt = Date.now(); REC.pausedMs = 0; REC.pausedAt = 0; REC.segTexts = []; REC.segIdx = 0; REC.processed = 0; REC.expectedParts = 0;
        REC.failovers = 0; REC.liveNotes = ''; REC.provider = ''; REC.notice = ''; REC.errors = 0; REC.queue = Promise.resolve(); REC.status = 'recording';
        const when = new Date();
        const note = normalizeNote({ id: uid(), title: `${REC.mode === 'meeting' ? 'Meeting' : 'Class'} recording · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, subject: (currentFolderPath || (REC.mode === 'meeting' ? 'Meetings' : 'Classes')).split('/')[0], folderPath: currentFolderPath || (REC.mode === 'meeting' ? 'Meetings' : 'Classes'), tags: ['RECORDING', 'LIVE'], kind: 'markdown', body: recNoteBody('', '', false), createdAt: Date.now(), updatedAt: Date.now(), lastViewedAt: Date.now() });
        REC.noteId = note.id; notes = [note, ...notes]; addFolderPath(note.folderPath); persistNote(note).catch(() => {}); renderEverything();
        startPart(); recRunTimers(); recStartMeter(stream); recRender();
      }).catch(error => { console.error('Recording could not start:', error); toast(error?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Could not open the microphone.', 'error', 6000); });
    }
    function recPause() { if (REC.status !== 'recording') return; endPart(); REC.status = 'paused'; REC.pausedAt = Date.now(); clearInterval(REC.segTimer); REC.segTimer = 0; recRender(); }
    function recResume() { if (REC.status !== 'paused') return; REC.pausedMs += Date.now() - REC.pausedAt; REC.pausedAt = 0; REC.status = 'recording'; startPart(); recRunTimers(); recRender(); }
    async function recStop() {
      if (REC.status !== 'recording' && REC.status !== 'paused') return;
      if (REC.status === 'recording') { REC.pausedAt = 0; }
      REC.status = 'finishing'; clearRecTimers(); recRender();
      await endPart();                                     // the last part is finalised before the microphone is released
      recStopMeter(); REC.stream?.getTracks().forEach(track => track.stop());
      await Promise.race([REC.queue, recSleep(180000)]);  // parts are transcribed first; a stuck part cannot block the note for more than 3 minutes
      recSaveNote(true, REC.liveNotes);
      if (recLiveTranscript() && REC.choice !== 'none') {
        try { await recRefreshNotes(true); recSaveNote(true, REC.liveNotes); } catch (error) { REC.notice = `Full notes could not be written (${aiErrorMessage(error)}). The transcript is saved.`; }
      }
      const note = notes.find(item => item.id === REC.noteId);
      if (note) { note.body = note.body.replace(/^> Recording finished/, '> Recording finished'); persistNote(note).catch(() => {}); }
      const voices = recDetectVoices(recLiveTranscript());
      REC.status = 'done'; recRender(); renderEverything();
      toast('Recording finished and saved to your library.', 'success', 4500);
      if (voices.length && note) recOfferNames(note.id, voices);
    }
    function recClick(event) {
      const act = event.target.closest('[data-rec]')?.dataset.rec; if (!act) return;
      if (act === 'start') return recStart();
      if (act === 'tab') { REC.tab = event.target.closest('[data-rec]').dataset.tab; return updateRecLive(); }
      if (act === 'pause') return recPause();
      if (act === 'resume') return recResume();
      if (act === 'stop') return recStop();
      if (act === 'names') { const note = notes.find(item => item.id === REC.noteId); const voices = note ? recDetectVoices(note.body) : []; if (voices.length) recOfferNames(REC.noteId, voices); else toast('No speaker labels found in this note yet.'); return; }
      if (act === 'open') { const note = notes.find(item => item.id === REC.noteId); nzaiClose(); if (note) openNote(note.id); return; }
      if (act === 'close') {
        nzaiClose(); return;   // recording keeps running in the background
      }
    }
    // Recording keeps going if the dialog is hidden; reopen it from Import to see progress.
    function bytesToB64Safe(bytes) { let bin = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(bin); }
    const RECORD_LABEL_GROQ = `Below is a transcript of a classroom or meeting part with no speaker labels. Split it into turns and label each turn "Voice 1:", "Voice 2:" and so on, using context: who asks, who answers, greetings and changes of topic. Keep the same label for the same person. Do not change, correct or add any words. Output only the labelled transcript.`;
    async function recTranscribeGroq(blob) {
      const key = aiKey('groq'); if (!key) throw new Error('Add a Groq key to transcribe with Whisper.');
      const form = new FormData(); form.append('file', blob, 'part.webm'); form.append('model', 'whisper-large-v3-turbo'); form.append('response_format', 'json'); form.append('temperature', '0');
      const response = await aiFetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Transcription failed (${response.status})`), { status: response.status });
      return String(data.text || '').trim();
    }
    const RECORD_MODES = {
      class: 'Write classroom study notes from this transcript: the topics covered in order, key definitions, facts and examples, formulas or dates, the questions the teacher asked, and a short list of things to revise. Use Markdown headings and bullets. Use only what is in the transcript.',
      meeting: 'Write meeting minutes from this transcript: attendees (by Voice label), decisions made, action items with owners and deadlines where stated, open questions, and a short summary. Use Markdown headings and bullets. Use only what is in the transcript.',
      summary: 'Write a short summary of this transcript, followed by key points and action items (owner if stated). Use Markdown. Use only what is in the transcript.',
      quiz: 'Write a five-question multiple-choice quiz from this transcript. For each question give four options (a to d), the correct letter, and a one-line explanation. Use only what the transcript says. Use Markdown with a heading for each question.',
      clean: 'Clean up this transcript: fix punctuation, capitalisation and obvious mis-hearings where the meaning is clear. Keep every Voice label and every turn in order. Do not summarise or add anything. Output only the cleaned transcript.'
    };
    function recSplitForAi(text, limit) {
      const parts = []; let current = '';
      for (const line of String(text).split('\n')) { if (current.length + line.length > limit && current) { parts.push(current); current = ''; } current += (current ? '\n' : '') + line; }
      if (current) parts.push(current);
      return parts;
    }
    async function recEnhance(transcript, instruction, progress) {
      const pieces = recSplitForAi(transcript, 12000);
      if (pieces.length === 1) return recTextCall(`${instruction}\n\n<transcript>\n${pieces[0]}\n</transcript>`, { temperature: 0.3 });
      const partials = [];
      for (let i = 0; i < pieces.length; i++) {
        progress(`Writing notes for part ${i + 1} of ${pieces.length}`);
        partials.push(await recTextCall(`${instruction}\n\nThis is part ${i + 1} of ${pieces.length} of a longer recording. Cover only this part.\n\n<transcript>\n${pieces[i]}\n</transcript>`, { temperature: 0.3 }));
      }
      progress('Combining the notes');
      return recTextCall(`Combine these partial notes from one recording into a single, well organised set of notes. Remove repeats. Keep every Voice label.\n\n${partials.join('\n\n---\n\n')}`, { temperature: 0.3 });
    }
    function recDetectVoices(text) {
      const found = new Set(); const re = /(?:^|\n)\s*(?:\[[\d:]+\]\s*)?\**\s*(Voice\s+\d+)\s*\**\s*:/gi; let m;
      while ((m = re.exec(String(text)))) found.add(m[1].replace(/\s+/g, ' '));
      return [...found].sort((x, y) => Number(x.match(/\d+/)[0]) - Number(y.match(/\d+/)[0]));
    }
    function recOfferNames(noteId, voices) {
      const note = notes.find(item => item.id === noteId); if (!note) return;
      const rows = voices.map(voice => `<label class="rec-name-row"><span>${esc(voice)}</span><input class="nzai-field" data-voice="${esc(voice)}" placeholder="Name (e.g. Teacher, Ali)" value=""></label>`).join('');
      showModal('names-dialog', 'Name the speakers?', `<p class="rec-small" style="margin:0 0 10px">Give each voice a name. Names replace the labels in this note only, and you can skip this.</p>${rows}<div class="nzai-actions" style="margin-top:12px"><button type="button" class="nzai-primary" data-names="apply">Apply names</button><button type="button" data-names="skip">Skip</button></div>`, dialog => {
        dialog.onclick = event => {
          const act = event.target.closest('[data-names]')?.dataset.names; if (!act) return;
          if (act === 'apply') {
            let body = note.body;
            dialog.querySelectorAll('[data-voice]').forEach(input => {
              const name = input.value.trim().replace(/[:\n]/g, ' ').slice(0, 40); if (!name) return;
              const label = input.dataset.voice.replace(/\s+/g, '\\s+');
              body = body.replace(new RegExp(`(^|\\n)((?:\\[[\\d:]+\\]\\s*)?\\s*\\**\\s*)${label}(\\s*\\**\\s*):`, 'gi'), (_, lead, pre, post) => `${lead}${pre}${name}${post}:`);
            });
            note.body = body; note.updatedAt = Date.now();
            persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
            renderEverything(); if (currentPage === 'reader') openNote(note.id);
            toast('Speaker names applied.');
          }
          dialog.hidden = true;
        };
      });
    }
    const recCss = document.createElement('style');
    recCss.textContent = `.rec-opt{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;font:600 12px system-ui,sans-serif}.rec-opt input{accent-color:var(--nz-accent)}.rec-status{display:flex;align-items:center;gap:10px;margin:12px 0 6px}.rec-dot{width:10px;height:10px;border-radius:50%;background:rgba(128,148,170,.5)}.rec-dot.live{background:#d9534f;animation:nzPulse 1.2s infinite}.rec-dot.busy{background:var(--nz-accent);animation:nzPulse 1s infinite}@keyframes nzPulse{50%{opacity:.35}}.rec-clock{font:700 26px ui-monospace,monospace;font-variant-numeric:tabular-nums}.rec-state{font-size:12px;opacity:.7}.rec-meter{height:6px;border-radius:9px;background:rgba(128,148,170,.2);overflow:hidden;margin:8px 0 12px}.rec-meter i{display:block;height:100%;background:var(--nz-accent);transition:width .1s}.rec-small{font-size:11.5px;opacity:.7;margin:8px 0}.rec-name-row{display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center;margin-bottom:8px;font-size:13px}.rec-live-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.rec-live-h{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}.rec-live-box{margin-top:4px;min-height:120px;max-height:220px;overflow:auto;padding:9px 10px;border-radius:10px;border:1px solid rgba(128,148,170,.25);font-size:12px;line-height:1.5}.rec-live-box div{margin-bottom:4px}.rec-provider{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;opacity:.8;margin-top:4px}.rec-notice{margin-top:8px}@media(max-width:560px){.rec-live-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(recCss);

    // ================= Reliability: error log, friendly failures, diagnostics =================
    const NZ_ERRORS = [];
    function nzLogError(kind, error) {
      const message = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 220);
      NZ_ERRORS.unshift({ t: new Date().toISOString(), kind, message });
      NZ_ERRORS.splice(20);
    }
    window.addEventListener('error', event => {
      if (event.filename && !event.filename.includes('index.html') && !event.filename.startsWith('blob:')) return;   // ignore third-party noise
      nzLogError('error', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', event => {
      nzLogError('promise', event.reason);
      const text = String(event.reason?.message || '');
      if (/Failed to fetch|NetworkError|network/i.test(text) && !navigator.onLine) return;   // offline is already shown
    });
    // Recording indicator: visible from anywhere in the app while a recording runs.
    const recPill = document.createElement('button');
    recPill.id = 'rec-pill'; recPill.type = 'button'; recPill.hidden = true;
    recPill.setAttribute('aria-label', 'Recording in progress. Open voice notes.');
    recPill.innerHTML = '<i></i><b>Recording</b><span id="rec-pill-clock">00:00</span>';
    recPill.addEventListener('click', () => dockShow('voice'));
    document.body.appendChild(recPill);
    setInterval(() => {
      const live = REC.status === 'recording' || REC.status === 'paused' || REC.status === 'finishing';
      recPill.hidden = !live;
      if (live) { recPill.querySelector('b').textContent = REC.status === 'paused' ? 'Paused' : REC.status === 'finishing' ? 'Finishing' : 'Recording'; recPill.querySelector('#rec-pill-clock').textContent = fmtClock(recElapsed()); }
      const badge = $('#dock-rec-badge'); if (badge) badge.hidden = !live;
    }, 500);
    // ================= Reading comfort (saved on this device) =================
    const READ_DEFAULTS = { size: 14, lh: 1.86, w: 914 };
    function readingSettings() { try { return { ...READ_DEFAULTS, ...(JSON.parse(localStorage.getItem('notez-reading-v1')) || {}) }; } catch { return { ...READ_DEFAULTS }; } }
    function applyReading(next) {
      const merged = { ...readingSettings(), ...next };
      merged.size = Math.max(12, Math.min(22, Number(merged.size) || 14));
      merged.lh = Math.max(1.4, Math.min(2.4, Number(merged.lh) || 1.86));
      merged.w = Math.max(560, Math.min(1200, Number(merged.w) || 914));
      document.documentElement.style.setProperty('--read-size', merged.size + 'px');
      document.documentElement.style.setProperty('--read-lh', String(merged.lh));
      document.documentElement.style.setProperty('--read-w', merged.w + 'px');
      try { localStorage.setItem('notez-reading-v1', JSON.stringify(merged)); } catch {}
      return merged;
    }
    applyReading({});
    function readingSettingsHtml() {
      const r = readingSettings();
      return `<div class="read-settings">
        <div class="read-row"><label for="rd-size"><b>Text size</b><small style="display:block;opacity:.7">${r.size}px</small></label><input type="range" id="rd-size" min="12" max="22" step="1" value="${r.size}" data-read="size"></div>
        <div class="read-row"><label for="rd-lh"><b>Line spacing</b><small style="display:block;opacity:.7">${r.lh.toFixed(2)}</small></label><input type="range" id="rd-lh" min="1.4" max="2.4" step="0.05" value="${r.lh}" data-read="lh"></div>
        <div class="read-row"><label for="rd-w"><b>Column width</b><small style="display:block;opacity:.7">${r.w}px</small></label><input type="range" id="rd-w" min="560" max="1200" step="20" value="${r.w}" data-read="w"></div>
        <div class="read-preview" id="rd-preview" style="font-size:${r.size}px;line-height:${r.lh}">The quick brown fox explains photosynthesis. Light energy becomes chemical energy in the chloroplast.</div>
        <div class="hub-row" style="border:0;padding:0"><div><small>Changes apply immediately to every note.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="read-reset">Reset</button></div></div>`;
    }
    // ================= Selection actions in the reader: Ask · Explain · Flashcard =================
    const selBar = document.createElement('div');
    selBar.id = 'sel-bar'; selBar.hidden = true; selBar.setAttribute('role', 'toolbar'); selBar.setAttribute('aria-label', 'Selection actions');
    selBar.innerHTML = '<button type="button" data-sel="ask">Ask NotezAi</button><button type="button" data-sel="explain">Explain</button><button type="button" data-sel="card">Flashcard</button><button type="button" data-sel="copy">Copy</button>';
    document.body.appendChild(selBar);
    let selectedText = '';
    function showSelectionBar() {
      const sel = window.getSelection(); const view = $('#viewer-content');
      if (!sel || sel.isCollapsed || !view || !sel.anchorNode || !view.contains(sel.anchorNode)) { selBar.hidden = true; return; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 3) { selBar.hidden = true; return; }
      selectedText = text.slice(0, 1600);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      selBar.hidden = false;
      selBar.style.left = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)) + 'px';
      selBar.style.top = Math.max(70, rect.top) + 'px';
    }
    document.addEventListener('mouseup', () => setTimeout(showSelectionBar, 10));
    document.addEventListener('keyup', event => { if (event.shiftKey || String(event.key || '').startsWith('Arrow')) setTimeout(showSelectionBar, 10); });
    document.addEventListener('mousedown', event => { if (!event.target.closest('#sel-bar')) selBar.hidden = true; });
    async function selectionAction(kind) {
      const note = notes.find(item => item.id === activeId);
      if (!selectedText) return;
      selBar.hidden = true;
      if (kind === 'copy') { try { await navigator.clipboard.writeText(selectedText); toast('Copied.'); } catch { toast('Your browser blocked clipboard access.', 'error'); } return; }
      if (!aiReady()) { toast('Add a Gemini or Groq key in NotezAi settings to use selection actions.', 'error', 5200); return; }
      if (kind === 'ask') {
        openNotezAi(note || null);
        setTimeout(() => { const input = $('#nzai-input'); if (input) { input.value = `About this passage: “${selectedText}”\n\nWhat does it mean, and how does it connect to the rest of the note?`; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); } }, 120);
        return;
      }
      if (kind === 'explain') { openNotezAi(note || null); setTimeout(() => nzaiAsk(`Explain this passage simply, with one example:\n\n“${selectedText}”`), 120); return; }
      if (kind === 'card') {
        toast('Making a flashcard…');
        try {
          const answer = await aiGenerate(`Make one flashcard from this passage. Reply with exactly two lines:\nQ: a clear question the passage answers\nA: the answer, in one or two sentences.\n\nPassage:\n${selectedText}`, { temperature: 0.2 });
          const body = answer.text.trim();
          const stamp = Date.now();
          const created = normalizeNote({ id: uid(), title: `Flashcard · ${(note?.title || 'Notes').slice(0, 50)}`, subject: 'Flashcards', folderPath: 'Flashcards', tags: ['flashcard'], kind: 'markdown', body: `${body}\n\n> From: ${note?.title || 'a note'}`, createdAt: stamp, updatedAt: stamp, lastViewedAt: 0 });
          notes = [created, ...notes]; addFolderPath('Flashcards'); persistNote(created).catch(() => {}); renderEverything();
          toast('Flashcard saved in the Flashcards folder. Study it from the note menu.', 'success', 5200);
        } catch (error) { toast(`Could not make a flashcard: ${aiErrorMessage(error)}`, 'error', 6000); }
      }
    }
    selBar.addEventListener('click', event => { const kind = event.target.closest('[data-sel]')?.dataset.sel; if (kind) selectionAction(kind); });
    // ================= Small delights: celebrations, exam countdown, due nudge =================
    function celebrate(message) {
      const colours = ['var(--nz-accent)', '#e6c04a', '#6cb8ea', '#d9534f', '#9c7d14'];
      const layer = document.createElement('div');
      layer.className = 'nz-confetti'; layer.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 46; i++) {
        const piece = document.createElement('i');
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.background = colours[i % colours.length];
        piece.style.animationDelay = (Math.random() * 0.35) + 's';
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        layer.appendChild(piece);
      }
      document.body.appendChild(layer);
      setTimeout(() => layer.remove(), 2600);
      toast(message, 'success', 4800);
    }
    const nudgeStyle = document.createElement('style');
    nudgeStyle.textContent = `.nz-confetti{position:fixed;inset:0;pointer-events:none;z-index:4000;overflow:hidden}.nz-confetti i{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;animation:nzFall 2.4s cubic-bezier(.2,.6,.4,1) forwards}@keyframes nzFall{to{transform:translateY(110vh) rotate(540deg);opacity:.9}}@media (prefers-reduced-motion: reduce){.nz-confetti{display:none}}.home-nudge{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 18px;padding:13px 16px;border-radius:14px;border:1px solid color-mix(in srgb,var(--nz-accent) 35%,transparent);background:color-mix(in srgb,var(--nz-accent) 8%,transparent)}.home-nudge b{font-size:13px}.home-nudge small{display:block;font-size:11.5px;opacity:.75;margin-top:2px}.home-nudge button{white-space:nowrap}`;
    document.head.appendChild(nudgeStyle);
    function examInfo() {
      try { const data = JSON.parse(localStorage.getItem('notez-focus-v1')) || {}; if (!data.exam) return null; const days = Math.round((new Date(data.exam + 'T00:00:00') - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5); return { days, date: data.exam }; } catch { return null; }
    }
    function renderHomeNudge() {
      const anchor = $('#week-digest') || $('.dashboard-stats'); if (!anchor || !currentSession) return;
      let bar = $('#home-nudge');
      if (!bar) { bar = document.createElement('section'); bar.id = 'home-nudge'; bar.className = 'home-nudge'; anchor.before(bar); }
      const due = (Array.isArray(notes) ? notes : []).filter(note => isReviewDue(note)).length;
      const exam = examInfo();
      const conflicts = readConflicts().length;
      const lastExport = Number(localStorage.getItem('notez-last-export')) || 0;
      const backupDue = notes.length > 0 && (!lastExport || Date.now() - lastExport > 14 * 864e5);
      const parts = [];
      if (exam) parts.push(exam.days > 0 ? `<b>${exam.days} day${exam.days === 1 ? '' : 's'} to your exam</b>` : exam.days === 0 ? '<b>Exam day. Good luck.</b>' : '<b>Your exam date has passed</b>');
      if (due) parts.push(`${due} note${due === 1 ? ' is' : 's are'} due for review`);
      if (conflicts) parts.push(`<b>${conflicts} sync conflict${conflicts === 1 ? '' : 's'} to review</b>`);
      if (backupDue) parts.push('Your last backup is over two weeks old');
      if (!parts.length) { bar.hidden = true; return; }
      bar.hidden = false;
      const actions = [
        conflicts ? '<button type="button" class="nzai-primary hub-btn" data-nudge="conflicts">Review conflicts</button>' : '',
        due ? '<button type="button" class="nzai-primary hub-btn" data-nudge="study">Start review</button>' : '',
        backupDue ? '<button type="button" class="nzai-primary hub-btn" data-nudge="backup">Back up now</button>' : ''
      ].join('');
      bar.innerHTML = `<div><b>${parts.join(' · ')}</b><small>${due ? 'A 10-minute session keeps your memory fresh.' : conflicts ? 'Nothing was lost: each conflict kept both versions.' : 'Nothing is due. Use the time to read ahead.'}</small></div><div style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>`;
    }
    setInterval(renderHomeNudge, 30000);
    document.addEventListener('click', event => {
      const tag = event.target.closest('[data-tagfilter]'); if (!tag) return;
      event.preventDefault(); event.stopPropagation();
      navigateToPage('notes', 'all');
      const input = $('#search-input'); if (input) { input.value = 'tag:' + tag.dataset.tagfilter.replace(/\s+/g, '-'); input.dispatchEvent(new Event('input', { bubbles: true })); }
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-nudge=study]')) startStudySession?.();
      if (event.target.closest('[data-nudge=conflicts]')) showConflicts();
      if (event.target.closest('[data-nudge=backup]')) exportNotesJson();
    });
    // ================= Main UI: command strip on Home, recent notes in the sidebar =================
    function renderHomeCommands() {
      const welcome = $('.dashboard-welcome'); if (!welcome) return;
      let strip = $('#home-commands');
      if (!strip) {
        strip = document.createElement('nav');
        strip.id = 'home-commands'; strip.className = 'home-commands'; strip.setAttribute('aria-label', 'Quick actions');
        strip.innerHTML = [
          ['new', 'N', 'New note', 'Start a blank page', 'N'],
          ['record', 'REC', 'Record a lecture', 'Live notes with speakers', ''],
          ['ask', 'AI', 'Ask NotezAi', 'Chat about your library', 'Alt A'],
          ['paste', 'CB', 'Paste as note', 'Clipboard text, one click', 'Alt Shift N']
        ].map(([id, ico, label, hint, key]) => `<button type="button" class="home-cmd" data-cmd="${id}"><span class="home-cmd-ico" aria-hidden="true">${ico}</span><b>${label}</b><small>${hint}</small>${key ? `<kbd>${key}</kbd>` : ''}</button>`).join('');
        welcome.after(strip);
        strip.addEventListener('click', event => {
          const id = event.target.closest('[data-cmd]')?.dataset.cmd; if (!id) return;
          if (id === 'new') openEditor();
          else if (id === 'record') openRecorder();
          else if (id === 'ask') openNotezAi(null);
          else if (id === 'paste') quickCaptureFromClipboard();
        });
      }
      strip.hidden = !currentSession;
    }
    // Home order: daily study card first, then "pick up where you left off", then everything else.
    function orderHomeCards() {
      const home = $('#home-view'), welcome = $('.dashboard-welcome');
      if (!home || !welcome) return;
      let ref = welcome;
      const folderSection = $('#home-folder-grid')?.closest('.home-section');
      for (const el of [$('#week-card'), $('#home-spotlight'), $('#home-commands'), $('#home-nudge'), $('#week-digest'), folderSection]) {
        if (!el || el.parentElement !== home) continue;
        if (ref.nextElementSibling !== el) ref.after(el);
        ref = el;
      }
    }
    function renderSideRecent() {
      const tree = $('#folder-tree'); const anchor = tree?.closest('.nav-section, .sidebar-section') || tree?.parentElement; if (!anchor) return;
      let box = $('#side-recent');
      if (!box) { box = document.createElement('div'); box.id = 'side-recent'; box.className = 'side-recent'; (anchor.parentElement?.contains(anchor) ? anchor : tree).before(box); box.addEventListener('click', event => { const id = event.target.closest('[data-recent]')?.dataset.recent; if (id) openNote(id); }); }
      const recent = (Array.isArray(notes) ? notes : []).filter(note => Number(note.lastViewedAt) > 0).sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 4);
      box.hidden = !recent.length || !currentSession;
      box.innerHTML = recent.length ? `<div class="side-recent-h">Recent</div>${recent.map(note => `<button type="button" data-recent="${esc(note.id)}" title="${esc(note.title)}"><i class="side-kind" aria-hidden="true"></i><span>${esc(note.title)}</span><small>${new Date(note.lastViewedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></button>`).join('')}` : '';
    }
    // ================= Sync conflicts: keep both versions, never overwrite silently =================
    const SYNCED_KEY = uidValue => `notez-synced-v1-${uidValue}`;
    const CONFLICT_KEY = uidValue => `notez-conflicts-v1-${uidValue}`;
    function readSyncedMap(uidValue) { try { return JSON.parse(localStorage.getItem(SYNCED_KEY(uidValue))) || {}; } catch { return {}; } }
    function writeSyncedMap(uidValue, list) { const map = {}; list.forEach(note => { map[note.id] = note.updatedAt; }); try { localStorage.setItem(SYNCED_KEY(uidValue), JSON.stringify(map)); } catch {} }
    function readConflicts() { const uidValue = currentSession?.mode === 'cloud' ? currentSession.user.uid : ''; if (!uidValue) return []; try { return JSON.parse(localStorage.getItem(CONFLICT_KEY(uidValue))) || []; } catch { return []; } }
    function writeConflicts(list) { const uidValue = currentSession?.mode === 'cloud' ? currentSession.user.uid : ''; if (!uidValue) return; try { localStorage.setItem(CONFLICT_KEY(uidValue), JSON.stringify(list.slice(0, 50))); } catch {} }
    // A conflict: this device has an unsynced edit, and the cloud copy changed since this device last synced the note.
    function isNoteConflict(localNote, remoteNote, syncedMap, isPending) {
      if (!localNote || !remoteNote || !isPending) return false;
      if (localNote.updatedAt === remoteNote.updatedAt) return false;
      const known = syncedMap[localNote.id];
      if (known === undefined) return true;
      return remoteNote.updatedAt !== known;
    }
    function showConflicts() {
      const list = readConflicts();
      const rows = list.length ? list.map(item => `<div class="hist-row"><div class="hist-open" style="cursor:default"><b>${esc(item.title)}</b><small>Your offline edit was saved as a separate copy · ${new Date(item.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div><div style="display:flex;gap:6px;padding-right:6px;flex-wrap:wrap"><button type="button" class="ai-action" data-cf="open" data-id="${esc(item.copyId)}">Open copy</button><button type="button" class="ai-action" data-cf="keep" data-id="${esc(item.copyId)}">Keep both</button><button type="button" class="ai-action danger" data-cf="delete" data-id="${esc(item.copyId)}">Delete copy</button></div></div>`).join('') : '<p style="opacity:.8;margin:0">No conflicts. Every edit reached the cloud cleanly.</p>';
      showModal('conflicts-dialog', 'Sync conflicts', `<p class="rec-small" style="margin:0 0 10px">Two devices edited the same note. The cloud version stayed in place. Your offline edit is kept as a copy, so nothing was lost. Compare them, then keep or delete the copy.</p><div style="max-height:56dvh;overflow:auto;display:grid;gap:8px">${rows}</div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(640px,100%)';
        dialog.onclick = async event => {
          const btn = event.target.closest('[data-cf]'); if (!btn) return;
          const id = btn.dataset.id, act = btn.dataset.cf;
          if (act === 'open') { dialog.hidden = true; openNote(id); return; }
          if (act === 'keep') { writeConflicts(readConflicts().filter(item => item.copyId !== id)); dialog.hidden = true; showConflicts(); renderHomeNudge(); return; }
          if (act === 'delete') {
            const copy = notes.find(note => note.id === id);
            if (copy) {
              const snaps = await snapshotNotesForUndo([copy]);
              notes = notes.filter(note => note.id !== id);
              keepInTrash(snaps);
              const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
              if (cloudUid) { setCloudDeletion(cloudUid, id, { filePath: '', deletedAt: Date.now() }); markPending(cloudUid, id, false); writeCloudCache(cloudUid, notes); } else localNotesWrite();
              renderEverything();
            }
            writeConflicts(readConflicts().filter(item => item.copyId !== id));
            dialog.hidden = true; showConflicts(); renderHomeNudge();
          }
        };
      });
    }
    // ================= Bulk AI on selected notes: one summary, or tags for each (you approve first) =================
    function ensureBulkAiButtons() {
      const anchor = $('#bulk-star'); if (!anchor) return;
      const bar = anchor.parentElement; if (!bar || bar.querySelector('[data-bulk-ai]')) return;
      bar.insertAdjacentHTML('afterbegin', '<button type="button" class="bulk-ai" data-bulk-ai="summary" title="Write one summary of the selected notes">Summarise together (AI)</button><button type="button" class="bulk-ai" data-bulk-ai="tags" title="Suggest tags for each selected note">Suggest tags (AI)</button>');
      bar.addEventListener('click', event => {
        const kind = event.target.closest('[data-bulk-ai]')?.dataset.bulkAi;
        if (kind) void runBulkAi(kind);
      });
    }
    async function runBulkAi(kind) {
      const targets = notes.filter(note => selectedNoteIds.has(note.id));
      if (!targets.length) { toast('Select at least one note first.', 'error'); return; }
      if (!aiReady()) { toast('Add a Gemini or Groq key in NotezAi settings first.', 'error', 5200); return; }
      try {
        if (kind === 'summary') {
          const budget = aiActive() === 'groq' ? 9000 : 40000;
          const perNote = Math.max(800, Math.floor(budget / targets.length));
          const parts = [];
          for (const note of targets) {
            const text = ((await notesTextForAi(note)) || '').trim().slice(0, perNote) || '(this note has no readable text)';
            parts.push(`## ${note.title}\n${text}`);
          }
          toast(`Summarising ${targets.length} notes…`, 'success', 3000);
          const answer = await recTextCall(`Write one combined study summary of these ${targets.length} notes. Give a short section per note (use its title as the heading) with the key points, then a "Connections" section and a "To revise" list. Use only what the notes say.\n\n${parts.join('\n\n')}`, { temperature: 0.3 });
          const stamp = Date.now(), folder = currentFolderPath || 'AI summaries';
          const created = normalizeNote({ id: uid(), title: `Summary · ${targets.length} notes`, subject: folder.split('/')[0], folderPath: folder, tags: ['ai-summary'], kind: 'markdown', body: `> Written by NotezAi from: ${targets.map(note => note.title).join(', ')}\n\n${answer}`, createdAt: stamp, updatedAt: stamp, lastViewedAt: stamp });
          notes = [created, ...notes]; addFolderPath(folder); persistNote(created).catch(() => {}); renderEverything();
          toast('Summary saved as a new note.', 'success', 4500);
          openNote(created.id);
          return;
        }
        if (kind === 'tags') {
          const suggestions = [];
          for (const note of targets) {
            const text = ((await notesTextForAi(note)) || '').trim().slice(0, 3000) || note.title;
            const out = await recTextCall(`Suggest 3 to 5 short topic tags for this note. Reply with only the tags, comma separated, lowercase, no # symbols.\n\nTitle: ${note.title}\n\n${text}`, { temperature: 0 });
            const tags = String(out).split(/[,\n]/).map(tag => tag.replace(/^[#\-\s*•]+|[.\s]+$/g, '').trim().toLowerCase()).filter(tag => tag && tag.length <= 30).slice(0, 5);
            if (tags.length) suggestions.push({ note, tags });
          }
          if (!suggestions.length) { toast('No tag suggestions came back. Try again.', 'error'); return; }
          const preview = suggestions.slice(0, 12).map(item => `${item.note.title}: ${item.tags.map(tag => '#' + tag).join(' ')}`).join('\n');
          if (!(await uiConfirm({ title: `Add tags to ${suggestions.length} note${suggestions.length === 1 ? '' : 's'}?`, message: `${preview}${suggestions.length > 12 ? `\n…and ${suggestions.length - 12} more` : ''}`, confirmLabel: 'Add tags' }))) return;
          const now = Date.now();
          suggestions.forEach(({ note, tags }) => { note.tags = [...new Set([...(note.tags || []), ...tags])].slice(0, 20); note.updatedAt = now; persistNote(note).catch(() => {}); });
          renderEverything();
          toast(`Tags added to ${suggestions.length} note${suggestions.length === 1 ? '' : 's'}.`, 'success');
        }
      } catch (error) {
        console.warn('Bulk AI failed:', error);
        toast(`AI could not finish: ${aiErrorMessage(error)}`, 'error', 6500);
      }
    }
    const bulkAiCss = document.createElement('style');
    bulkAiCss.textContent = `.bulk-ai{border:1px solid color-mix(in srgb,var(--nz-accent) 45%,transparent);background:color-mix(in srgb,var(--nz-accent) 10%,transparent);color:inherit;border-radius:9px;padding:7px 11px;font:600 12px system-ui,sans-serif;cursor:pointer}.bulk-ai:hover{border-color:var(--nz-accent)}@media (max-width:760px){.bulk-ai{min-height:40px}}`;
    document.head.appendChild(bulkAiCss);
    ensureFirebase().catch(error => console.info('Firebase SDK will load when sign-in is requested:', error?.message || error));
