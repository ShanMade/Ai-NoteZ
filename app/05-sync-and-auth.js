function openNotezAi(note = null, preset = '') {
      if (note) nzai.noteId = note.id;
      nzaiOpen(note, preset);
    }
    const nzaiFab = document.createElement('button');
    nzaiFab.id = 'nzai-fab'; nzaiFab.type = 'button';
    nzaiFab.setAttribute('aria-label', 'Open NotezAi'); nzaiFab.title = 'NotezAi · chat, notes and voice recording';
    nzaiFab.innerHTML = '<span class="nzai-fab-logo" aria-hidden="true"></span>';
    document.body.appendChild(nzaiFab);
    nzaiFab.addEventListener('click', () => { if (nzai.open) nzaiClose(); else openNotezAi(currentPage === 'reader' ? notes.find(item => item.id === activeId) || null : null); });
    const nzaiFabStyle = document.createElement('style');
    nzaiFabStyle.textContent = `#nzai-fab{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:1px solid rgba(128,148,170,.25);background:#ffffff;box-shadow:0 10px 28px rgba(0,0,0,.18);display:grid;place-items:center;cursor:pointer;z-index:1550;padding:0;transition:transform .15s ease,box-shadow .15s ease}#nzai-fab:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(0,0,0,.22)}#nzai-fab:focus-visible{outline:3px solid var(--nz-accent);outline-offset:3px}html[data-theme="dark"] #nzai-fab{background:#101b29;border-color:rgba(173,194,220,.2)}.nzai-fab-logo{width:44px;height:44px;background:var(--nz-logo) center/contain no-repeat}html.nzai-open #nzai-fab{display:none}#nzai-fab[hidden]{display:none!important}`;
    document.head.appendChild(nzaiFabStyle);
    setInterval(() => { nzaiFab.hidden = !currentSession; }, 500);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nzai.open) nzaiClose();
      if (event.altKey && !event.ctrlKey && !event.metaKey && String(event.key).toLowerCase() === 'a') {
        event.preventDefault();
        if (nzai.open) return nzaiClose();
        const note = currentPage === 'reader' ? notes.find(item => item.id === activeId) : null;
        openNotezAi(note || null);
      }
    });
    document.documentElement.classList.toggle('nzai-open', false);

    // ================= NotezAi key: saved once, reused everywhere =================
    $('#ai-menu').addEventListener('click', () => { closeAccountMenu(); openNotezAi(null); });
    $('#reader-ai').addEventListener('click', () => { const note = notes.find(item => item.id === activeId); if (note) openNotezAi(note); });

    function readAloud(note) {
      if (!('speechSynthesis' in window)) { toast('Your browser does not support read aloud.', 'error'); return; }
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); toast('Stopped reading.'); return; }
      const text = String(note?.body || '').trim().slice(0, 8000);
      if (!text) { toast('This note has no text to read.', 'error'); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u0600-\u06FF]/.test(text) ? 'ur-PK' : (document.documentElement.lang || 'en-US');
      speechSynthesis.speak(utterance);
      toast('Reading aloud. Choose Read aloud again to stop.');
    }

    // ================= Weekly study plan (Home) =================
    const WEEK_KEY = 'notez-week-v1';
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DEFAULT_WEEK = [{ name: '', off: true, note: 'Rest and recharge' }, { name: 'Physics' }, { name: 'Chemistry' }, { name: 'Mathematics' }, { name: 'Biology' }, { name: 'English' }, { name: 'Revision' }];
    const cleanDay = day => ({ name: String(day?.name || '').slice(0, 40), off: Boolean(day?.off), note: String(day?.note || '').slice(0, 120) });
    function readWeek() {
      try { const saved = JSON.parse(localStorage.getItem(WEEK_KEY)); if (Array.isArray(saved) && saved.length === 7) return saved.map(cleanDay); } catch {}
      return DEFAULT_WEEK.map(cleanDay);
    }
    const dayLabel = day => day.off ? 'Off day' : (day.name || 'Free day');
    let weekRenderedFor = '';
    function renderWeekCard() {
      let card = $('#week-card');
      if (!card) { card = document.createElement('section'); card.id = 'week-card'; card.className = 'week-card'; card.setAttribute('aria-label', 'Weekly study plan'); $('.dashboard-stats').before(card); }
      const week = readWeek(), now = new Date(), d = now.getDay(), n = (d + 1) % 7;
      weekRenderedFor = now.toDateString();
      const slot = (title, index, cls) => {
        const day = week[index], start = !day.off && day.name ? subjectStartPoint(day.name) : null;
        let extra = '';
        if (start?.empty) extra = cls ? `<button type="button" class="week-start muted" data-week-start="import">No ${esc(day.name)} notes yet · import a folder</button>` : '';
        else if (start && cls) {
          const text = start.mode === 'start' ? `Start at ${start.label} · ${start.count} note${start.count === 1 ? '' : 's'}` : start.mode === 'continue' ? `Continue: ${start.note.title} · ${start.noteProgress}% read` : `All covered · revise from ${start.label}`;
          extra = `<button type="button" class="week-start" data-week-start="open" title="${esc(start.mode === 'start' ? 'Open this folder' : 'Open this note')}">▶ ${esc(text)}</button><div class="week-progress">${start.percent}% of ${esc(day.name)} covered · ${start.done} of ${start.total} notes complete</div>`;
        } else if (start) extra = `<div class="week-progress">${start.mode === 'start' ? 'Starts at' : 'Next'}: ${esc(start.label)}</div>`;
        return `<div class="week-slot ${cls}"><small>${title} · ${DAY_NAMES[index].toUpperCase()}</small><strong>${esc(dayLabel(day))}</strong><span>${esc(day.note || (day.off ? 'No study planned' : 'Study day'))}</span>${extra}</div>`;
      };
      card.innerHTML = `<div class="week-main">${slot('TODAY', d, 'today')}${slot('TOMORROW', n, '')}</div>
        <div class="week-strip">${week.map((day, i) => `<div class="week-chip ${i === d ? 'today' : ''} ${day.off ? 'off' : ''}" title="${esc(DAY_NAMES[i])}: ${esc(dayLabel(day))}">${DAY_NAMES[i].slice(0, 3)} · ${esc(day.off ? 'Off' : (day.name || '—'))}</div>`).join('')}</div>`;
    }
    function editWeek() {
      const week = readWeek();
      const rows = week.map((day, i) => `<div class="week-row"><b>${DAY_NAMES[i]}</b><input class="ai-field" data-i="${i}" data-f="name" placeholder="Subject" value="${esc(day.name)}" ${day.off ? 'disabled' : ''}><input class="ai-field" data-i="${i}" data-f="note" placeholder="Note (optional)" value="${esc(day.note)}"><label style="display:flex;gap:5px;align-items:center;white-space:nowrap"><input type="checkbox" data-i="${i}" data-f="off" ${day.off ? 'checked' : ''}> Off</label></div>`).join('');
      showModal('week-edit', 'Customize your week', `<p style="margin:0 0 12px;opacity:.8">Set a subject for each day, or mark it as an off day. It appears on your Home screen.</p>${rows}<div class="ai-actions">${modalButton('data-w="save"', 'Save', 'primary')}${modalButton('data-w="reset"', 'Reset to default')}</div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(640px,100%)';
        dialog.onchange = event => { const box = event.target.closest('[data-f="off"]'); if (box) dialog.querySelector(`[data-i="${box.dataset.i}"][data-f="name"]`).disabled = box.checked; };
        dialog.onclick = event => {
          const act = event.target.closest('[data-w]')?.dataset.w;
          if (act === 'save') {
            const next = DAY_NAMES.map((_, i) => cleanDay({ name: dialog.querySelector(`[data-i="${i}"][data-f="name"]`).value.trim(), note: dialog.querySelector(`[data-i="${i}"][data-f="note"]`).value.trim(), off: dialog.querySelector(`[data-i="${i}"][data-f="off"]`).checked }));
            try { localStorage.setItem(WEEK_KEY, JSON.stringify(next)); } catch {}
            dialog.hidden = true; renderWeekCard(); toast('Weekly plan saved.');
          } else if (act === 'reset') { try { localStorage.removeItem(WEEK_KEY); } catch {} dialog.hidden = true; renderWeekCard(); toast('Weekly plan reset.'); }
        };
      });
    }
    document.addEventListener('click', event => {
      const act = event.target.closest('#week-card [data-week]')?.dataset.week;
      if (act === 'edit') editWeek(); else if (act === 'ai') openNotezAi(null, aiReady() ? 'plan' : '');
    });
    renderWeekCard();
    setInterval(() => { if (weekRenderedFor !== new Date().toDateString()) renderWeekCard(); }, 60000);

    // ================= Undo delete, folder tools, ZIP export, study heatmap =================
    let undoTimer = null;
    const snapshotNotesForUndo = list => Promise.all(list.map(async note => ({ note: JSON.parse(JSON.stringify(note)), blob: note.fileName ? await getLocalFile(note.id).catch(() => null) : null })));
    function offerUndo(snaps, label) {
      const good = (snaps || []).filter(Boolean);
      if (!good.length) return;
      $('#nz-undo')?.remove(); clearTimeout(undoTimer);
      const bar = document.createElement('div');
      bar.id = 'nz-undo'; bar.setAttribute('role', 'status');
      const text = label ? (good.length === 1 ? label : `${good.length} notes updated`) : (good.length === 1 ? 'Note deleted' : `${good.length} notes deleted`);
      bar.innerHTML = `<span>${text}</span><button type="button" class="nz-btn primary">Undo</button>`;
      document.body.appendChild(bar);
      bar.querySelector('button').onclick = async () => { bar.remove(); clearTimeout(undoTimer); await restoreNotes(good); };
      undoTimer = setTimeout(() => bar.remove(), 10000);
    }
    async function restoreNotes(snaps) {
      removeFromTrash(snaps.map(item => item.note.id));
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      for (const { note, blob } of snaps) {
        const restored = normalizeNote({ ...note, filePath: '' });
        if (blob) { try { await storeLocalFile(restored.id, blob); } catch (error) { console.warn('Could not restore attachment:', error); } }
        if (cloudUid) setCloudDeletion(cloudUid, restored.id, null);
        notes = [restored, ...notes.filter(item => item.id !== restored.id)];
        addFolderPath(restored.folderPath);
        try { await persistNote(restored); } catch { toast('Restored on this device; sync is queued.', 'error'); }
      }
      renderEverything();
      toast(snaps.length === 1 ? 'Note restored.' : `${snaps.length} notes restored.`);
    }

    async function renameFolder(path) {
      const value = await uiPrompt({ title: 'Rename or move folder', message: 'Notes and subfolders move with it. Use / to change where it lives.', value: path, placeholder: 'Folder path', confirmLabel: 'Save', suggestions: folderSuggestions() });
      if (value == null) return;
      const next = cleanFolderPath(value);
      if (!next || next === path) return;
      if (next.startsWith(path + '/')) { toast('A folder cannot be moved inside itself.', 'error'); return; }
      const remap = value => value === path ? next : value.startsWith(path + '/') ? next + value.slice(path.length) : value;
      const affected = notes.filter(note => remap(note.folderPath || '') !== (note.folderPath || ''));
      affected.forEach(note => { note.folderPath = remap(note.folderPath); note.subject = note.folderPath.split('/')[0]; note.updatedAt += 1; });
      folders = normalizeFolderList([...(Array.isArray(folders) ? folders : []).map(remap), next]);
      persistFolderList();
      for (const note of affected) { try { await persistNote(note); } catch { /* queued for sync */ } }
      renderEverything(); openFolderPath(next);
      toast(`Folder is now “${next}” (${affected.length} note${affected.length === 1 ? '' : 's'} moved).`);
    }
    // ---- Delete a folder with everything in it, choosing what to keep ----
    function folderDeleteDialog({ path, items, notesCount, subCount, keepTarget }) {
      return new Promise(resolve => {
        const name = path.split('/').pop(), previous = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'nz-modal-overlay';
        const rows = items.map(item => `<li class="fd-row"><label><input type="checkbox" data-keep="${esc(item.key)}" aria-label="Keep ${esc(item.label)}"><span class="fd-kind">${item.kind === 'folder' ? '📁' : '📄'}</span><span class="fd-name">${esc(item.label)}</span><small>${esc(item.meta)}</small></label></li>`).join('');
        overlay.innerHTML = `<div class="nz-modal fd-modal" role="alertdialog" aria-modal="true" aria-labelledby="fd-title">
          <div class="nz-modal-head"><span class="nz-modal-icon danger" aria-hidden="true">!</span><h3 id="fd-title">Delete “${esc(name)}”?</h3></div>
          <p class="nz-modal-msg">This removes the folder with ${notesCount} note${notesCount === 1 ? '' : 's'}${subCount ? ` and ${subCount} subfolder${subCount === 1 ? '' : 's'}` : ''}. Tick anything you want to keep. Kept items move to ${keepTarget === 'General' ? '“General”' : `“${esc(keepTarget)}”`}.</p>
          ${items.length ? `<div class="fd-tools"><button type="button" class="nz-btn" data-fd="delete-all">Delete everything</button><button type="button" class="nz-btn" data-fd="keep-all">Keep everything</button></div>
          <ul class="fd-list" aria-label="Contents of this folder">${rows}</ul>` : '<p class="nz-modal-msg">This folder is empty.</p>'}
          <div class="fd-summary" id="fd-summary" role="status"></div>
          <div class="nz-modal-actions"><button type="button" class="nz-btn" data-r="cancel">Cancel</button><button type="button" class="nz-btn danger" data-r="ok" id="fd-confirm">Delete folder</button></div>
        </div>`;
        document.body.appendChild(overlay);
        const keepSet = () => new Set([...overlay.querySelectorAll('[data-keep]:checked')].map(box => box.dataset.keep));
        const refresh = () => {
          const kept = keepSet();
          const keptNotes = items.filter(item => item.kind === 'note' && kept.has(item.key)).length + items.filter(item => item.kind === 'folder' && kept.has(item.key)).reduce((sum, item) => sum + item.notes, 0);
          const keptFolders = items.filter(item => item.kind === 'folder' && kept.has(item.key)).length;
          const removedNotes = notesCount - keptNotes, removedFolders = subCount - keptFolders;
          overlay.querySelector('#fd-summary').textContent = kept.size ? `Keeping ${kept.size} item${kept.size === 1 ? '' : 's'}. Will delete ${removedNotes} note${removedNotes === 1 ? '' : 's'}${removedFolders ? ` and ${removedFolders} subfolder${removedFolders === 1 ? '' : 's'}` : ''}.` : `Will delete all ${notesCount} note${notesCount === 1 ? '' : 's'}${subCount ? ` and ${subCount} subfolder${subCount === 1 ? '' : 's'}` : ''}.`;
        };
        let closed = false;
        const close = result => { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 130); if (previous && previous.isConnected) previous.focus({ preventScroll: true }); resolve(result); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(null); } };
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(null); });
        overlay.addEventListener('click', event => {
          const fd = event.target.closest('[data-fd]')?.dataset.fd;
          if (fd === 'keep-all') overlay.querySelectorAll('[data-keep]').forEach(box => { box.checked = true; });
          if (fd === 'delete-all') overlay.querySelectorAll('[data-keep]').forEach(box => { box.checked = false; });
          if (fd) { refresh(); return; }
          const choice = event.target.closest('[data-r]')?.dataset.r;
          if (choice === 'ok') close(keepSet()); else if (choice === 'cancel') close(null);
        });
        overlay.addEventListener('change', refresh);
        refresh();
        overlay.querySelector('#fd-confirm').focus();
      });
    }
    async function deleteFolder(path) {
      const parts = path.split('/'), parent = parts.slice(0, -1).join('/'), keepTarget = parent || 'General';
      const depth = parts.length;
      const subPaths = getAllFolderPaths().filter(item => item.startsWith(path + '/'));
      const inside = notes.filter(note => note.folderPath === path || (note.folderPath || '').startsWith(path + '/'));
      const directSubs = [...new Set(subPaths.map(item => item.split('/').slice(0, depth + 1).join('/')))];
      const directNotes = notes.filter(note => note.folderPath === path);
      const items = [
        ...directSubs.map(sub => {
          const count = inside.filter(note => note.folderPath === sub || note.folderPath.startsWith(sub + '/')).length;
          const nested = subPaths.filter(item => item.startsWith(sub + '/')).length;
          return { kind: 'folder', key: 'f:' + sub, label: sub.split('/').pop(), notes: count, meta: `${count} note${count === 1 ? '' : 's'}${nested ? ` · ${nested} subfolder${nested === 1 ? '' : 's'}` : ''}`, path: sub };
        }),
        ...directNotes.map(note => ({ kind: 'note', key: 'n:' + note.id, label: note.title, meta: note.fileName ? 'File' : 'Note', id: note.id }))
      ];
      const subCount = subPaths.length;
      const keep = await folderDeleteDialog({ path, items, notesCount: inside.length, subCount, keepTarget });
      if (keep === null) return;

      // Decide each note's fate and where kept items go.
      const keptFolders = directSubs.filter(sub => keep.has('f:' + sub));
      const keptNoteIds = new Set(directNotes.filter(note => keep.has('n:' + note.id)).map(note => note.id));
      const isKeptSub = folderPath => keptFolders.some(sub => folderPath === sub || folderPath.startsWith(sub + '/'));
      const relocate = folderPath => {
        if (folderPath === path) return keepTarget;
        const rest = folderPath.slice(path.length + 1);
        return parent ? `${parent}/${rest}` : rest;
      };
      const toDelete = [], changed = [];
      for (const note of inside) {
        const keepIt = note.folderPath === path ? keptNoteIds.has(note.id) : isKeptSub(note.folderPath);
        if (!keepIt) { toDelete.push(note); continue; }
        const target = relocate(note.folderPath);
        if (target !== note.folderPath) { note.folderPath = target; note.subject = target.split('/')[0]; note.updatedAt = Date.now(); changed.push(note); }
      }
      const keptFolderPaths = subPaths.filter(item => isKeptSub(item)).map(relocate);
      const deletedFolderPaths = subPaths.filter(item => !isKeptSub(item));
      folders = normalizeFolderList([
        ...(Array.isArray(folders) ? folders : []).filter(item => item !== path && !item.startsWith(path + '/') && !deletedFolderPaths.includes(item)),
        ...keptFolderPaths,
        ...(keptNoteIds.size || changed.length ? [keepTarget] : [])
      ].filter(item => item && item !== path && !item.startsWith(path + '/')));
      if (currentFolderPath === path || currentFolderPath.startsWith(path + '/')) currentFolderPath = parent;

      // Remove the chosen notes (undoable like a single delete), keep the rest.
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      if (cloudUid && cloudSyncPromise) { try { await cloudSyncPromise; } catch {} }
      const undoSnaps = await snapshotNotesForUndo(toDelete);
      const removedIds = new Set(toDelete.map(note => note.id));
      toDelete.forEach(note => clearReaderPosition(note.id));
      notes = notes.filter(note => !removedIds.has(note.id));
      if (removedIds.has(activeId)) activeId = notes[0]?.id || '';
      for (const note of toDelete) {
        const url = objectUrlCache.get(note.id); if (url) { URL.revokeObjectURL(url); objectUrlCache.delete(note.id); }
        if (cloudUid) { setCloudDeletion(cloudUid, note.id, { filePath: note.filePath || '', deletedAt: Date.now() }); markPending(cloudUid, note.id, false); }
      }
      keepInTrash(undoSnaps);
      markFolderDeleted([path, ...deletedFolderPaths]);
      persistFolderList();
      if (cloudUid) writeCloudCache(cloudUid, notes); else localNotesWrite();
      if (currentPage === 'reader' && !notes.some(note => note.id === activeId)) currentPage = 'notes';
      renderEverything();
      for (const note of changed) { try { await persistNote(note); } catch { /* queued for sync */ } }
      if (toDelete.length) offerUndo(undoSnaps);
      else toast(`“${path.split('/').pop()}” deleted. Everything was kept and moved to “${keepTarget}”.`);
      if (toDelete.length) toast(`Deleted “${path.split('/').pop()}”: ${toDelete.length} note${toDelete.length === 1 ? '' : 's'} removed${keptNoteIds.size || keptFolders.length ? ', the rest kept' : ''}.`, 'success', 5200);
      if (cloudUid && navigator.onLine && toDelete.length) {
        try {
          const sdk = await ensureFirebase();
          for (const note of toDelete) {
            await sdk.dbRemove(sdk.dbRef(sdk.database, `users/${cloudUid}/notes/${note.id}`));
            if (note.filePath && note.filePath.includes('/files/')) await deleteCloudFile(sdk, note.filePath);
            setCloudDeletion(cloudUid, note.id, null);
          }
        } catch (error) { console.warn('Cloud deletion will retry on the next sync:', error); }
      }
    }
    const loadScriptOnce = (src, ready) => ready() ? Promise.resolve() : new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Could not load ZIP support. Are you offline?')); document.head.appendChild(el); });
    async function exportFolderZip(path) {
      const inside = path ? notes.filter(note => note.folderPath === path || (note.folderPath || '').startsWith(path + '/')) : notes.slice();
      if (!inside.length) { toast(path ? 'This folder has no notes.' : 'There are no notes to export yet.', 'error'); return; }
      try {
        await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => window.JSZip);
        const zip = new window.JSZip(), used = new Set();
        const safe = value => String(value).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120) || 'note';
        for (const [index, note] of inside.entries()) {
          nzProgress('Preparing ZIP', note.title, index / inside.length);
          let name = '', data = null;
          if (note.fileName) { data = await getLocalFile(note.id).catch(() => null); if (!data) { const attachment = await resolveAttachment(note).catch(() => null); data = attachment?.blob || null; } if (data) name = safe(note.fileName); }
          if (!data) { name = `${safe(note.title)}.md`; data = `# ${note.title}\n\n${note.body || ''}\n`; }
          const folder = note.folderPath || path || 'General';
          let full = `${folder}/${name}`, count = 1;
          while (used.has(full.toLowerCase())) full = `${folder}/${count++}_${name}`;
          used.add(full.toLowerCase()); zip.file(full, data);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = path ? `${safe(path.split('/').pop())}.zip` : `Notez-backup-${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        toast(`Exported ${inside.length} item${inside.length === 1 ? '' : 's'} to ZIP.`);
      } catch (error) { console.error(error); toast(error.message || 'Could not create the ZIP.', 'error'); }
      finally { nzProgressHide(); }
    }
    function studyHeatmapHtml() {
      let focus = {}; try { focus = JSON.parse(localStorage.getItem('notez-focus-v1'))?.days || {}; } catch {}
      const key = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const reviews = {};
      (Array.isArray(notes) ? notes : []).forEach(note => { if (note.lastReviewedAt) { const k = key(new Date(note.lastReviewedAt)); reviews[k] = (reviews[k] || 0) + 1; } });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const start = new Date(today); start.setDate(today.getDate() - today.getDay() - 77);
      const alpha = [0.1, 0.35, 0.55, 0.78, 1];
      let cells = '', active = 0;
      for (let col = 0; col < 12; col++) for (let row = 0; row < 7; row++) {
        const date = new Date(start); date.setDate(start.getDate() + col * 7 + row);
        if (date > today) { cells += '<i style="background:none"></i>'; continue; }
        const k = key(date), minutes = Number(focus[k]) || 0, count = reviews[k] || 0, score = minutes + 15 * count;
        if (score) active++;
        const level = !score ? 0 : score < 15 ? 1 : score < 45 ? 2 : score < 90 ? 3 : 4;
        cells += `<i title="${date.toDateString()}: ${minutes} min focus, ${count} review${count === 1 ? '' : 's'}" style="background:${level ? `rgba(29,143,110,${alpha[level]})` : 'rgba(128,148,170,.18)'}"></i>`;
      }
      return `<div class="nz-heat" style="display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,13px);grid-auto-columns:13px;gap:3px">${cells}</div><div style="font-size:11px;opacity:.7;margin-top:8px">${active} active day${active === 1 ? '' : 's'} · focus minutes plus reviews</div>`;
    }

    // ================= Boot splash, schedule in settings, presentation viewer =================
    (function bootSplash() {
      const root = document.documentElement, started = Date.now();
      const timer = setInterval(() => {
        if (!root.classList.contains('nz-booting')) return clearInterval(timer);
        if (currentSession || window.nzAuthNoUser || Date.now() - started > 6000) { root.classList.remove('nz-booting'); clearInterval(timer); }
      }, 60);
    })();
    $('#schedule-menu').addEventListener('click', () => { closeAccountMenu(); editWeek(); });

    const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    const isPptxNote = note => /\.pptx$/i.test(String(note?.fileName || '')) || /presentationml\.presentation/i.test(String(note?.mimeType || ''));
    async function parsePptx(blob) {
      await loadScriptOnce(JSZIP_URL, () => window.JSZip);
      const zip = await window.JSZip.loadAsync(blob);
      const readXml = async path => { const file = zip.file(path); return file ? new DOMParser().parseFromString(await file.async('string'), 'application/xml') : null; };
      const norm = path => { const out = []; for (const part of path.split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); } return out.join('/'); };
      const relsOf = async path => {
        const dir = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1), map = {};
        const doc = await readXml(`${dir}/_rels/${name}.rels`);
        if (doc) for (const rel of doc.getElementsByTagName('Relationship')) { const target = rel.getAttribute('Target') || ''; map[rel.getAttribute('Id')] = { path: target.startsWith('/') ? target.slice(1) : norm(`${dir}/${target}`), type: rel.getAttribute('Type') || '' }; }
        return map;
      };
      const pres = await readXml('ppt/presentation.xml');
      if (!pres) throw new Error('This is not a .pptx file.');
      const presRels = await relsOf('ppt/presentation.xml');
      const size = pres.getElementsByTagName('p:sldSz')[0];
      const W = Number(size?.getAttribute('cx')) || 9144000, H = Number(size?.getAttribute('cy')) || 6858000;
      const slidePaths = [...pres.getElementsByTagName('p:sldId')].map(node => presRels[node.getAttribute('r:id')]?.path).filter(Boolean);
      const theme = {}, themeDoc = await readXml('ppt/theme/theme1.xml');
      if (themeDoc) for (const tag of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) { const c = themeDoc.getElementsByTagName('a:' + tag)[0]?.firstElementChild; theme[tag] = c ? '#' + (c.getAttribute('lastClr') || c.getAttribute('val')) : ''; }
      const colorOf = (el, cmap) => {
        if (!el) return '';
        const rgb = el.getElementsByTagName('a:srgbClr')[0]; if (rgb) return '#' + rgb.getAttribute('val');
        const sch = el.getElementsByTagName('a:schemeClr')[0]; if (sch) { const v = sch.getAttribute('val'); return theme[cmap[v] || v] || ''; }
        const sys = el.getElementsByTagName('a:sysClr')[0]; return sys ? '#' + (sys.getAttribute('lastClr') || '000000') : '';
      };
      const childOf = (el, name) => el ? [...el.children].find(child => child.tagName === name) : null;
      const fillOf = (holder, cmap) => colorOf(childOf(holder, 'a:solidFill'), cmap);
      const isLight = hex => { const n = parseInt((hex || '#000000').slice(1, 7), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return 0.299 * r + 0.587 * g + 0.114 * b > 170; };
      const num = (el, attr) => Number(el?.getAttribute(attr)) || 0;
      const readXfrm = holder => {
        const x = holder && [...holder.children].find(child => child.tagName === 'a:xfrm' || child.tagName === 'p:xfrm'); if (!x) return null;
        const off = x.getElementsByTagName('a:off')[0], ext = x.getElementsByTagName('a:ext')[0], co = x.getElementsByTagName('a:chOff')[0], ce = x.getElementsByTagName('a:chExt')[0];
        return { x: num(off, 'x'), y: num(off, 'y'), cx: num(ext, 'cx'), cy: num(ext, 'cy'), cox: num(co, 'x'), coy: num(co, 'y'), cex: num(ce, 'cx'), cey: num(ce, 'cy'), rot: num(x, 'rot') / 60000 };
      };
      const phNorm = type => type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'body' : (type || 'body');
      const phGeometry = (docs, ph) => {
        for (const doc of docs) { if (!doc) continue;
          for (const sp of doc.getElementsByTagName('p:sp')) { const other = sp.getElementsByTagName('p:ph')[0]; if (!other) continue;
            if ((ph.idx != null && other.getAttribute('idx') === ph.idx) || (ph.idx == null && phNorm(other.getAttribute('type')) === phNorm(ph.type))) { const xf = readXfrm(childOf(sp, 'p:spPr')); if (xf && xf.cx) return xf; } }
          for (const sp of doc.getElementsByTagName('p:sp')) { const other = sp.getElementsByTagName('p:ph')[0]; if (other && phNorm(other.getAttribute('type')) === phNorm(ph.type)) { const xf = readXfrm(childOf(sp, 'p:spPr')); if (xf && xf.cx) return xf; } }
        }
        return null;
      };
      const mime = ext => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' })[ext];
      const pct = (value, total) => (value / total * 100).toFixed(3);
      const docCache = {};
      const cached = async path => docCache[path] || (docCache[path] = await readXml(path));
      const slides = [];
      for (const path of slidePaths) {
        const doc = await readXml(path); if (!doc) continue;
        const rels = await relsOf(path);
        const layoutPath = Object.values(rels).find(rel => /slideLayout$/.test(rel.type))?.path;
        const layout = layoutPath ? await cached(layoutPath) : null;
        const layoutRels = layoutPath ? await relsOf(layoutPath) : {};
        const masterPath = Object.values(layoutRels).find(rel => /slideMaster$/.test(rel.type))?.path;
        const master = masterPath ? await cached(masterPath) : null;
        const cmap = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
        const mapEl = master?.getElementsByTagName('p:clrMap')[0];
        if (mapEl) for (const key of ['bg1', 'tx1', 'bg2', 'tx2']) if (mapEl.getAttribute(key)) cmap[key] = mapEl.getAttribute(key);
        const textColor = theme[cmap.tx1] || '#111111';
        let bg = '';
        for (const holder of [doc, layout, master]) { const bgEl = holder?.getElementsByTagName('p:bg')[0]; const color = bgEl ? fillOf(childOf(bgEl, 'p:bgPr'), cmap) : ''; if (color) { bg = color; break; } }
        if (!bg) bg = isLight(textColor) ? '#1f2937' : (theme[cmap.bg1] || '#ffffff');
        const shapes = [], texts = [];
        const walk = async (tree, tf) => {
          for (const node of tree.children) {
            const tag = node.tagName;
            if (tag === 'p:grpSp') {
              const xf = readXfrm(childOf(node, 'p:grpSpPr'));
              if (xf && xf.cex && xf.cey) await walk(node, { ox: tf.ox + (xf.x - tf.cox) * tf.sx, oy: tf.oy + (xf.y - tf.coy) * tf.sy, cox: xf.cox, coy: xf.coy, sx: tf.sx * xf.cx / xf.cex, sy: tf.sy * xf.cy / xf.cey });
              else await walk(node, tf);
              continue;
            }
            if (!['p:sp', 'p:pic', 'p:graphicFrame'].includes(tag)) continue;
            const phEl = node.getElementsByTagName('p:ph')[0];
            const ph = phEl ? { type: phEl.getAttribute('type') || '', idx: phEl.getAttribute('idx') } : null;
            const kind = ph ? phNorm(ph.type) === 'title' ? 'title' : (ph.type === 'subTitle' ? 'subtitle' : 'body') : 'other';
            let xf = readXfrm(tag === 'p:graphicFrame' ? node : childOf(node, 'p:spPr'));
            if (!xf && ph) { const inherited = phGeometry([layout, master], ph); if (inherited) xf = { ...inherited, cox: 0, coy: 0 }; if (xf) tf = { ox: 0, oy: 0, cox: 0, coy: 0, sx: 1, sy: 1 }; }
            if (!xf || !xf.cx) continue;
            const g = { x: tf.ox + (xf.x - tf.cox) * tf.sx, y: tf.oy + (xf.y - tf.coy) * tf.sy, cx: xf.cx * tf.sx, cy: xf.cy * tf.sy };
            const box = `left:${pct(g.x, W)}%;top:${pct(g.y, H)}%;width:${pct(g.cx, W)}%;height:${pct(g.cy, H)}%;${xf.rot ? `transform:rotate(${xf.rot}deg);` : ''}`;
            if (tag === 'p:pic') {
              const rid = node.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed'), target = rels[rid]?.path, type = mime((target || '').split('.').pop().toLowerCase());
              const file = target && type ? zip.file(target) : null;
              if (file) shapes.push(`<div class="pp-box" style="${box}"><img class="pp-img" alt="" src="${URL.createObjectURL(new Blob([await file.async('uint8array')], { type }))}"></div>`);
              continue;
            }
            if (tag === 'p:graphicFrame') {
              const tbl = node.getElementsByTagName('a:tbl')[0]; if (!tbl) continue;
              const firstRow = tbl.getElementsByTagName('a:tblPr')[0]?.getAttribute('firstRow') === '1';
              const cols = [...tbl.getElementsByTagName('a:gridCol')].map(col => num(col, 'w')), colTotal = cols.reduce((a, b) => a + b, 0) || 1;
              const rows = [...tbl.getElementsByTagName('a:tr')].map((tr, r) => `<tr>${[...tr.children].filter(c => c.tagName === 'a:tc').map(tc => {
                const cellText = [...tc.getElementsByTagName('a:p')].map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')).join(' ').trim();
                const sz = num(tc.getElementsByTagName('a:rPr')[0], 'sz') / 100 || 14, fill = fillOf(childOf(tc, 'a:tcPr'), cmap);
                texts.push(cellText);
                return `<td style="font-size:${(sz * 12700 / W * 100).toFixed(3)}cqw;${r === 0 && firstRow ? 'font-weight:700;' : ''}${fill ? `background:${fill};` : ''}color:${fill && !isLight(fill) ? '#fff' : '#111'}">${esc(cellText)}</td>`;
              }).join('')}</tr>`).join('');
              shapes.push(`<div class="pp-box" style="${box}"><table class="pp-table"><colgroup>${cols.map(w => `<col style="width:${(w / colTotal * 100).toFixed(2)}%">`).join('')}</colgroup>${rows}</table></div>`);
              continue;
            }
            const spPr = childOf(node, 'p:spPr'), fill = fillOf(spPr, cmap), geom = spPr?.getElementsByTagName('a:prstGeom')[0]?.getAttribute('prst') || '';
            const tx = childOf(node, 'p:txBody');
            let inner = '';
            if (tx) {
              const bodyPr = tx.getElementsByTagName('a:bodyPr')[0];
              const fontScale = (num(bodyPr?.getElementsByTagName('a:normAutofit')[0], 'fontScale') || 100000) / 100000;
              const anchor = bodyPr?.getAttribute('anchor') || (kind === 'title' ? 'ctr' : 't');
              const pad = ['lIns', 'tIns', 'rIns', 'bIns'].map((attr, i) => (((bodyPr?.hasAttribute(attr) ? num(bodyPr, attr) : (i % 2 ? 45720 : 91440)) / W * 100).toFixed(3)) + 'cqw').join(' ');
              const base = kind === 'title' ? 44 : kind === 'subtitle' ? 28 : kind === 'body' ? 28 : 18, numbering = {}, lines = [];
              const paras = [...tx.children].filter(c => c.tagName === 'a:p').map(p => {
                const pPr = childOf(p, 'a:pPr'), lvl = num(pPr, 'lvl'), algn = pPr?.getAttribute('algn');
                let bullet = '';
                if (pPr?.getElementsByTagName('a:buChar')[0]) bullet = pPr.getElementsByTagName('a:buChar')[0].getAttribute('char') || '•';
                else if (pPr?.getElementsByTagName('a:buAutoNum')[0]) bullet = `${(numbering[lvl] = (numbering[lvl] || 0) + 1)}.`;
                else if (kind === 'body' && !pPr?.getElementsByTagName('a:buNone')[0]) bullet = '•';
                let html = '', line = '', firstSize = '';
                for (const run of p.children) {
                  if (run.tagName === 'a:br') { html += '<br>'; line += ' '; continue; }
                  if (run.tagName !== 'a:r' && run.tagName !== 'a:fld') continue;
                  const t = run.getElementsByTagName('a:t')[0]?.textContent || ''; if (!t) continue;
                  const rPr = childOf(run, 'a:rPr'), pt = ((num(rPr, 'sz') / 100) || Math.max(12, base - lvl * 4)) * fontScale;
                  const color = colorOf(childOf(rPr, 'a:solidFill'), cmap) || (fill && !isLight(fill) ? '#ffffff' : (isLight(bg) || fill ? textColor : textColor));
                  if (!firstSize) firstSize = `${(pt * 12700 / W * 100).toFixed(3)}cqw`;
                  html += `<span style="font-size:${(pt * 12700 / W * 100).toFixed(3)}cqw;color:${color};${rPr?.getAttribute('b') === '1' ? 'font-weight:700;' : ''}${rPr?.getAttribute('i') === '1' ? 'font-style:italic;' : ''}${rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none' ? 'text-decoration:underline;' : ''}">${esc(t)}</span>`; line += t;
                }
                if (!html) return '';
                lines.push(line);
                const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : ((kind === 'title' || kind === 'subtitle') && !algn ? 'center' : 'left');
                return `<p class="pp-p" style="text-align:${align};${lvl ? `margin-left:${lvl * 2.4}cqw;` : ''}">${bullet ? `<span class="pp-bullet" style="font-size:${firstSize}">${esc(bullet)}</span>` : ''}${html}</p>`;
              });
              inner = paras.join('');
              if (lines.length) texts.push(kind === 'title' ? `# ${lines.join(' ')}` : lines.join('\n'));
              if (!inner && !fill) continue;
              shapes.push(`<div class="pp-box" style="${box}padding:${pad};justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'};${fill ? `background:${fill};` : ''}${geom === 'roundRect' ? 'border-radius:1.2cqw;' : geom === 'ellipse' ? 'border-radius:50%;' : ''}">${inner}</div>`);
            } else if (fill) shapes.push(`<div class="pp-box" style="${box}background:${fill};${geom === 'ellipse' ? 'border-radius:50%;' : ''}"></div>`);
          }
        };
        const tree = doc.getElementsByTagName('p:spTree')[0];
        if (tree) await walk(tree, { ox: 0, oy: 0, cox: 0, coy: 0, sx: 1, sy: 1 });
        let notes = '';
        const notesPath = Object.values(rels).find(rel => /notesSlide$/.test(rel.type))?.path;
        if (notesPath) { const nd = await readXml(notesPath); for (const sp of nd?.getElementsByTagName('p:sp') || []) { if (sp.getElementsByTagName('p:ph')[0]?.getAttribute('type') === 'body') notes = [...sp.getElementsByTagName('a:p')].map(p => [...p.getElementsByTagName('a:t')].map(t => t.textContent).join('')).join('\n').trim(); } }
        slides.push({ html: shapes.join(''), bg, notes, text: texts.filter(Boolean).join('\n') });
      }
      const text = slides.map((slide, i) => `— Slide ${i + 1} —\n${slide.text}${slide.notes ? `\nNotes: ${slide.notes}` : ''}`).join('\n\n').trim();
      return { W, H, slides, text };
    }
    async function renderPptxViewer(note, attachment, root, id) {
      root.innerHTML = '<p class="subtle">Loading presentation…</p>';
      try {
        const blob = attachment.blob || await (await fetch(attachment.url)).blob();
        const deck = await parsePptx(blob);
        if (activeId !== id) return;
        if (!deck.slides.length) throw new Error('No slides found.');
        root.innerHTML = `<div class="pptx-bar"><b>${deck.slides.length}</b> slide${deck.slides.length === 1 ? '' : 's'} · presentation preview</div><div class="pptx-wrap">${deck.slides.map((slide, i) => `<figure class="pptx-fig"><div class="pptx-slide" style="aspect-ratio:${deck.W} / ${deck.H};background:${slide.bg}">${slide.html}</div><figcaption>Slide ${i + 1} of ${deck.slides.length}</figcaption>${slide.notes ? `<details class="pptx-notes"><summary>Speaker notes</summary><p>${esc(slide.notes)}</p></details>` : ''}</figure>`).join('')}</div>`;
      } catch (error) {
        console.warn('Presentation preview failed:', error);
        if (activeId === id) renderAttachmentCard(note, attachment.url, note.mimeType);
        toast('Could not preview this presentation. You can still download it.', 'error', 5200);
      }
    }

    // ================= Flashcards, version history, ZIP import, app lock, storage meter =================
    function parseFlashcards(text) {
      const qRe = /^\s*(?:[-*•]\s*)?(?:\*\*)?\s*(?:(?:Question|سوال)\s*\d*\s*(?:\*\*)?\s*[:：.)\-–]|Q\s*\d*\s*(?:\*\*)?\s*[:：.)])\s*(?:\*\*)?\s*(.*)$/i;
      const aRe = /^\s*(?:[-*•]\s*)?(?:\*\*)?\s*(?:(?:Answer|جواب)\s*\d*\s*(?:\*\*)?\s*[:：.)\-–]|A\s*(?:\*\*)?\s*[:：])\s*(?:\*\*)?\s*(.*)$/i;
      const cards = []; let card = null, part = 'q';
      for (const raw of String(text || '').split('\n')) {
        let m;
        if ((m = qRe.exec(raw))) { if (card && card.a) cards.push(card); card = { q: m[1].trim(), a: '' }; part = 'q'; }
        else if (card && (m = aRe.exec(raw))) { part = 'a'; card.a = m[1].trim(); }
        else if (card && raw.trim()) card[part] = (card[part] ? card[part] + '\n' : '') + raw.trim();
      }
      if (card && card.a) cards.push(card);
      return cards.map(c => ({ q: c.q.replace(/\*\*/g, '').trim(), a: c.a.replace(/\*\*/g, '').trim() })).filter(c => c.q && c.a);
    }
    // Deck study: every flashcard in a folder (and its subfolders), each keeping its own note's Leitner schedule.
    async function studyFlashcardDeck(scopePath = '') {
      const DAYS = [0, 1, 3, 7, 16, 35];
      const inScope = note => !scopePath || cleanFolderPath(note.folderPath) === scopePath || cleanFolderPath(note.folderPath).startsWith(scopePath + '/');
      const sources = notes.filter(inScope).map(note => ({ note, cards: parseFlashcards(note.body) })).filter(item => item.cards.length);
      if (!sources.length) { toast(scopePath ? `No flashcards in ${scopePath}. Add lines like “Q: …” then “A: …”.` : 'No flashcards in your library yet.', 'error', 5200); return; }
      const progressByNote = new Map();
      const keyOf = note => `notez-cards-v1-${note.id}`;
      const loadProgress = note => { if (!progressByNote.has(note.id)) { let p = {}; try { p = JSON.parse(localStorage.getItem(keyOf(note))) || {}; } catch {} progressByNote.set(note.id, p); } return progressByNote.get(note.id); };
      const saveProgress = note => { try { localStorage.setItem(keyOf(note), JSON.stringify(loadProgress(note))); } catch {} };
      const cardId = card => card.q.slice(0, 80);
      const all = sources.flatMap(item => item.cards.map(card => ({ note: item.note, card })));
      const queue = all.filter(({ note, card }) => { const pr = loadProgress(note)[cardId(card)]; return !pr || pr.due <= Date.now(); }).sort(() => Math.random() - 0.5);
      let index = 0, flipped = false, reviewed = 0;
      const title = scopePath ? `Flashcards · ${scopePath}` : 'Flashcards · library';
      const dialog = showModal('deck-dialog', title, '<div id="deck-body"></div>', d => { d.firstElementChild.style.width = 'min(560px,100%)'; });
      const body = dialog.querySelector('#deck-body');
      function render() {
        if (index >= queue.length) {
          body.innerHTML = `<p style="font-size:15px;margin:6px 0 4px"><b>${reviewed ? 'Deck complete.' : 'Nothing is due in this deck right now.'}</b></p><p style="opacity:.8;margin:0 0 14px">${reviewed} card${reviewed === 1 ? '' : 's'} reviewed across ${sources.length} note${sources.length === 1 ? '' : 's'}.</p><div class="ai-actions"><button type="button" class="nzai-primary" data-deck="close">Done</button></div>`;
          return;
        }
        const { note, card } = queue[index];
        body.innerHTML = `<div style="font-size:12px;opacity:.7;margin-bottom:8px">${esc(note.title)} · card ${index + 1} of ${queue.length}</div><div class="fc-card ${flipped ? 'back' : ''}" data-deck="flip" tabindex="0" role="button" aria-label="${flipped ? 'Answer, press space to show question' : 'Question, press space to show answer'}"><div style="font-size:11px;opacity:.6;margin-bottom:8px">${flipped ? 'Answer' : 'Question'}</div><div style="font-size:16px;line-height:1.5">${esc(flipped ? card.a : card.q)}</div></div><div class="ai-actions" style="justify-content:space-between;align-items:center"><span style="font-size:11px;opacity:.65">${flipped ? '1 = Again · 2 = Got it' : 'Space to flip'}</span><span style="display:flex;gap:8px"><button type="button" class="ai-action" data-deck="again" ${flipped ? '' : 'disabled'}>Again</button><button type="button" class="ai-action primary" data-deck="good" ${flipped ? '' : 'disabled'}>Got it</button></span></div>`;
        body.querySelector('.fc-card')?.focus();
      }
      function rate(good) {
        const { note, card } = queue[index], id = cardId(card), pr = loadProgress(note);
        const box = good ? Math.min(5, (pr[id]?.box || 0) + 1) : 0;
        pr[id] = { box, due: Date.now() + DAYS[box] * 864e5 };
        saveProgress(note);
        if (!good) queue.push(queue[index]); else reviewed++;
        index++; flipped = false; render();
      }
      dialog.onclick = event => {
        const act = event.target.closest('[data-deck]')?.dataset.deck;
        if (act === 'flip') { flipped = !flipped; render(); }
        else if (act === 'again' && flipped) rate(false);
        else if (act === 'good' && flipped) rate(true);
        else if (act === 'close') dialog.hidden = true;
      };
      dialog.onkeydown = event => {
        if (index >= queue.length) return;
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flipped = !flipped; render(); }
        else if (flipped && event.key === '1') rate(false);
        else if (flipped && event.key === '2') rate(true);
      };
      render();
    }
    async function studyFlashcards(note) {
      const cards = parseFlashcards(note.body);
      if (!cards.length) {
        if (await uiConfirm({ title: 'No flashcards found', message: 'Flashcards are read from lines like “Q: question” followed by “A: answer”. Generate them from this note with NotezAi?', confirmLabel: 'Generate' })) openNotezAi(note, 'flashcards');
        return;
      }
      const key = `notez-cards-v1-${note.id}`, cardId = card => card.q.slice(0, 80), DAYS = [0, 1, 3, 7, 16, 35];
      let progress = {}; try { progress = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
      const queue = cards.filter(card => !progress[cardId(card)] || progress[cardId(card)].due <= Date.now()).sort(() => Math.random() - 0.5);
      let index = 0, flipped = false, reviewed = 0;
      const dialog = showModal('flashcards', 'Flashcards', '<div id="fc-body"></div>', d => { d.firstElementChild.style.width = 'min(560px,100%)'; });
      const body = dialog.querySelector('#fc-body');
      function render() {
        if (index >= queue.length) {
          const dues = Object.values(progress).map(item => item.due).filter(due => due > Date.now()).sort((a, b) => a - b);
          body.innerHTML = `<p style="font-size:15px;margin:6px 0 4px"><b>${reviewed ? 'Session complete.' : 'Nothing is due right now.'}</b></p><p style="opacity:.8;margin:0 0 14px">${reviewed} card${reviewed === 1 ? '' : 's'} reviewed · ${cards.length} in this note.${dues.length ? ` Next review ${new Date(dues[0]).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}</p>${modalButton('data-close', 'Done', 'primary')}`;
          return;
        }
        body.innerHTML = `<div style="font-size:12px;opacity:.7;margin-bottom:8px">${esc(note.title)} · card ${index + 1} of ${queue.length}</div><div class="fc-card ${flipped ? 'back' : ''}" data-fc="flip" tabindex="0" role="button" aria-label="Flip card">${esc(flipped ? queue[index].a : queue[index].q)}</div>
          <div class="ai-actions" style="justify-content:space-between;align-items:center"><span style="font-size:11px;opacity:.65">${flipped ? '1 = Again · 2 = Got it' : 'Space to flip'}</span><span style="display:flex;gap:8px">${flipped ? modalButton('data-fc="again"', 'Again') + modalButton('data-fc="good"', 'Got it', 'primary') : modalButton('data-fc="flip"', 'Show answer', 'primary')}</span></div>`;
        body.querySelector('.fc-card').focus();
      }
      function rate(good) {
        const card = queue[index], id = cardId(card), box = good ? Math.min(5, (progress[id]?.box || 0) + 1) : 0;
        progress[id] = { box, due: Date.now() + DAYS[box] * 864e5 };
        try { localStorage.setItem(key, JSON.stringify(progress)); } catch {}
        if (!good) queue.push(card); else reviewed++;
        index++; flipped = false; render();
      }
      dialog.onclick = event => {
        const act = event.target.closest('[data-fc]')?.dataset.fc;
        if (act === 'flip') { flipped = !flipped; render(); } else if (act === 'again') rate(false); else if (act === 'good') rate(true);
      };
      dialog.onkeydown = event => {
        if (index >= queue.length) return;
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flipped = !flipped; render(); }
        else if (flipped && event.key === '1') rate(false); else if (flipped && event.key === '2') rate(true);
      };
      render();
    }

    const HIST_KEY = id => `notez-hist-v1-${id}`;
    const readHistory = id => { try { return JSON.parse(localStorage.getItem(HIST_KEY(id))) || []; } catch { return []; } };
    function pushHistory(id, version) {
      const list = readHistory(id);
      if ((version.body || '').length > 60000 || (list[0] && list[0].title === version.title && list[0].body === version.body)) return;
      list.unshift({ t: Date.now(), title: version.title, body: version.body });
      try { localStorage.setItem(HIST_KEY(id), JSON.stringify(list.slice(0, 12))); } catch { try { localStorage.setItem(HIST_KEY(id), JSON.stringify(list.slice(0, 3))); } catch {} }
    }
    const seenVersions = new Map();
    const seedVersions = () => (Array.isArray(notes) ? notes : []).forEach(note => { if (!seenVersions.has(note.id)) seenVersions.set(note.id, { title: note.title, body: note.body || '' }); });
    seedVersions(); setInterval(seedVersions, 3000);
    persistNote = (original => async function (note, ...rest) {
      try {
        const prev = seenVersions.get(note.id), body = note.body || '';
        if (prev && (prev.title !== note.title || prev.body !== body) && (prev.title || prev.body)) {
          const last = readHistory(note.id)[0], big = Math.abs(prev.body.length - body.length) > Math.max(200, prev.body.length * 0.2);
          if (!last || Date.now() - last.t > 90000 || big) pushHistory(note.id, prev);
        }
        seenVersions.set(note.id, { title: note.title, body });
      } catch {}
      return original.call(this, note, ...rest);
    })(persistNote);
    function showHistory(note) {
      const list = readHistory(note.id);
      const body = list.length ? list.map((version, i) => `<div class="hist-item"><b>${esc(new Date(version.t).toLocaleString())}</b> · ${(version.body || '').length.toLocaleString()} characters<small>${esc(version.title)}${version.body ? '\n' + esc(version.body.slice(0, 160)) + (version.body.length > 160 ? '…' : '') : ''}</small>${modalButton(`data-restore="${i}"`, 'Restore this version')}</div>`).join('') : '<p style="opacity:.8">No earlier versions yet. Versions are saved on this device as you edit or replace text.</p>';
      showModal('history-dialog', `Version history · ${esc(note.title)}`, `<div style="max-height:60dvh;overflow:auto">${body}</div>`, dialog => {
        dialog.onclick = async event => {
          const btn = event.target.closest('[data-restore]'); if (!btn) return;
          const version = list[Number(btn.dataset.restore)];
          pushHistory(note.id, { title: note.title, body: note.body || '' });
          note.title = version.title; note.body = version.body; note.updatedAt = Date.now();
          try { await persistNote(note); } catch { toast('Restored on this device; sync is queued.', 'error'); }
          renderEverything(); if (currentPage === 'reader') openNote(note.id);
          dialog.hidden = true; toast('Version restored.');
        };
      });
    }

    document.body.insertAdjacentHTML('beforeend', '<input id="zip-input" type="file" accept=".zip,application/zip" hidden />');
    $('#zip-input').addEventListener('change', async event => {
      const archive = event.target.files[0]; event.target.value = '';
      if (!archive) return;
      try {
        await loadScriptOnce(JSZIP_URL, () => window.JSZip);
        const zip = await window.JSZip.loadAsync(archive), entries = [];
        zip.forEach((path, entry) => { if (!entry.dir && !/(^|\/)(__MACOSX|\.[^/]*$)/.test(path)) entries.push([path, entry]); });
        if (!entries.length) { toast('This ZIP has no files to import.', 'error'); return; }
        const rootName = archive.name.replace(/\.zip$/i, '') || 'Imported ZIP', hasRoot = entries.every(([path]) => path.includes('/'));
        const files = [];
        for (const [path, entry] of entries) {
          const file = new File([await entry.async('blob')], path.split('/').pop());
          Object.defineProperty(file, 'webkitRelativePath', { value: hasRoot ? path : `${rootName}/${path}` });
          files.push(file);
        }
        const dirs = new Set(files.map(file => file.webkitRelativePath.split('/').slice(0, -1).join('/')));
        if (await uiConfirm({ title: 'Import ZIP', message: `${files.length} file${files.length === 1 ? '' : 's'} in ${dirs.size} folder${dirs.size === 1 ? '' : 's'} from “${archive.name}”. The folder structure and order are kept.`, confirmLabel: 'Import ZIP' })) importFiles(files, { folderMode: true });
      } catch (error) { console.error(error); toast(error.message || 'Could not read this ZIP file.', 'error'); }
    });

    const LOCK_KEY = 'notez-lock-v1';
    const readLock = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch { return null; } };
    const toHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    async function pinHash(pin, saltHex) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16))), iterations: 150000, hash: 'SHA-256' }, key, 256));
    }
    let failedPins = 0, lockedUntil = 0, idleTimer = null;
    const setAppInert = locked => { $('.app-shell')?.toggleAttribute('inert', locked); };
    function lockNow() {
      if (!readLock()) return;
      try { sessionStorage.removeItem('notez-unlocked'); } catch {}
      document.documentElement.classList.add('nz-locked'); setAppInert(true);
      $('#nz-lock-pin').value = ''; $('#nz-lock-msg').textContent = '';
      setTimeout(() => $('#nz-lock-pin').focus(), 60);
    }
    async function tryUnlock() {
      const lock = readLock(), pin = $('#nz-lock-pin').value, msg = $('#nz-lock-msg');
      if (!lock) { document.documentElement.classList.remove('nz-locked'); setAppInert(false); return; }
      if (Date.now() < lockedUntil) { msg.textContent = `Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`; return; }
      if (await pinHash(pin, lock.salt) === lock.hash) {
        failedPins = 0; try { sessionStorage.setItem('notez-unlocked', '1'); } catch {}
        document.documentElement.classList.remove('nz-locked'); setAppInert(false); armIdle();
      } else {
        failedPins++; $('#nz-lock-pin').value = '';
        if (failedPins >= 5) { lockedUntil = Date.now() + 30000; failedPins = 0; msg.textContent = 'Too many attempts. Wait 30 seconds.'; } else msg.textContent = 'Incorrect PIN.';
      }
    }
    function armIdle() {
      clearTimeout(idleTimer);
      const lock = readLock();
      if (lock && !document.documentElement.classList.contains('nz-locked')) idleTimer = setTimeout(lockNow, (lock.minutes || 5) * 60000);
    }
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(name => window.addEventListener(name, armIdle, { passive: true, capture: true }));
    $('#nz-lock-go').addEventListener('click', tryUnlock);
    $('#nz-lock-pin').addEventListener('keydown', event => { if (event.key === 'Enter') tryUnlock(); });
    $('#nz-lock-forgot').addEventListener('click', async () => {
      if (!(await uiConfirm({ title: 'Remove the lock?', message: 'You will be signed out and the PIN lock will be removed. Your notes stay in your account and on this device.', confirmLabel: 'Sign out', danger: true }))) return;
      try { localStorage.removeItem(LOCK_KEY); sessionStorage.removeItem('notez-unlocked'); } catch {}
      try { const sdk = await ensureFirebase(); await sdk.signOut(sdk.auth); } catch {}
      location.reload();
    });
    function showLockSettings() {
      const lock = readLock();
      if (!window.crypto?.subtle) { toast('App lock needs a secure (https) connection.', 'error'); return; }
      const minutes = [1, 5, 15, 30].map(m => `<option value="${m}" ${(lock?.minutes || 5) === m ? 'selected' : ''}>${m} min</option>`).join('');
      const field = (id, placeholder) => `<input class="ai-field" id="${id}" type="password" inputmode="numeric" autocomplete="off" placeholder="${placeholder}" style="margin-bottom:8px">`;
      const body = lock
        ? `<p style="margin:0 0 12px;opacity:.85">App lock is <b>on</b>. Notez locks itself after you are idle, and when the tab is reopened.</p><label style="font-size:12px">Lock after <select id="lock-minutes" class="ai-field" style="width:auto">${minutes}</select></label><div class="ai-actions">${modalButton('data-lock="now"', 'Lock now', 'primary')}${modalButton('data-lock="save-minutes"', 'Save timing')}</div><div style="margin-top:16px;border-top:1px solid rgba(128,148,170,.25);padding-top:12px">${field('lock-current', 'Current PIN to turn off')}${modalButton('data-lock="off"', 'Turn off app lock', 'danger')}</div><div id="lock-msg" role="status" style="margin-top:10px;min-height:18px"></div>`
        : `<p style="margin:0 0 12px;opacity:.85">Require a PIN to open Notez on this device. This protects against casual access; it is not a substitute for a device password.</p>${field('lock-pin', 'New PIN (4 to 12 digits)')}${field('lock-pin2', 'Repeat PIN')}<label style="font-size:12px">Lock after <select id="lock-minutes" class="ai-field" style="width:auto">${minutes}</select></label><div class="ai-actions">${modalButton('data-lock="on"', 'Turn on app lock', 'primary')}</div><div id="lock-msg" role="status" style="margin-top:10px;min-height:18px"></div>`;
      showModal('lock-dialog', 'App lock', body, dialog => {
        const say = text => { const el = $('#lock-msg', dialog); if (el) el.textContent = text; };
        dialog.onclick = async event => {
          const act = event.target.closest('[data-lock]')?.dataset.lock; if (!act) return;
          const mins = Number($('#lock-minutes', dialog)?.value) || 5;
          if (act === 'on') {
            const pin = $('#lock-pin', dialog).value;
            if (!/^\d{4,12}$/.test(pin)) { say('Use 4 to 12 digits.'); return; }
            if (pin !== $('#lock-pin2', dialog).value) { say('The two PINs do not match.'); return; }
            const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
            localStorage.setItem(LOCK_KEY, JSON.stringify({ salt, hash: await pinHash(pin, salt), minutes: mins }));
            try { sessionStorage.setItem('notez-unlocked', '1'); } catch {}
            armIdle(); dialog.hidden = true; toast('App lock turned on.');
          } else if (act === 'save-minutes') { localStorage.setItem(LOCK_KEY, JSON.stringify({ ...lock, minutes: mins })); armIdle(); say('Saved.'); }
          else if (act === 'now') { dialog.hidden = true; lockNow(); }
          else if (act === 'off') {
            if (await pinHash($('#lock-current', dialog).value, lock.salt) !== lock.hash) { say('That PIN is not correct.'); return; }
            localStorage.removeItem(LOCK_KEY); clearTimeout(idleTimer); dialog.hidden = true; toast('App lock turned off.');
          }
        };
      });
    }
    $('#lock-menu').addEventListener('click', () => { closeAccountMenu(); showLockSettings(); });
    if (document.documentElement.classList.contains('nz-locked')) { setAppInert(true); setTimeout(() => $('#nz-lock-pin').focus(), 100); }
    armIdle();

    function storageMeterHtml() {
      const list = Array.isArray(notes) ? notes : [];
      const files = list.reduce((sum, note) => sum + (note.fileSize || 0), 0), text = list.reduce((sum, note) => sum + (note.body || '').length + (note.htmlSource || '').length, 0);
      const cloud = currentSession?.mode === 'cloud', used = cloud ? files * 1.34 + text : files + text, limit = 1024 * 1024 * 1024, share = Math.min(100, used / limit * 100);
      return `<div style="margin:16px 0 6px;font-weight:600">Storage</div><div style="height:7px;border-radius:9px;background:rgba(128,148,170,.25);overflow:hidden"><i style="display:block;height:100%;width:${Math.max(share, 0.5).toFixed(1)}%;background:${share > 80 ? '#d9534f' : 'var(--nz-accent)'}"></i></div><div style="font-size:11px;opacity:.7;margin-top:6px">${cloud ? `About ${formatBytes(used)} of the 1 GB free database allowance (attachments are stored about a third larger).` : `${formatBytes(used)} stored on this device.`}</div>`;
    }

    // ================= Starting point for today's subject =================
    function subjectStartPoint(subject) {
      const name = String(subject || '').trim().toLowerCase();
      if (!name) return null;
      const stems = [...new Set(name.split(/\s+/).filter(token => token.length > 2).flatMap(token => [token, token.slice(0, 4), token === 'biology' ? 'bio' : token]))];
      const list = (Array.isArray(notes) ? notes : []).filter(note => { const hay = `${note.folderPath || ''} ${note.subject || ''}`.toLowerCase(); return stems.some(stem => hay.includes(stem)); });
      if (!list.length) return { empty: true };
      const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      const byFolder = new Map();
      list.forEach(note => { const folder = note.folderPath || ''; if (!byFolder.has(folder)) byFolder.set(folder, []); byFolder.get(folder).push(note); });
      const ordered = [];
      [...byFolder.keys()].sort(natural).forEach(folder => { const items = byFolder.get(folder), imported = items.every(note => note.fileName); items.sort((a, b) => imported ? b.createdAt - a.createdAt : a.createdAt - b.createdAt); ordered.push(...items); });
      const done = note => progressOf(note) >= 0.9;
      const relative = path => { const parts = String(path || '').split('/'), at = parts.findIndex(part => stems.some(stem => part.toLowerCase().includes(stem))); return parts.slice(at + 1).join(' / ') || parts[parts.length - 1] || subject; };
      const percent = Math.round(list.reduce((sum, note) => sum + progressOf(note), 0) / list.length * 100);
      const doneCount = ordered.filter(done).length;
      const touchedIdx = ordered.reduce((best, note, index) => progressOf(note) > 0 ? index : best, -1);
      if (touchedIdx < 0) { const first = ordered[0]; return { mode: 'start', folder: first.folderPath, label: relative(first.folderPath), count: ordered.filter(note => note.folderPath === first.folderPath).length, note: first, total: ordered.length, done: doneCount, percent }; }
      if (doneCount === ordered.length) return { mode: 'done', folder: ordered[0].folderPath, label: relative(ordered[0].folderPath), note: ordered[0], total: ordered.length, done: doneCount, percent };
      const current = ordered[touchedIdx];
      const next = done(current) ? ordered.slice(touchedIdx + 1).find(note => !done(note)) || ordered.find(note => !done(note)) : current;
      return { mode: 'continue', folder: next.folderPath, label: relative(next.folderPath), note: next, total: ordered.length, done: doneCount, percent, noteProgress: Math.round(progressOf(next) * 100) };
    }
    document.addEventListener('click', event => {
      const button = event.target.closest('#week-card [data-week-start]'); if (!button) return;
      if (button.dataset.weekStart === 'import') { openImportMenu(button); return; }
      const day = readWeek()[new Date().getDay()], start = subjectStartPoint(day.name);
      if (!start || start.empty) return;
      if (start.mode === 'continue') openNote(start.note.id); else openFolderPath(start.folder);
    });
    let weekSignature = '';
    setInterval(() => {
      const week = readWeek(), now = new Date(), signature = [now.toDateString(), notes.length, ...[now.getDay(), (now.getDay() + 1) % 7].map(i => { const day = week[i], info = !day.off && day.name ? subjectStartPoint(day.name) : null; return info ? `${info.mode || 'none'}:${info.folder || ''}:${info.note?.id || ''}:${info.done || 0}` : ''; })].join('|');
      if (signature !== weekSignature) { weekSignature = signature; renderWeekCard(); }
    }, 1500);

    // ================= Drag notes between folders =================
    const DRAG_TYPE = 'application/x-notez-note';
    let dragIds = [];
    document.addEventListener('dragstart', event => {
      const tile = event.target.closest && event.target.closest('[data-note-tile]');
      if (!tile) return;
      const id = tile.dataset.noteTile;
      dragIds = selectedNoteIds.has(id) && selectedNoteIds.size > 1 ? [...selectedNoteIds] : [id];
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds)); event.dataTransfer.setData('text/plain', dragIds.length + ' note(s)'); } catch {}
      tile.classList.add('nz-dragging');
      const badge = document.createElement('div');
      badge.id = 'nz-drag-count'; badge.textContent = dragIds.length === 1 ? 'Move 1 note' : `Move ${dragIds.length} notes`;
      badge.style.left = '-999px'; document.body.appendChild(badge);
      try { event.dataTransfer.setDragImage(badge, 10, 10); } catch {}
      setTimeout(() => badge.remove(), 0);
    });
    document.addEventListener('dragend', () => {
      dragIds = [];
      document.querySelectorAll('.nz-dragging').forEach(el => el.classList.remove('nz-dragging'));
      document.querySelectorAll('.nz-drop').forEach(el => el.classList.remove('nz-drop'));
    });
    const folderRowOf = target => target && target.closest ? target.closest('.folder-tree-row') : null;
    const folderPathOf = row => row?.querySelector('[data-folder-open]')?.dataset.folderOpen || '';
    document.addEventListener('dragover', event => {
      const types = [...(event.dataTransfer?.types || [])];
      if (!types.includes(DRAG_TYPE)) return;
      const row = folderRowOf(event.target);
      document.querySelectorAll('.nz-drop').forEach(el => { if (el !== row) el.classList.remove('nz-drop'); });
      if (!row) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      row.classList.add('nz-drop');
    });
    document.addEventListener('dragleave', event => {
      const row = folderRowOf(event.target);
      if (row && !row.contains(event.relatedTarget)) row.classList.remove('nz-drop');
    });
    document.addEventListener('drop', async event => {
      const types = [...(event.dataTransfer?.types || [])];
      if (!types.includes(DRAG_TYPE)) return;
      const row = folderRowOf(event.target);
      document.querySelectorAll('.nz-drop').forEach(el => el.classList.remove('nz-drop'));
      if (!row) return;
      event.preventDefault();
      const target = folderPathOf(row);
      let ids = dragIds;
      try { if (!ids.length) ids = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) || []; } catch {}
      if (!target || !ids.length) return;
      const moving = notes.filter(note => ids.includes(note.id) && note.folderPath !== target);
      if (!moving.length) { toast(`Already in “${target}”.`); return; }
      const stamp = Date.now();
      moving.forEach(note => { note.folderPath = target; note.subject = target.split('/')[0]; note.updatedAt = stamp; });
      addFolderPath(target);
      renderEverything();
      let failed = 0;
      for (const note of moving) { try { await persistNote(note); } catch { failed++; } }
      toast(`Moved ${moving.length === 1 ? `“${moving[0].title}”` : `${moving.length} notes`} to “${target}”.${failed ? ' Saved locally; sync is queued.' : ''}`, failed ? 'error' : 'success', 4200);
    });

    // ================= Trash (30 days, on this device) =================
    const TRASH_DAYS = 30;
    const trashKey = () => 'notez-trash-v1-' + (currentSession?.mode === 'cloud' ? currentSession.user.uid : 'demo');
    function readTrash() { try { const list = JSON.parse(localStorage.getItem(trashKey())); return Array.isArray(list) ? list : []; } catch { return []; } }
    function writeTrash(list) {
      try { localStorage.setItem(trashKey(), JSON.stringify(list)); return true; }
      catch { toast('Trash is full on this device, so the oldest items were dropped.', 'error', 5200); try { localStorage.setItem(trashKey(), JSON.stringify(list.slice(0, Math.max(0, list.length - 5)))); } catch {} return false; }
    }
    function keepInTrash(snaps) {
      const list = readTrash(), now = Date.now();
      (snaps || []).filter(Boolean).forEach(({ note }) => { list.unshift({ note: JSON.parse(JSON.stringify(note)), deletedAt: now }); });
      writeTrash(list.slice(0, 500));
      // Files stay on this device until the trash is emptied or the item expires.
    }
    function removeFromTrash(ids) { const drop = new Set(ids); writeTrash(readTrash().filter(item => !drop.has(item.note.id))); }
    async function purgeTrash() {
      const cutoff = Date.now() - TRASH_DAYS * 864e5, list = readTrash();
      const expired = list.filter(item => item.deletedAt < cutoff);
      if (!expired.length) return;
      for (const item of expired) { try { await removeLocalFile(item.note.id); } catch {} }
      writeTrash(list.filter(item => item.deletedAt >= cutoff));
    }
    function daysLeft(item) { return Math.max(0, Math.ceil((item.deletedAt + TRASH_DAYS * 864e5 - Date.now()) / 864e5)); }
    function showTrash() {
      const list = readTrash();
      const rows = list.length ? list.map(item => `<div class="trash-row"><div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.note.title || 'Untitled')}</b><small>${esc(item.note.folderPath || 'General')} · deleted ${new Date(item.deletedAt).toLocaleDateString()} · ${daysLeft(item)} day${daysLeft(item) === 1 ? '' : 's'} left</small></div><div class="acts">${modalButton(`data-trash-restore="${esc(item.note.id)}"`, 'Restore', 'primary')}${modalButton(`data-trash-forever="${esc(item.note.id)}"`, 'Delete', 'danger')}</div></div>`).join('') : '<p style="opacity:.8;margin:0">Trash is empty. Deleted notes stay here for 30 days.</p>';
      const dialog = showModal('trash-dialog', 'Trash', `<p style="margin:0 0 12px;opacity:.8;font-size:12px">Deleted notes are kept for ${TRASH_DAYS} days on this device, then removed automatically.</p><div style="max-height:56dvh;overflow:auto">${rows}</div>${list.length ? `<div class="ai-actions" style="margin-top:12px">${modalButton('data-trash-empty="1"', 'Empty trash', 'danger')}</div>` : ''}`, dialog => {
        dialog.firstElementChild.style.width = 'min(560px,100%)';
        dialog.onclick = async event => {
          const restore = event.target.closest('[data-trash-restore]')?.dataset.trashRestore;
          const forever = event.target.closest('[data-trash-forever]')?.dataset.trashForever;
          const empty = event.target.closest('[data-trash-empty]');
          if (restore) {
            const item = readTrash().find(entry => entry.note.id === restore); if (!item) return;
            await restoreNotes([{ note: item.note, blob: null }]);
            dialog.hidden = true; showTrash();
          } else if (forever) {
            if (!(await uiConfirm({ title: 'Delete forever?', message: 'This note and its file are removed from this device. It cannot be recovered.', confirmLabel: 'Delete forever', danger: true }))) return;
            await removeLocalFile(forever).catch(() => {});
            removeFromTrash([forever]); dialog.hidden = true; showTrash(); toast('Deleted forever.');
          } else if (empty) {
            if (!(await uiConfirm({ title: 'Empty trash?', message: 'Every item in the trash is removed from this device. This cannot be undone.', confirmLabel: 'Empty trash', danger: true }))) return;
            for (const item of readTrash()) { try { await removeLocalFile(item.note.id); } catch {} }
            writeTrash([]); dialog.hidden = true; toast('Trash emptied.');
          }
        };
      });
    }
    $('#trash-menu').addEventListener('click', () => { closeAccountMenu(); showTrash(); });
    $('#export-all-menu').addEventListener('click', () => { closeAccountMenu(); exportFolderZip(''); });
    setTimeout(() => { purgeTrash(); }, 6000);

    // ================= New note templates =================
    const NOTE_TEMPLATES = [
      { id: 'blank', name: 'Blank note', hint: 'Start from scratch', title: '', body: '' },
      { id: 'qa', name: 'Q&A revision', hint: 'Questions with answers', title: 'Q&A revision', body: 'Q1: \nA1: \n\nQ2: \nA2: \n\nQ3: \nA3: \n' },
      { id: 'mcq', name: 'MCQ set', hint: 'Options and the answer', title: 'MCQ practice', body: 'Q1. \na) \nb) \nc) \nd) \nAnswer: \n\nQ2. \na) \nb) \nc) \nd) \nAnswer: \n' },
      { id: 'cornell', name: 'Cornell notes', hint: 'Cues, notes and summary', title: 'Cornell notes', body: 'Topic: \nDate: \n\nCUES\n- \n\nNOTES\n- \n\nSUMMARY\n' },
      { id: 'lecture', name: 'Lecture outline', hint: 'Ideas, examples, questions', title: 'Lecture outline', body: '# Topic\n\n## Key ideas\n- \n\n## Examples\n- \n\n## Questions\n- \n' },
      { id: 'formula', name: 'Formula sheet', hint: 'Formula, use and example', title: 'Formula sheet', body: '## Formula name\nFormula: \nWhen to use: \nExample: \n' },
      { id: 'vocab', name: 'Vocabulary list', hint: 'Word, meaning, example', title: 'Vocabulary', body: 'Word | Meaning | Example\n-----|---------|--------\n' }
    ];
    function pickTemplate() {
      const cards = NOTE_TEMPLATES.map(item => `<button type="button" class="tpl-card" data-tpl="${item.id}"><b>${esc(item.name)}</b><small>${esc(item.hint)}</small></button>`).join('');
      const dialog = showModal('template-dialog', 'New note', `<p style="margin:0 0 12px;opacity:.8;font-size:12px">Pick a starting point. You can change everything later.</p><div class="tpl-grid">${cards}</div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(520px,100%)';
        dialog.onclick = event => {
          const id = event.target.closest('[data-tpl]')?.dataset.tpl; if (!id) return;
          const template = NOTE_TEMPLATES.find(item => item.id === id);
          dialog.hidden = true;
          openEditor();
          if (template && id !== 'blank') {
            const title = $('#note-title-input'), body = $('#note-body-input');
            if (!title.value.trim()) title.value = template.title;
            if (!body.value.trim()) { body.value = template.body; body.dispatchEvent(new Event('input', { bubbles: true })); }
            body.focus(); body.setSelectionRange(body.value.length, body.value.length);
          }
        };
      });
    }

    // ================= Pinning, priority, bookmarks =================
    function setNoteFields(note, patch, message, { undoLabel = '' } = {}) {
      const before = { ...note };
      Object.assign(note, patch); note.updatedAt = Date.now();
      persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything(); toast(message || 'Saved.');
      if (undoLabel) offerUndo([{ note: before, blob: null }], undoLabel);
    }
    function decorateNoteBadges() {
      // Badges go inside the grid card's content column only. Spotlight, rows and Home cards are left alone.
      document.querySelectorAll('.nz-badges').forEach(row => { if (!row.parentElement?.matches('#list-view .note-tile-main')) row.remove(); });
      document.querySelectorAll('#list-view .note-tile-main').forEach(main => {
        const tile = main.closest('[data-note-tile]'); if (!tile) return;
        const note = notes.find(item => item.id === tile.dataset.noteTile);
        const parts = [];
        if (note?.pinned) parts.push('<span class="nz-badge pin">Pinned</span>');
        const pct = note ? Math.round(progressOf(note) * 100) : 0;
        if (note && pct >= 90) parts.push('<span class="nz-badge done">Covered</span>');
        else if (note && pct > 0) parts.push(`<span class="nz-badge read">${pct}% read</span>`);
        if (note?.priority) parts.push(`<span class="nz-badge ${note.priority}">${note.priority === 'high' ? 'High' : note.priority === 'medium' ? 'Medium' : 'Low'}</span>`);
        (note?.tags || []).slice(0, 3).forEach(tag => parts.push(`<span class="nz-tag" role="link" tabindex="0" data-tagfilter="${esc(tag)}" title="Show notes tagged ${esc(tag)}">#${esc(tag)}</span>`));
        const wanted = parts.join(''), current = main.querySelector(':scope > .nz-badges');
        if ((current?.innerHTML || '') === wanted) return;
        current?.remove();
        if (wanted) main.insertAdjacentHTML('afterbegin', `<div class="nz-badges">${wanted}</div>`);
      });
    }
    const badgeObserver = new MutationObserver(() => { clearTimeout(badgeObserver.t); badgeObserver.t = setTimeout(decorateNoteBadges, 0); });
    badgeObserver.observe(document.getElementById('list-view') || document.body, { childList: true, subtree: true });
    badgeObserver.observe(document.getElementById('home-view') || document.body, { childList: true, subtree: true });

    function addBookmark(note) {
      const view = $('#workspace-main'), max = Math.max(1, view.scrollHeight - view.clientHeight);
      const pos = Math.max(0, Math.min(1, view.scrollTop / max));
      uiPrompt({ title: 'Add bookmark', message: 'Bookmarks save this place in the note. Jump back to it any time.', value: `Bookmark ${(note.bookmarks || []).length + 1}`, placeholder: 'Bookmark name', confirmLabel: 'Save bookmark' }).then(label => {
        if (label == null) return;
        const list = (note.bookmarks || []).slice(-29);
        list.push({ id: uid(), label: label.trim() || 'Bookmark', pos, t: Date.now() });
        setNoteFields(note, { bookmarks: list }, 'Bookmark saved.');
      });
    }
    function jumpToBookmark(item) {
      const view = $('#workspace-main'); if (!view) return;
      view.scrollTo({ top: item.pos * Math.max(0, view.scrollHeight - view.clientHeight), behavior: 'smooth' });
    }
    function showBookmarks(note) {
      const list = note.bookmarks || [];
      const rows = list.length ? list.map(item => `<div class="bm-row"><div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.label)}</b><small>${Math.round(item.pos * 100)}% through · saved ${new Date(item.t).toLocaleDateString()}</small></div><div class="acts">${modalButton(`data-bm-go="${esc(item.id)}"`, 'Jump', 'primary')}${modalButton(`data-bm-del="${esc(item.id)}"`, 'Remove', 'danger')}</div></div>`).join('') : '<p style="opacity:.8;margin:0">No bookmarks yet. Open a note and use ⋯ → Add bookmark here.</p>';
      showModal('bookmark-dialog', `Bookmarks · ${esc(note.title)}`, `<div style="max-height:56dvh;overflow:auto">${rows}</div>`, dialog => {
        dialog.onclick = event => {
          const go = event.target.closest('[data-bm-go]')?.dataset.bmGo, del = event.target.closest('[data-bm-del]')?.dataset.bmDel;
          if (go) { const item = list.find(entry => entry.id === go); dialog.hidden = true; if (currentPage !== 'reader') openNote(note.id); setTimeout(() => jumpToBookmark(item), 250); }
          if (del) { setNoteFields(note, { bookmarks: list.filter(entry => entry.id !== del) }, 'Bookmark removed.'); dialog.hidden = true; showBookmarks(note); }
        };
      });
    }

    // ================= Text PDF → Markdown with NotezAi, verified word-for-word =================
    const nzWords = text => (String(text || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    function verifyMarkdownAgainstSource(sourceChunk, markdown) {
      const source = nzWords(String(sourceChunk).replace(/^\s*—\s*Page\s+\d+\s*—\s*$/gm, ''));
      const output = nzWords(String(markdown).replace(/^\s*#{1,6}\s*Page\s+\d+\s*$/gim, ''));
      if (!source.length) return { ok: false, reason: 'no source words' };
      const count = list => { const map = new Map(); list.forEach(word => map.set(word, (map.get(word) || 0) + 1)); return map; };
      const cs = count(source), co = count(output);
      let missing = 0, extra = 0;
      cs.forEach((n, word) => { missing += Math.max(0, n - (co.get(word) || 0)); });
      co.forEach((n, word) => { extra += Math.max(0, n - (cs.get(word) || 0)); });
      const pairs = list => { const set = new Set(); for (let i = 0; i < list.length - 1; i++) set.add(list[i] + ' ' + list[i + 1]); return set; };
      const ps = pairs(source), po = pairs(output); let hit = 0; ps.forEach(pair => { if (po.has(pair)) hit++; });
      const wordsKept = 1 - missing / source.length, extraRate = extra / source.length, orderKept = ps.size ? hit / ps.size : 1;
      // Strict: every source word must be present in the right order, with essentially nothing added.
      const ok = missing === 0 && extraRate <= 0.002 && orderKept >= 0.995;
      return { ok, wordsKept, extraRate, orderKept, missing, extra, source: source.length };
    }
    function plainSectionMarkdown(chunk) {
      return chunk.split(/\n(?=— Page \d+ —\n)/).map(part => part.replace(/^— Page (\d+) —\n/, (_, n) => `### Page ${n}\n\n`)).join('\n\n').trim();
    }
    async function convertPdfPagesToMarkdown(pageTexts, onProgress) {
      const limit = aiActive() === 'groq' ? 4500 : 12000;
      const sections = []; let current = [], size = 0;
      pageTexts.forEach((text, index) => {
        const piece = `— Page ${index + 1} —\n${text}`;
        if (size + piece.length > limit && current.length) { sections.push(current.join('\n\n')); current = []; size = 0; }
        current.push(piece); size += piece.length;
      });
      if (current.length) sections.push(current.join('\n\n'));
      const parts = []; let verified = 0;
      for (let i = 0; i < sections.length; i++) {
        onProgress?.(i + 1, sections.length);
        const chunk = sections[i];
        const prompt = `Convert the text below, which was extracted from a PDF, into clean Markdown.
Rules you must follow exactly:
- Keep every word, number, symbol and punctuation mark, in the same order, exactly as written. Do not correct, translate, summarise, reword or add anything.
- Delete only the page marker lines that look like "— Page N —".
- Only add Markdown structure: headings, bullet or numbered lists, bold for labels, tables for tabular data, and code blocks for formulas or code.
- Keep the original language and script (Urdu, Arabic, English and so on), including right-to-left text.
- Output only the Markdown, with no explanation and no code fence around it.

TEXT:
${chunk}`;
        let markdown = '';
        try {
          const answer = await aiGenerate(prompt, { temperature: 0 });
          markdown = answer.text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        } catch (error) { console.warn('Section conversion failed:', error); }
        const check = markdown ? verifyMarkdownAgainstSource(chunk, markdown) : { ok: false };
        if (check.ok) { verified++; parts.push(markdown); }
        else parts.push(plainSectionMarkdown(chunk));   // exact extracted text, never unverified AI output
      }
      onProgress?.(sections.length, sections.length);
      return { markdown: parts.join('\n\n'), verifiedSections: verified, totalSections: sections.length };
    }

    // ================= Scanned PDF → Markdown (AI reads page images) =================
    function bytesToBase64(bytes) {
      let binary = ''; const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      return btoa(binary);
    }
    async function ocrPagesToMarkdown(pageImages, onProgress) {
      const parts = []; const failed = [];
      for (let i = 0; i < pageImages.length; i++) {
        onProgress?.(i + 1, pageImages.length);
        const prompt = `Transcribe this scanned page into Markdown.
Rules:
- Copy every word, number and symbol exactly as printed, in reading order. Do not correct spelling, translate, summarise or add anything.
- Keep the original language and script (Urdu, Arabic, English and so on), including right-to-left text.
- Use headings, lists and tables only where the page clearly has them.
- Write [unclear] for any word you cannot read.
- Output only the Markdown, with no explanation and no code fence.`;
        try {
          const answer = await aiGenerate(prompt, { temperature: 0, images: [{ mime: 'image/jpeg', data: bytesToBase64(pageImages[i]) }] });
          const text = answer.text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          parts.push(`### Page ${i + 1}\n\n${text}`);
        } catch (error) {
          console.warn('Page transcription failed:', error); failed.push(i + 1);
          parts.push(`### Page ${i + 1}\n\n*[Not transcribed: ${aiErrorMessage(error)}]*`);
        }
      }
      onProgress?.(pageImages.length, pageImages.length);
      return { markdown: parts.join('\n\n'), failed };
    }

    // ================= Clean up empty folders (never touches notes) =================
    const inFolderTree = (path, root) => path === root || path.startsWith(root + '/');
    function emptyFolderRoots() {
      const all = getAllFolderPaths();
      const hasNotes = path => notes.some(note => inFolderTree(note.folderPath || '', path));
      const empty = all.filter(path => !hasNotes(path));
      return empty.filter(path => !empty.some(other => other !== path && inFolderTree(path, other)));
    }
    async function cleanEmptyFolders() {
      const roots = emptyFolderRoots();
      if (!roots.length) { toast('No empty folders. Every folder holds at least one note.'); return; }
      const all = getAllFolderPaths(), affected = all.filter(path => roots.some(root => inFolderTree(path, root)));
      const names = roots.slice(0, 12).join(' · ') + (roots.length > 12 ? ` · and ${roots.length - 12} more` : '');
      if (!(await uiConfirm({ title: `Delete ${roots.length} empty folder${roots.length === 1 ? '' : 's'}?`, message: `${affected.length} folder${affected.length === 1 ? '' : 's'} in total. None contains a note, so no notes are touched. ${names}`, confirmLabel: 'Delete empty folders', danger: true }))) return;
      folders = normalizeFolderList((Array.isArray(folders) ? folders : []).filter(path => !roots.some(root => inFolderTree(path, root))));
      markFolderDeleted(affected);
      if (roots.some(root => inFolderTree(currentFolderPath || '', root))) currentFolderPath = '';
      persistFolderList();
      renderEverything();
      toast(`Deleted ${affected.length} empty folder${affected.length === 1 ? '' : 's'}.`, 'success', 5000);
    }
    $('#cleanup-folders-menu').addEventListener('click', () => { closeAccountMenu(); cleanEmptyFolders(); });
    $('#dup-menu').addEventListener('click', () => { closeAccountMenu(); showDuplicates(); });
    const CLEANUP_INTENT = /(empty|unused|blank|unnecessary|extra)\s+folders?|folders?\s+(that\s+are\s+|which\s+are\s+)?(empty|unused)|(delete|remove|clean|clear)\s+(up\s+)?(the\s+)?(empty\s+)?folders?/i;

    // ================= Smart features that work offline =================
    const SMART_STOP = new Set(('the and for are but not you your with this that from have has was were will would can could about into over under than then them they their there here what when where which who whom why how also more most some such only other each any all its it is of to in on at by as be an a or if so do does did one two use used using via per our out just like very'.split(' ')));
    function suggestLocalTags(note) {
      const text = `${note.title} ${note.body || ''}`.toLowerCase().normalize('NFC');
      const counts = new Map();
      (text.match(/[\p{L}\p{N}]{4,}/gu) || []).forEach(word => { if (!SMART_STOP.has(word) && !/^\d+$/.test(word)) counts.set(word, (counts.get(word) || 0) + 1); });
      return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([word]) => word);
    }
    function duplicateGroups() {
      const keyTitle = note => (note.title || '').toLowerCase().replace(/\s*\(copy\)$/, '').replace(/[^\p{L}\p{N}]+/gu, '');
      const keyBody = note => (note.body || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 400);
      const groups = new Map();
      notes.forEach(note => {
        const key = keyBody(note).length >= 80 ? 'body:' + keyBody(note) : (keyTitle(note) ? 'title:' + keyTitle(note) + ':' + (note.fileSize || 0) : '');
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(note);
      });
      const isCopy = note => /\(copy\)\s*$/i.test(note.title || '');
      return [...groups.values()].filter(group => group.length > 1).map(group => group.sort((a, b) => (isCopy(a) - isCopy(b)) || (b.updatedAt - a.updatedAt)));
    }
    function showDuplicates() {
      const groups = duplicateGroups();
      const body = groups.length
        ? groups.map((group, gi) => `<div class="dup-group"><b>${group.length} similar notes</b><small>Keeps the newest by default. Unticked copies go to Trash.</small>${group.map((note, i) => `<label class="dup-row"><input type="checkbox" data-dup="${esc(note.id)}" ${i === 0 ? '' : 'checked'}><span>${esc(note.title)}<small>${esc(note.folderPath || 'General')} · ${new Date(note.updatedAt).toLocaleDateString()}</small></span></label>`).join('')}</div>`).join('')
        : '<p style="opacity:.8;margin:0">No duplicates found. Notes with the same text or title in the same size are grouped here.</p>';
      showModal('dup-dialog', 'Duplicate notes', `<div style="max-height:58dvh;overflow:auto">${body}</div>${groups.length ? `<div class="ai-actions" style="margin-top:12px">${modalButton('data-dup-go="1"', 'Move selected copies to Trash', 'danger')}</div>` : ''}`, dialog => {
        dialog.firstElementChild.style.width = 'min(560px,100%)';
        dialog.onclick = async event => {
          if (!event.target.closest('[data-dup-go]')) return;
          const ids = [...dialog.querySelectorAll('[data-dup]:checked')].map(box => box.dataset.dup);
          const targets = notes.filter(note => ids.includes(note.id));
          if (!targets.length) return toast('Nothing selected.', 'error');
          if (!(await uiConfirm({ title: `Move ${targets.length} cop${targets.length === 1 ? 'y' : 'ies'} to Trash?`, message: 'You can restore them from Trash for 30 days.', confirmLabel: 'Move to Trash', danger: true }))) return;
          const snaps = await snapshotNotesForUndo(targets);
          const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
          const drop = new Set(ids);
          notes = notes.filter(note => !drop.has(note.id));
          targets.forEach(note => { if (cloudUid) { setCloudDeletion(cloudUid, note.id, { filePath: note.filePath || '', deletedAt: Date.now() }); markPending(cloudUid, note.id, false); } });
          keepInTrash(snaps);
          if (cloudUid) writeCloudCache(cloudUid, notes); else localNotesWrite();
          dialog.hidden = true; renderEverything(); offerUndo(snaps);
        };
      });
    }

    // ================= Note links, backlinks, print / save as PDF =================
    const foldTitle = value => String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    function noteByTitle(title) { const key = foldTitle(title); return notes.find(note => foldTitle(note.title) === key) || null; }
    function backlinksFor(note) {
      const key = foldTitle(note.title);
      return notes.filter(item => item.id !== note.id && (item.body || '').includes('[[')).filter(item => {
        const links = [...(item.body || '').matchAll(/\[\[([^\[\]\n]{1,120})\]\]/g)].map(match => foldTitle(match[1]));
        return links.includes(key);
      });
    }
    function showBacklinks(note) {
      const list = backlinksFor(note);
      const rows = list.length ? list.map(item => `<div class="bm-row"><div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.title)}</b><small>${esc(item.folderPath || 'General')}</small></div><div class="acts">${modalButton(`data-bl-open="${esc(item.id)}"`, 'Open', 'primary')}</div></div>`).join('') : `<p style="opacity:.8;margin:0">No notes link to “${esc(note.title)}” yet. Write [[${esc(note.title)}]] in another note to link them.</p>`;
      const dialog = showModal('backlinks-dialog', `Linked from · ${esc(note.title)}`, `<div style="max-height:56dvh;overflow:auto">${rows}</div>`, dialog => {
        dialog.onclick = event => { const id = event.target.closest('[data-bl-open]')?.dataset.blOpen; if (id) { dialog.hidden = true; openNote(id); } };
      });
    }
