function noteRowMarkup(note, dateMode = 'updated') {
      const iconName = ['note','markdown','html','text','pdf','image','audio','video','file'].includes(note.kind) ? note.kind : 'file';
      const location = cleanFolderPath(note.folderPath) || 'Unfiled';
      const dateLabel = dateMode === 'opened' ? 'Opened' : 'Updated';
      const date = timeText(dateMode === 'opened' ? note.lastViewedAt : note.updatedAt);
      const selected = selectedNoteIds.has(note.id);
      const reviewMeta = isReviewDue(note) ? 'Review due' : isNewNote(note) ? 'New to study' : note.reviewDueAt ? `Review ${reviewDueLabel(note)}` : note.completed ? 'Reviewed' : '';
      return `<article class="note-row ${selectionMode ? 'selecting' : ''} ${selected ? 'selected' : ''}" data-note-tile="${esc(note.id)}">
        ${selectionMode ? `<button type="button" class="note-row-select" data-select-id="${esc(note.id)}" aria-label="${selected ? 'Deselect' : 'Select'} ${esc(note.title)}" aria-pressed="${selected}"><span class="selection-mark">${selected ? svgIcon('check',11) : ''}</span></button>` : ''}
        <button type="button" class="note-row-open" data-note-open="${esc(note.id)}" aria-label="Open ${esc(note.title)}">
          <span class="file-symbol note-row-symbol">${svgIcon(iconName,17)}</span>
          <span class="note-row-copy"><strong>${esc(note.title)}</strong><span>${esc(location)} <i>·</i> ${esc(kindLabel(note.kind))}${reviewMeta ? ` <i>·</i> ${esc(reviewMeta)}` : ''}</span></span>
        </button>
        <span class="note-row-date">${dateLabel} ${esc(date)}</span>
        <div class="note-row-actions"><button type="button" class="note-row-star ${note.favorite ? 'is-starred' : ''}" data-star-id="${esc(note.id)}" aria-label="${note.favorite ? 'Remove from starred' : 'Add to starred'}" title="${note.favorite ? 'Remove from starred' : 'Add to starred'}">${svgIcon('star',14)}</button><button type="button" class="note-row-menu" data-note-menu="${esc(note.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(note.title)}" title="More note actions">${svgIcon('more',14)}</button></div>
      </article>`;
    }
    function renderFolderTree() {
      const root = $('#folder-tree');
      const paths = getAllFolderPaths();
      $('#folder-sidebar-count').textContent = `${paths.length} ${paths.length === 1 ? 'folder' : 'folders'}`;
      if (!folderTreeInitialized) {
        folderTreeInitialized = true;
      }
      const childMap = new Map();
      for (const path of paths) {
        const parts = path.split('/');
        const child = parts.pop();
        const parent = parts.join('/');
        if (!childMap.has(parent)) childMap.set(parent, []);
        childMap.get(parent).push(parent ? `${parent}/${child}` : child);
      }
      const draw = (parent, depth = 0) => (childMap.get(parent) || []).map(path => {
        const children = childMap.get(path) || [];
        const expanded = expandedFolders.has(path);
        const name = path.split('/').pop();
        const count = folderNoteCount(path, true);
        return `<div class="folder-tree-node" style="--folder-indent:${Math.min(depth,8) * 9}px">
          <div class="folder-tree-row ${currentFolderPath === path ? 'active' : ''}">
            ${children.length ? `<button type="button" class="folder-disclosure ${expanded ? 'expanded' : ''}" data-folder-toggle="${esc(path)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${esc(name)}">›</button>` : '<span class="folder-disclosure-spacer"></span>'}
            <button type="button" class="folder-tree-link" data-folder-open="${esc(path)}" title="${esc(path)}">${svgIcon('folder',14)}<span>${esc(name)}</span><small>${count || ''}</small></button>
            <button type="button" class="folder-tree-more" data-folder-menu="${esc(path)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(name)}" title="Folder actions">${svgIcon('more',13)}</button>
          </div>
          ${children.length && expanded ? `<div class="folder-tree-children">${draw(path, depth + 1)}</div>` : ''}
        </div>`;
      }).join('');
      root.innerHTML = paths.length ? draw('') : '<div class="folder-tree-empty">Folders you create will appear here.</div>';
    }
    function updateStudyLaunchCard(dueNotes = notes.filter(note => isReviewDue(note))) {
      const dueCount = dueNotes.length;
      const newCount = notes.filter(note => isNewNote(note)).length;
      const newAvailable = Math.min(newCount, newNotesRemainingToday());
      const sessionCount = dueCount + newAvailable;
      $('#stat-review-count').textContent = dueCount.toLocaleString();
      $('#study-launch-count').textContent = dueCount && newAvailable ? `${dueCount} due · ${newAvailable} new available` : dueCount ? `${dueCount} ${dueCount === 1 ? 'note' : 'notes'} due for review` : newAvailable ? `${newAvailable} new ${newAvailable === 1 ? 'note' : 'notes'} available today` : newCount ? 'Daily new-note limit reached' : 'No notes due right now';
      $('#study-launch-hint').textContent = dueCount && newAvailable ? 'Review what is due, then add a small daily batch of new notes.' : dueCount ? 'Rate your recall and let a gentle schedule bring each idea back.' : newAvailable ? `Build recall with a small batch; up to ${NEW_NOTES_PER_DAY} new notes are introduced each day on this device.` : newCount ? 'You’ve reached today’s on-device new-note limit. Due reviews remain available.' : 'You’re all caught up. New notes will be introduced in a small daily batch.';
      $('#start-study-session').disabled = !sessionCount;
      $('#start-study-session').querySelector('span').textContent = sessionCount ? 'Start a study session' : newCount ? 'Come back tomorrow' : 'All caught up';
    }
    function renderHomeDashboard() {
      const allPaths = getAllFolderPaths();
      const dueNotes = notes.filter(note => isReviewDue(note));
      $('#stat-note-count').textContent = notes.length.toLocaleString();
      $('#stat-folder-count').textContent = allPaths.length.toLocaleString();
      updateStudyLaunchCard(dueNotes);
      $('#stat-star-count').textContent = notes.filter(note => note.favorite).length.toLocaleString();
      const displayName = currentSession?.user?.displayName || currentSession?.user?.email?.split('@')[0] || '';
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      $('#home-greeting').textContent = displayName ? `${greeting}, ${displayName.split(/[\s._-]/)[0]}.` : 'Your learning, organized.';
      const recent = [...notes].filter(note => Number(note.lastViewedAt) > 0).sort((a,b) => Number(b.lastViewedAt) - Number(a.lastViewedAt));
      const spotlightIsResume = Boolean(recent[0]);
      const spotlight = recent[0] || [...notes].sort((a,b) => b.updatedAt - a.updatedAt)[0];
      if (spotlight) {
        const excerpt = String(spotlight.body || '').replace(/<[^>]*>/g, ' ').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
        $('#home-spotlight').innerHTML = `<article class="spotlight-card" data-note-tile="${esc(spotlight.id)}">
          <div class="spotlight-art" aria-hidden="true"><span class="spotlight-art-overline">NOTEZ · STUDY SPACE</span><div class="spotlight-art-sheet"><i></i><i></i><i></i><b></b></div><span class="spotlight-art-type">${esc(kindLabel(spotlight.kind))}</span></div>
          <div class="spotlight-content"><div class="spotlight-kicker"><i></i> ${spotlightIsResume ? 'PICK UP WHERE YOU LEFT OFF' : 'START READING'}</div><h2>${esc(spotlight.title)}</h2><div class="spotlight-meta"><span>${svgIcon('folder',13)} ${esc(spotlight.folderPath || spotlight.subject || 'Unfiled')}</span><i></i><span>${spotlightIsResume ? 'Last opened' : 'Added'} ${esc(timeText(spotlightIsResume ? spotlight.lastViewedAt : spotlight.updatedAt))}</span></div><p>${esc(excerpt.slice(0,190) || (spotlight.fileName ? `Open your ${kindLabel(spotlight.kind).toLowerCase()} attachment and continue studying.` : spotlightIsResume ? 'Open this note and continue where you left off.' : 'Open this note to start reading. We’ll keep your place for next time.'))}</p><button type="button" class="spotlight-open" data-note-open="${esc(spotlight.id)}">${spotlightIsResume ? 'Continue studying' : 'Start reading'} <span>→</span></button><button type="button" class="spotlight-menu" data-note-menu="${esc(spotlight.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(spotlight.title)}" title="Note actions">${svgIcon('more',14)}</button></div>
          <div class="spotlight-side"><span class="spotlight-side-mark">↗</span><span>${spotlight.completed ? 'REVIEWED' : 'READY WHEN YOU ARE'}</span></div>
        </article>`;
      } else {
        $('#home-spotlight').innerHTML = `<div class="spotlight-empty"><div class="spotlight-empty-icon">${svgIcon('note',22)}</div><div><span class="spotlight-kicker">A FRESH PAGE</span><strong>Your next big idea starts here.</strong><small>Create a study note or import a class file, and we’ll keep everything organized.</small></div><button type="button" class="spotlight-open" id="spotlight-create-note">Create a note <span>→</span></button></div>`;
      }
      const supportingRecent = spotlightIsResume ? recent.slice(1,4) : [];
      $('#home-recent-grid').innerHTML = supportingRecent.length ? supportingRecent.map(note => noteCardMarkup(note, true, 'opened')).join('') : `<div class="dashboard-empty compact-empty"><span class="empty-mark">◷</span><strong>${spotlightIsResume ? 'More recently opened notes will appear here.' : notes.length ? 'Your reading history starts with one open.' : 'Your recent notes will appear here.'}</strong><span>${spotlightIsResume ? 'Open another note to build your recent list.' : notes.length ? 'Open a note to save your place for next time.' : 'Create or import a note, then open it to start your history.'}</span></div>`;
      const rootFolders = allPaths.filter(path => !path.includes('/')).sort((a, b) => {
        if (homeFolderSort === 'notes') return folderNoteCount(b, true) - folderNoteCount(a, true) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        if (homeFolderSort === 'updated') return (latestNoteTime(b) - latestNoteTime(a)) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
      ensureHomeFolderSortMenu();
      $('#home-folder-grid').innerHTML = rootFolders.length ? rootFolders.map(path => {
        const noteCount = folderNoteCount(path, true);
        const children = allPaths.filter(candidate => candidate.startsWith(`${path}/`) && candidate.split('/').length === path.split('/').length + 1);
        return `<article class="folder-card">
          <div class="folder-card-head"><button type="button" class="folder-card-main" data-folder-open="${esc(path)}" title="Open ${esc(path)}"><span class="folder-card-icon">${svgIcon('folder',20)}</span><span class="folder-card-copy"><strong>${esc(path)}</strong><small>${noteCount} ${noteCount === 1 ? 'note' : 'notes'}${children.length ? ` · ${children.length} subfolder${children.length === 1 ? '' : 's'}` : ''}</small></span><span class="folder-card-arrow">↗</span></button><button type="button" class="folder-card-add" data-create-subfolder="${esc(path)}" title="Add a subfolder inside ${esc(path)}" aria-label="Add subfolder to ${esc(path)}">+</button><button type="button" class="folder-card-menu" data-folder-menu="${esc(path)}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(path)}" title="Folder actions">${svgIcon('more',14)}</button></div>
          ${children.length ? `<div class="folder-subfolders"><span class="folder-subfolders-label">SUBFOLDERS</span><div>${children.slice(0,4).map(child => `<button type="button" class="folder-subfolder-chip" data-folder-open="${esc(child)}"><span>${svgIcon('folder',12)} ${esc(child.split('/').pop())}</span><small>${folderNoteCount(child, true)}</small></button>`).join('')}${children.length > 4 ? `<span class="folder-more-count">+${children.length - 4} more</span>` : ''}</div></div>` : `<div class="folder-no-children">Notes and files in this folder</div>`}
        </article>`;
      }).join('') : `<div class="folder-empty-card"><span class="folder-card-icon">${svgIcon('folder',20)}</span><div><strong>No folders yet</strong><span>Create a folder to start organizing your notes into subjects and subfolders.</span></div><button type="button" class="quiet-link" data-create-folder>Make a folder <span>→</span></button></div>`;
      const grouped = new Map();
      for (const note of [...notes].sort((a,b) => b.updatedAt - a.updatedAt)) {
        const path = cleanFolderPath(note.folderPath) || 'Unfiled';
        if (!grouped.has(path)) grouped.set(path, []);
        grouped.get(path).push(note);
      }
      $('#home-note-groups').innerHTML = grouped.size ? [...grouped.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([path, group]) => `<section class="home-note-group"><div class="home-note-group-head"><div><span class="group-folder-icon">${svgIcon('folder',15)}</span><div><strong>${esc(path)}</strong><small>${group.length} ${group.length === 1 ? 'note' : 'notes'}${path !== 'Unfiled' ? ` · ${folderNoteCount(path)} in folder tree` : ''}</small></div></div>${path !== 'Unfiled' ? `<button type="button" class="quiet-link" data-folder-open="${esc(path)}">Open folder <span>→</span></button>` : ''}</div><div class="home-note-grid group-note-grid">${group.slice(0,4).map(note => noteCardMarkup(note, true)).join('')}</div>${group.length > 4 && path !== 'Unfiled' ? `<button type="button" class="group-more" data-folder-open="${esc(path)}">View all ${group.length} notes →</button>` : ''}</section>`).join('') : `<div class="dashboard-empty"><span class="empty-mark">✦</span><strong>Nothing in your workspace yet.</strong><span>Create a note or import a file; everything will be organized here.</span><button type="button" class="primary-button" id="empty-start-note">Create your first note</button></div>`;
    }
    function updateSelectionToolbar(filtered) {
      for (const id of [...selectedNoteIds]) if (!notes.some(note => note.id === id)) selectedNoteIds.delete(id);
      const selected = notes.filter(note => selectedNoteIds.has(note.id));
      $('#selection-toolbar').classList.toggle('hidden', !selectionMode);
      $('#selection-toggle').textContent = selectionMode ? 'Done' : 'Select';
      $('#selection-toggle').setAttribute('aria-pressed', String(selectionMode));
      $('#selected-count').textContent = `${selected.length} selected`;
      const allVisibleSelected = filtered.length > 0 && filtered.every(note => selectedNoteIds.has(note.id));
      $('#select-all-visible').textContent = allVisibleSelected ? 'Deselect visible' : 'Select all';
      $('#select-all-visible').disabled = !filtered.length;
      const noSelection = !selected.length;
      $$('[data-bulk-action]').forEach(button => { button.disabled = noSelection; });
      $('#bulk-star').textContent = selected.length && selected.every(note => note.favorite) ? 'Unstar' : 'Star';
      $('#bulk-review').textContent = selected.length && selected.every(note => !isReviewDue(note)) ? 'Return to review' : 'Schedule review';
    }
    function toggleSelectionMode(enabled = !selectionMode) {
      selectionMode = Boolean(enabled);
      if (!selectionMode) selectedNoteIds.clear();
      renderNotesPage();
    }
    function toggleNoteSelection(noteId) {
      if (!notes.some(note => note.id === noteId)) return;
      selectionMode = true;
      if (selectedNoteIds.has(noteId)) selectedNoteIds.delete(noteId); else selectedNoteIds.add(noteId);
      renderNotesPage();
      $$('[data-select-id]').find(button => button.dataset.selectId === noteId)?.focus({ preventScroll:true });
    }
    function toggleVisibleSelection() {
      const visible = getFilteredNotes();
      if (!visible.length) return;
      const allSelected = visible.every(note => selectedNoteIds.has(note.id));
      visible.forEach(note => allSelected ? selectedNoteIds.delete(note.id) : selectedNoteIds.add(note.id));
      selectionMode = true;
      renderNotesPage();
    }
    function ensurePrioSelect() {
      let select = $('#prio-filter');
      if (!select && $('#sort-button')) {
        select = document.createElement('select');
        select.id = 'prio-filter';
        select.setAttribute('aria-label', 'Filter by priority or pin');
        select.innerHTML = '<option value="">All priorities</option><option value="pinned">Pinned</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>';
        select.addEventListener('change', () => { prioFilter = select.value; renderNotesPage(); });
        $('#sort-button').before(select);
      }
      if (select) select.value = prioFilter;
    }
    // Filter chips above the library: tap to add or remove a search operator.
    const FILTER_CHIPS = [['is:starred','Starred'],['is:pinned','Pinned'],['is:covered','Covered'],['is:due','Due'],['is:untagged','Untagged'],['type:pdf','PDF'],['type:html','HTML'],['type:markdown','Markdown']];
    function ensureFilterChips() {
      const heading = $('#list-view .page-heading'); if (!heading) return;
      let bar = $('#filter-chips');
      if (!bar) {
        bar = document.createElement('div'); bar.id = 'filter-chips'; bar.className = 'filter-chips'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Filter notes');
        bar.innerHTML = FILTER_CHIPS.map(([op, label]) => `<button type="button" class="filter-chip" data-chip="${op}" aria-pressed="false">${label}</button>`).join('');
        bar.addEventListener('click', event => {
          const op = event.target.closest('[data-chip]')?.dataset.chip; if (!op) return;
          const input = $('#search-input'); if (!input) return;
          const parts = input.value.split(/\s+/).filter(Boolean);
          const next = parts.includes(op) ? parts.filter(part => part !== op) : [...parts, op];
          input.value = next.join(' ');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        heading.after(bar);
      }
      const active = new Set((($('#search-input')?.value) || '').split(/\s+/));
      bar.querySelectorAll('[data-chip]').forEach(button => { const on = active.has(button.dataset.chip); button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    }
    // Folder pages get two study buttons: due-note session and flashcard deck for this folder.
    function ensureFolderStudyActions() {
      const host = $('#list-view .page-heading-actions'); if (!host) return;
      let box = $('#folder-study-actions');
      if (!currentFolderPath) { box?.remove(); return; }
      if (!box) {
        box = document.createElement('div'); box.id = 'folder-study-actions'; box.className = 'folder-study-actions';
        box.innerHTML = '<button type="button" class="selection-toggle" data-fsa="review">Study due notes</button><button type="button" class="selection-toggle" data-fsa="cards">Flashcards</button>';
        box.addEventListener('click', event => {
          const act = event.target.closest('[data-fsa]')?.dataset.fsa; if (!act) return;
          if (act === 'review') startStudySession(currentFolderPath);
          if (act === 'cards') studyFlashcardDeck(currentFolderPath);
        });
        $('#result-count').before(box);
      }
    }
    // Folder view: a folder with subfolders shows the subfolders first. Its own notes open from a card.
    let folderNotesOnly = false, lastFolderForView = '';
    function folderChildren(path) {
      const base = path ? path + '/' : '';
      const seen = new Map();
      getAllFolderPaths().forEach(item => {
        const clean = cleanFolderPath(item);
        if (!clean || (path && !clean.startsWith(base)) || clean === path) return;
        const first = clean.slice(base.length).split('/')[0];
        if (!first) return;
        const child = base + first;
        if (!seen.has(child)) seen.set(child, { path: child, name: first, notes: 0, subfolders: 0 });
      });
      const children = [...seen.values()];
      children.forEach(child => {
        child.notes = notes.filter(note => { const f = cleanFolderPath(note.folderPath); return f === child.path || f.startsWith(child.path + '/'); }).length;
        child.subfolders = getAllFolderPaths().filter(item => cleanFolderPath(item).startsWith(child.path + '/')).length;
      });
      return children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    function folderViewMarkup(path) {
      const children = folderChildren(path);
      const direct = notes.filter(note => cleanFolderPath(note.folderPath) === path).length;
      const cards = children.map(child => `<button type="button" class="folder-card" data-folder-open="${esc(child.path)}"><span class="fc-ico" aria-hidden="true">▤</span><b>${esc(child.name)}</b><small>${child.notes} note${child.notes === 1 ? '' : 's'}${child.subfolders ? ` · ${child.subfolders} subfolder${child.subfolders === 1 ? '' : 's'}` : ''}</small></button>`).join('');
      const own = direct ? `<button type="button" class="folder-card own" data-folder-notes="1"><span class="fc-ico" aria-hidden="true">✎</span><b>Notes in ${esc(path.split('/').pop())}</b><small>${direct} note${direct === 1 ? '' : 's'} directly in this folder</small></button>` : '';
      return cards + own;
    }
    // Home folders: sorted A to Z by default, with a menu to change it.
    let homeFolderSort = 'name';
    function latestNoteTime(path) {
      return notes.reduce((max, note) => { const f = cleanFolderPath(note.folderPath); return (f === path || f.startsWith(path + '/')) ? Math.max(max, note.updatedAt || 0) : max; }, 0);
    }
    function ensureHomeFolderSortMenu() {
      const head = $('#home-folder-grid')?.previousElementSibling; if (!head || head.querySelector('#home-folder-sort')) return;
      const select = document.createElement('select');
      select.id = 'home-folder-sort'; select.className = 'home-folder-sort'; select.setAttribute('aria-label', 'Sort folders');
      select.innerHTML = '<option value="name">Name A–Z</option><option value="notes">Most notes</option><option value="updated">Recently updated</option>';
      select.value = homeFolderSort;
      select.addEventListener('change', () => { homeFolderSort = select.value; renderEverything(); });
      head.appendChild(select);
    }
    function renderNotesPage() {
      ensurePrioSelect();
      ensureFolderStudyActions();
      ensureFilterChips();
      if (typeof ensureBulkAiButtons === 'function') ensureBulkAiButtons();
      const query = ($('#search-input').value || '').trim();
      const filtered = getFilteredNotes();
      const pathName = currentFolderPath || '';
      let title = pathName || (activeFilter === 'starred' ? 'Starred notes' : activeFilter === 'recent' ? 'Recently viewed' : activeFilter === 'review' ? 'Review queue' : 'All notes');
      let eyebrow = currentFolderPath ? 'FOLDER' : activeFilter === 'all' ? 'YOUR LIBRARY' : 'QUICK FILTER';
      let description = currentFolderPath ? `Notes in ${pathName} and its nested subfolders.` : activeFilter === 'starred' ? 'The ideas you want to return to.' : activeFilter === 'recent' ? 'Pick up where you left off.' : activeFilter === 'review' ? 'Notes whose next spaced-repetition review is due.' : 'Everything you have collected, organized in one place.';
      if (query) { title = 'Search results'; eyebrow = 'YOUR LIBRARY'; description = `Matches for “${query}” across titles, note text, HTML content, files, folders, and tags.`; }
      $('#list-view-title').textContent = title;
      $('#list-eyebrow').textContent = eyebrow;
      $('#list-view-subtitle').textContent = description;
      $('#result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
      updateSelectionToolbar(filtered);
      const sortLabels = activeFilter === 'recent' ? { newest:'Most recently opened', oldest:'Least recently opened', title:'Title A to Z' } : activeFilter === 'review' ? { newest:'Due soonest', oldest:'Due latest', title:'Title A to Z' } : { newest:'Newest first', oldest:'Oldest first', title:'Title A to Z' };
      $('#sort-button').innerHTML = `${sortLabels[sortMode] || sortLabels.newest} <span aria-hidden="true">⌄</span>`;
      $('#sort-button').title = `Sort by ${sortLabels[sortMode] || sortLabels.newest}`;
      $$('[data-sort-mode]').forEach(option => { option.textContent = sortLabels[option.dataset.sortMode] || option.dataset.sortMode; option.setAttribute('aria-checked', String(option.dataset.sortMode === sortMode)); });
      const notesGrid = $('#view-notes-grid');
      notesGrid.classList.toggle('list-mode', libraryView === 'list');
      $$('[data-view-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.viewMode === libraryView)));
      if (currentFolderPath !== lastFolderForView) { folderNotesOnly = false; lastFolderForView = currentFolderPath; }
      const showFolderCards = Boolean(currentFolderPath) && !query && !folderNotesOnly && folderChildren(currentFolderPath).length > 0;
      if (showFolderCards) {
        notesGrid.classList.remove('list-mode');
        notesGrid.innerHTML = folderViewMarkup(currentFolderPath);
        $('#result-count').textContent = `${folderChildren(currentFolderPath).length} subfolder${folderChildren(currentFolderPath).length === 1 ? '' : 's'}`;
        $('#list-empty-state').classList.add('hidden');
        $('#list-empty-browse').classList.add('hidden');
        return;
      }
      const backTile = currentFolderPath && folderNotesOnly && folderChildren(currentFolderPath).length ? `<button type="button" class="folder-card back" data-folder-back="1"><span class="fc-ico" aria-hidden="true">←</span><b>Subfolders</b><small>Back to ${esc(currentFolderPath.split('/').pop())}</small></button>` : '';
      const gridNotes = folderNotesOnly && currentFolderPath ? filtered.filter(note => cleanFolderPath(note.folderPath) === currentFolderPath) : filtered;
      if (folderNotesOnly && currentFolderPath) $('#result-count').textContent = `${gridNotes.length} ${gridNotes.length === 1 ? 'item' : 'items'}`;
      notesGrid.innerHTML = backTile + gridNotes.map(note => libraryView === 'list' ? noteRowMarkup(note, activeFilter === 'recent' ? 'opened' : 'updated') : noteCardMarkup(note, false, activeFilter === 'recent' ? 'opened' : 'updated')).join('');
      $('#list-empty-state').classList.toggle('hidden', filtered.length > 0);
      const emptyHeading = $('#list-empty-state h2');
      const emptyCopy = $('#list-empty-state p');
      if (emptyHeading) emptyHeading.textContent = query ? 'No matching notes' : currentFolderPath ? 'This folder is empty' : activeFilter === 'review' ? 'Nothing is due right now' : activeFilter === 'recent' ? 'No reading history yet' : 'No notes in this view';
      if (emptyCopy) emptyCopy.textContent = query ? 'Try another term, quote an exact phrase, or search inside note and HTML content.' : currentFolderPath ? 'Add a note here, or create a subfolder to keep building your library.' : activeFilter === 'review' ? 'New notes are introduced in small daily batches from Home; reviewed notes return when their interval is up.' : activeFilter === 'recent' ? notes.length ? 'Open a note to add it to Recently viewed. Imported files appear here after you open them.' : 'Create or import a note, then open it to start your reading history.' : 'Try a different filter or create your first note.';
      $('#list-empty-browse').classList.toggle('hidden',!(activeFilter === 'recent' && !query && notes.length > 0));
    }
    function setSidebarBadge(id, count) {
      const badge = $(id);
      const value = Number(count) || 0;
      badge.textContent = value.toLocaleString();
      badge.classList.toggle('hidden',value === 0);
    }
    function renderSidebar() {
      $$('.nav-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === (currentPage === 'home' ? 'home' : currentPage === 'notes' && !currentFolderPath ? (activeFilter === 'all' ? 'all' : activeFilter) : '')));
      setSidebarBadge('#all-count',notes.length);
      setSidebarBadge('#star-count',notes.filter(note => note.favorite).length);
      setSidebarBadge('#recent-count',notes.filter(note => Number(note.lastViewedAt) > 0).length);
      setSidebarBadge('#review-count',notes.filter(note => isReviewDue(note)).length);
      const pageTitle = currentPage === 'home' ? 'Home' : currentPage === 'reader' ? (notes.find(note => note.id === activeId)?.title || 'Note') : currentPage === 'editor' ? (editingNew ? 'New note' : 'Edit note') : filterLabel();
      $('#context-title').textContent = pageTitle;
      $('#context-subtitle').textContent = currentSession?.mode === 'cloud' ? 'Firebase primary · local mirror active' : 'Your learning, organized';
      renderFolderTree();
      renderSideRecent();
    }
    function renderEverything() {
      if (searchRenderTimer) { clearTimeout(searchRenderTimer); searchRenderTimer = 0; }
      if (!$('#note-view').classList.contains('hidden') && readerRenderedId) saveReaderPositionNow(readerRenderedId);
      if (currentPage !== 'editor') removeHtmlExtractionProbe();
      let current = notes.find(note => note.id === activeId);
      if (currentPage === 'reader' && !current) {
        currentPage = previousPage && previousPage !== 'reader' && previousPage !== 'editor' ? previousPage : 'home';
        if (currentSession) replaceCurrentAppRoute();
      }
      renderSidebar();
      if (currentPage === 'home') renderHomeDashboard();
      if (currentPage === 'notes') renderNotesPage();
      current = notes.find(note => note.id === activeId);
      const home = currentPage === 'home';
      const list = currentPage === 'notes';
      const reader = currentPage === 'reader' && Boolean(current);
      const editor = currentPage === 'editor';
      if (studySession && (!reader || !studySession.ids.includes(current?.id))) finishStudySession(false);
      if (!reader) setReviewPopover(false);
      $('#home-view').classList.toggle('hidden', !home);
      $('#list-view').classList.toggle('hidden', !list);
      $('#note-view').classList.toggle('hidden', !reader);
      $('#editor-view').classList.toggle('hidden', !editor);
      $('#reader-progress').classList.toggle('hidden', !reader);
      if (reader) {
        const key = readerKeyOf(current);
        if (key !== readerRenderKey || readerRenderedId !== current.id) { renderViewer(current); readerRenderKey = key; }
      }
      else { readerRenderKey = ''; destroyPdfReader(); $('#app-shell').classList.remove('pdf-focus-mode'); setReaderProgressPercent(0); }
      reviewDueSignature = notes.filter(note => isReviewDue(note)).map(note => note.id).sort().join('|');
      updateReadingProgress();
      renderWeeklyDigest();
      renderHomeNudge();
      renderHomeCommands();
      renderSideRecent();
      orderHomeCards();
    }
    function currentAppRoute() {
      return {
        notezApp: true,
        routeIndex,
        page: currentPage,
        filter: activeFilter,
        folder: currentFolderPath,
        search: $('#search-input')?.value || '',
        noteId: activeId,
        previousPage,
        editorReturnPage,
        editorId,
        editingNew,
        editorKind
      };
    }
    function routeHash(page = currentPage) { return `#notez-${encodeURIComponent(page || 'home')}`; }
    function replaceAppRoute() {
      if (!currentSession) return;
      routeIndex = 0;
      window.history.replaceState({ ...currentAppRoute(), routeIndex, scrollTop:0 }, '', routeHash());
    }
    function replaceCurrentAppRoute() {
      if (!currentSession) return;
      window.history.replaceState({ ...currentAppRoute(), routeIndex, scrollTop:$('#workspace-main').scrollTop }, '', routeHash());
    }
    function pushAppRoute() {
      if (!currentSession) return;
      const previous = window.history.state;
      if (previous?.notezApp) window.history.replaceState({ ...previous, scrollTop:$('#workspace-main').scrollTop }, '', window.location.href);
      const state = { ...currentAppRoute(), scrollTop:0 };
      const same = previous?.notezApp && previous.page === state.page && previous.filter === state.filter && previous.folder === state.folder && previous.noteId === state.noteId && previous.editorId === state.editorId && previous.search === state.search;
      if (same) return;
      routeIndex = previous?.notezApp ? (Number(previous.routeIndex) || routeIndex) + 1 : Math.max(1, routeIndex + 1);
      window.history.pushState({ ...state, routeIndex }, '', routeHash());
    }
    function restoreAppRoute(state) {
      if (!currentSession) return;
      if (!state?.notezApp) {
        selectionMode = false; selectedNoteIds.clear();
        currentPage = 'home'; currentFolderPath = ''; activeFilter = 'all'; activeId = ''; previousPage = 'home';
        $('#search-input').value = '';
        replaceAppRoute(); renderEverything(); $('#workspace-main').scrollTop = 0; return;
      }
      if (currentPage === 'editor' && state.page !== 'editor') saveEditorDraft();
      const nextPage = ['home','notes','reader','editor'].includes(state.page) ? state.page : 'home';
      if (nextPage !== 'notes') { selectionMode = false; selectedNoteIds.clear(); }
      routeIndex = Number(state.routeIndex) || 0;
      currentFolderPath = cleanFolderPath(state.folder || '');
      activeFilter = ['all','starred','recent','review'].includes(state.filter) ? state.filter : 'all';
      $('#search-input').value = String(state.search || '').slice(0, 180);
      activeId = state.noteId || '';
      previousPage = state.previousPage || 'home';
      editorReturnPage = state.editorReturnPage || 'home';
      editorId = state.editorId || editorId;
      editingNew = Boolean(state.editingNew);
      editorKind = state.editorKind || editorKind;
      if (nextPage === 'editor' && (currentPage !== 'editor' || state.editorId !== editorId || Boolean(state.editingNew) !== editingNew)) {
        const editTarget = state.editingNew ? null : notes.find(note => note.id === state.editorId) || null;
        openEditor(editTarget, { push:false, id:state.editorId, kind:state.editorKind });
        editorReturnPage = state.editorReturnPage || 'home';
        routeIndex = Number(state.routeIndex) || 0;
        $('#workspace-main').scrollTop = Math.max(0, Number(state.scrollTop) || 0);
        return;
      }
      currentPage = nextPage;
      if (currentPage === 'reader' && !notes.some(note => note.id === activeId)) {
        currentPage = 'home';
        replaceCurrentAppRoute();
      }
      renderEverything();
      $('#workspace-main').scrollTop = Math.max(0, Number(state.scrollTop) || 0);
    }
    function goBackInApp(fallbackPage = 'home') {
      const state = window.history.state;
      if (state?.notezApp && Number(state.routeIndex) > 0) { window.history.back(); return; }
      currentPage = fallbackPage || 'home';
      if (currentPage === 'reader' || currentPage === 'editor') currentPage = 'home';
      if (currentPage !== 'notes') { selectionMode = false; selectedNoteIds.clear(); }
      currentFolderPath = currentPage === 'notes' ? currentFolderPath : '';
      replaceAppRoute(); renderEverything(); $('#workspace-main').scrollTop = 0;
    }
    function navigateToPage(page, filter = 'all') {
      selectionMode = false; selectedNoteIds.clear();
      currentPage = page;
      currentFolderPath = '';
      activeFilter = filter;
      $('#search-input').value = '';
      pushAppRoute();
      $('#app-shell').classList.remove('mobile-nav-open');
      renderEverything();
      $('#workspace-main').scrollTop = 0;
    }
    function formatReviewInterval(days) {
      if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} min`;
      if (days < 1) return `${Math.round(days * 24)} hr`;
      return `${days} ${days === 1 ? 'day' : 'days'}`;
    }
    function updateReviewPopover(note = notes.find(item => item.id === activeId)) {
      if (!note) return;
      const stage = Math.max(0, Math.floor(Number(note.reviewCount) || 0));
      const prev = Number(note.reviewIntervalDays) || 1;
      const hardDays = Math.min(90, Math.max(1, Math.ceil(prev * 1.2)));
      const goodDays = REVIEW_INTERVALS_DAYS[Math.min(stage, REVIEW_INTERVALS_DAYS.length - 1)];
      const easyDays = REVIEW_INTERVALS_DAYS[Math.min(stage + 1, REVIEW_INTERVALS_DAYS.length - 1)];
      $('#review-hard-interval').textContent = `${formatReviewInterval(hardDays)} · 2`;
      $('#review-good-interval').textContent = `${formatReviewInterval(goodDays)} · 3`;
      $('#review-easy-interval').textContent = `${formatReviewInterval(easyDays)} · 4`;
    }
    function setReviewPopover(open, restoreFocus = false) {
      const popover = $('#review-popover');
      const trigger = $('#complete-current');
      popover.classList.toggle('hidden', !open);
      trigger.setAttribute('aria-expanded', String(Boolean(open)));
      if (open) { updateReviewPopover(); popover.querySelector('[data-review-rating="again"]')?.focus({ preventScroll:true }); }
      else if (restoreFocus) trigger.focus({ preventScroll:true });
    }
    function finishStudySession(announce = true) {
      if (!studySession) return;
      const finished = studySession;
      studySession = null;
      $('#study-session-bar').classList.add('hidden');
      if (announce) {
        if (finished.ids.length) toast(`Session paused · ${finished.reviewed} reviewed · ${finished.skipped} skipped · ${finished.ids.length} left for later.`, 'success', 5200);
        else if (finished.skipped) toast(`Session complete · ${finished.reviewed} reviewed · ${finished.skipped} skipped (still in your queue).`, 'success', 5200);
        else if (finished.reviewed) toast(`Session complete · ${finished.reviewed} reviewed.`, 'success', 5200);
        else toast('Study session ended. Your notes are still saved.', 'success');
      }
    }
    function advanceStudySession(outcome = 'reviewed') {
      if (!studySession) return;
      const id = activeId;
      studySession.ids = studySession.ids.filter(noteId => noteId !== id);
      if (outcome === 'skipped') studySession.skipped += 1;
      else studySession.reviewed += 1;
      if (studySession.ids.length) { openNote(studySession.ids[0], { replace:true }); return; }
      finishStudySession(true);
      renderEverything();
    }
    function startStudySession(scopePath = '') {
      const inScope = note => !scopePath || cleanFolderPath(note.folderPath) === scopePath || cleanFolderPath(note.folderPath).startsWith(scopePath + '/');
      const due = notes.filter(note => inScope(note) && isReviewDue(note)).sort((a,b) => (Number(a.reviewDueAt) || 0) - (Number(b.reviewDueAt) || 0) || b.updatedAt - a.updatedAt);
      const newNotes = notes.filter(note => inScope(note) && isNewNote(note)).sort((a,b) => a.createdAt - b.createdAt).slice(0,newNotesRemainingToday());
      const queue = [];
      for (let index = 0; index < Math.max(due.length,newNotes.length); index++) {
        if (due[index]) queue.push(due[index]);
        if (newNotes[index]) queue.push(newNotes[index]);
      }
      if (!queue.length && scopePath) { toast(`Nothing to study in ${scopePath} right now.`); return; }
      if (!queue.length) {
        toast(notes.some(note => isNewNote(note)) ? 'Today’s on-device new-note limit is reached. You can still study scheduled reviews tomorrow.' : 'You’re all caught up. Scheduled notes will return when their next review is due.', 'success');
        return;
      }
      studySession = { ids:queue.map(note => note.id), total:queue.length, reviewed:0, skipped:0, startedAt:Date.now() };
      openNote(queue[0].id);
    }
    function renderStudySessionBar(note) {
      const bar = $('#study-session-bar');
      const session = studySession;
      if (!session || !session.ids.includes(note?.id)) { bar.classList.add('hidden'); return; }
      const processed = session.reviewed + session.skipped;
      const remaining = session.ids.length;
      $('#study-session-message').textContent = `${remaining} ${remaining === 1 ? 'note' : 'notes'} left in this session`;
      $('#study-session-subtext').textContent = `${session.reviewed} reviewed · ${session.skipped} skipped. Rate recall with the button or keys 1–4.`;
      $('#study-session-progress-label').textContent = `${processed} / ${session.total}`;
      $('#study-session-progress-fill').style.width = `${Math.round((processed / Math.max(1, session.total)) * 100)}%`;
      bar.classList.remove('hidden');
    }
    function handleReviewRating(rating) {
      const note = notes.find(item => item.id === activeId);
      if (!note) return;
      const inSession = Boolean(studySession?.ids.includes(note.id));
      const wasNew = isNewNote(note);
      const result = scheduleNoteReview(note, rating);
      if (wasNew && rating !== 'reset') markNewNoteStudiedToday(note.id);
      setReviewPopover(false, true);
      persistNote(note).catch(() => toast('Saved on this device; Firebase sync is queued.', 'error', 4800));
      if (rating === 'reset') {
        renderEverything();
        toast('Returned to your review queue.', 'success');
        return;
      }
      if (inSession) advanceStudySession('reviewed');
      else renderEverything();
      toast(`Saved · next review in ${formatReviewInterval(result.intervalDays)}.`, 'success', 4400);
    }
    function openNote(noteId, options = {}) {
      const note = notes.find(item => item.id === noteId);
      if (!note) return;
      readerRenderKey = '';
      if (studySession && !studySession.ids.includes(noteId)) finishStudySession(false);
      selectionMode = false; selectedNoteIds.clear();
      previousPage = currentPage === 'reader' ? previousPage : currentPage;
      activeId = note.id;
      currentPage = 'reader';
      if (options.replace) replaceCurrentAppRoute(); else pushAppRoute();
      note.lastViewedAt = Date.now();
      if (currentSession?.mode === 'demo') localNotesWrite();
      else persistNote(note).catch(() => setSyncState('pending'));
      $('#app-shell').classList.remove('mobile-nav-open');
      renderEverything();
      $('#workspace-main').scrollTop = 0;
    }
    async function promptFolder(defaultPath = '') {
      const value = await uiPrompt({ title: 'New folder', message: 'Use / to nest folders, for example English/Ch1.', value: defaultPath, placeholder: 'Folder name', confirmLabel: 'Create folder', suggestions: folderSuggestions() });
      if (value == null) return;
      const path = cleanFolderPath(value);
      if (!path) { toast('Enter a folder name.', 'error'); return; }
      const alreadyExists = getAllFolderPaths().includes(path);
      if (!addFolderPath(path)) return;
      expandFolderPath(path);
      toast(alreadyExists ? 'Folder is ready.' : 'Folder created.');
      renderEverything();
    }
    function actionMenuItem(action, label, icon, danger = false) {
      return `<button type="button" class="action-menu-item ${danger ? 'danger' : ''}" role="menuitem" data-menu-action="${esc(action)}">${svgIcon(icon,15)}<span>${esc(label)}</span></button>`;
    }
    function closeActionMenu(restoreFocus = false) {
      $('#action-menu').classList.add('hidden');
      $$('[data-note-menu],[data-folder-menu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      const trigger = contextTarget?.trigger;
      contextTarget = null;
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll:true });
    }
    function closeAccountMenu(restoreFocus = false) {
      const homeWrap = $('.account-wrap');
      if (homeWrap && $('#account-menu').parentElement !== homeWrap) homeWrap.appendChild($('#account-menu'));
      $('#account-menu').classList.add('hidden');
      $('#account-menu').classList.remove('side-account-menu');
      $('#account-menu').style.left = '';
      $('#top-avatar').setAttribute('aria-expanded', 'false');
      $('#side-profile-menu').setAttribute('aria-expanded', 'false');
      const trigger = accountMenuTrigger;
      accountMenuTrigger = null;
      if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll:true });
    }
    function toggleAccountMenu(trigger) {
      const wasClosed = $('#account-menu').classList.contains('hidden');
      closeAccountMenu();
      if (!wasClosed) return;
      accountMenuTrigger = trigger;
      $('#account-menu').classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      if (trigger.id === 'side-profile-menu') {
        const rect = trigger.getBoundingClientRect();
        // Move to <body> so the sidebar's stacking context can't paint over (clip) the menu.
        document.body.appendChild($('#account-menu'));
        $('#account-menu').classList.add('side-account-menu');
        $('#account-menu').style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 224))}px`;
      }
    }
    function closeSortMenu() {
      $('#sort-menu').classList.add('hidden');
      $('#sort-button').setAttribute('aria-expanded', 'false');
    }
    const sec = title => `<div class="menu-section">${title}</div>`;
    function openActionMenu(type, id, x, y, trigger = null) {
      const menu = $('#action-menu');
      let heading = '', contents = '';
      if (type === 'note') {
        const note = notes.find(item => item.id === id);
        if (!note) return;
        heading = 'NOTE ACTIONS';
        const progressItem = progressOf(note) >= 0.9 ? actionMenuItem('reset-progress', 'Reset coverage', 'recent') : actionMenuItem('mark-covered', 'Mark as covered', 'check');
        contents = `${actionMenuItem('open', 'Open note', 'open')}${actionMenuItem('edit', 'Edit note', 'edit')}
          ${sec('Organize')}${actionMenuItem('pin', note.pinned ? 'Unpin from top' : 'Pin to top', 'star')}${actionMenuItem('priority', `Priority: ${({ '': 'None', high: 'High', medium: 'Medium', low: 'Low' })[note.priority || ''] || 'None'}`, 'check')}${actionMenuItem('star', note.favorite ? 'Remove from starred' : 'Add to starred', 'star')}${actionMenuItem('review', isReviewDue(note) ? 'Schedule next review' : 'Return to review queue', 'check')}${actionMenuItem('move', 'Move to folder…', 'move')}
          ${sec('Read and study')}${progressItem}${actionMenuItem('bookmark', 'Add bookmark here', 'star')}${actionMenuItem('bookmarks', 'Bookmarks…', 'recent')}${actionMenuItem('flashcards', 'Study flashcards', 'star')}${actionMenuItem('read-aloud', 'Read aloud', 'open')}
          ${sec('AI and links')}${actionMenuItem('ai', 'Ask NotezAi…', 'star')}${actionMenuItem('local-tags', 'Suggest tags (offline)', 'folder')}${actionMenuItem('backlinks', 'Linked from…', 'recent')}
          ${sec('Edit details')}${actionMenuItem('rename', 'Rename…', 'edit')}${actionMenuItem('tags', 'Edit tags…', 'folder')}${actionMenuItem('duplicate', 'Duplicate', 'note')}${actionMenuItem('history', 'Version history…', 'recent')}
          ${sec('Share and export')}${actionMenuItem('copy-text', 'Copy text', 'open')}${actionMenuItem('print', 'Print or save as PDF', 'download')}${actionMenuItem('download', 'Download', 'download')}${actionMenuItem('export-note', 'Export as JSON', 'export')}
          <div class="action-menu-divider"></div>${actionMenuItem('delete', 'Delete note', 'trash', true)}`;
      } else {
        const path = cleanFolderPath(id);
        if (!path) return;
        heading = 'FOLDER ACTIONS';
        contents = `${actionMenuItem('open-folder', 'Open folder', 'open')}${actionMenuItem('new-here', 'New note here', 'note')}<div class="action-menu-divider"></div>${actionMenuItem('new-subfolder', 'Create subfolder…', 'folder')}${actionMenuItem('import-here', 'Import folder here…', 'import')}${actionMenuItem('rename-folder', 'Rename or move folder…', 'edit')}${actionMenuItem('export-zip', 'Export as ZIP', 'export')}${actionMenuItem('delete-folder', 'Delete folder…', 'trash', true)}${actionMenuItem('copy-path', 'Copy folder path', 'copy')}`;
      }
      contextTarget = { type, id, trigger };
      $$('[data-note-menu],[data-folder-menu]').forEach(button => {
        const buttonType = button.hasAttribute('data-note-menu') ? 'note' : 'folder';
        const buttonId = button.dataset.noteMenu || button.dataset.folderMenu;
        button.setAttribute('aria-expanded', String(buttonType === type && buttonId === id));
      });
      menu.innerHTML = `<div class="action-menu-heading">${heading}</div>${contents}`;
      menu.classList.remove('hidden');
      const width = menu.offsetWidth || 230;
      const height = menu.offsetHeight || 250;
      menu.style.left = `${Math.max(8, Math.min(Number(x) || 0, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(Number(y) || 0, window.innerHeight - height - 8))}px`;
      menu.querySelector('[role="menuitem"]')?.focus({ preventScroll:true });
    }
    // Folder picker: lists every folder as a tree, searchable, with a way to create a new one.
    function pickFolderDialog({ title, message, current = '', confirmLabel = 'Move here' }) {
      return new Promise(resolve => {
        const previous = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'nz-modal-overlay';
        overlay.innerHTML = `<div class="nz-modal fp-modal" role="dialog" aria-modal="true" aria-labelledby="fp-title">
          <div class="nz-modal-head"><span class="nz-modal-icon" aria-hidden="true">📁</span><h3 id="fp-title">${esc(title)}</h3></div>
          <p class="nz-modal-msg">${esc(message)}</p>
          <input class="nz-modal-input" id="fp-search" type="search" placeholder="Search folders, or type a new name" aria-label="Search folders" autocomplete="off">
          <div class="fp-list" id="fp-list" role="listbox" aria-label="Folders"></div>
          <div class="fp-selected" id="fp-selected" aria-live="polite"></div>
          <div class="nz-modal-actions"><button type="button" class="nz-btn" data-r="cancel">Cancel</button><button type="button" class="nz-btn primary" data-r="ok" id="fp-ok">${esc(confirmLabel)}</button></div></div>`;
        document.body.appendChild(overlay);
        const search = overlay.querySelector('#fp-search'), list = overlay.querySelector('#fp-list'), selectedEl = overlay.querySelector('#fp-selected'), ok = overlay.querySelector('#fp-ok');
        let selected = cleanFolderPath(current) || '';
        const allPaths = getAllFolderPaths().slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const count = path => notes.filter(note => note.folderPath === path || (note.folderPath || '').startsWith(path + '/')).length;
        const rows = () => {
          const q = search.value.trim().toLowerCase();
          const shown = q ? allPaths.filter(path => path.toLowerCase().includes(q)) : allPaths;
          const items = [{ path: '', label: 'General (root)', depth: 0 }, ...shown.map(path => ({ path, label: path.split('/').pop(), depth: path.split('/').length - 1, full: path }))];
          let html = items.map(item => `<button type="button" role="option" class="fp-row ${selected === item.path ? 'on' : ''}" style="padding-left:${12 + item.depth * 16}px" data-path="${esc(item.path)}" aria-selected="${selected === item.path}"><span class="fp-ico">${item.path ? '📁' : '🗂'}</span><span class="fp-name">${esc(item.label)}</span><small>${item.path ? count(item.path) : ''}</small></button>`).join('');
          const typed = cleanFolderPath(search.value);
          if (typed && !allPaths.includes(typed)) html = `<button type="button" role="option" class="fp-row fp-create ${selected === typed ? 'on' : ''}" data-path="${esc(typed)}"><span class="fp-ico">＋</span><span class="fp-name">Create “${esc(typed)}”</span></button>` + html;
          list.innerHTML = html || '<div class="fp-empty">No folders match. Type a name to create one.</div>';
          selectedEl.textContent = selected ? `Selected: ${selected}` : 'Selected: General (root)';
          ok.disabled = selected === (cleanFolderPath(current) || '') && !!current;
        };
        let closed = false;
        const close = result => { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 130); if (previous && previous.isConnected) previous.focus({ preventScroll: true }); resolve(result); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(null); } };
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(null); });
        list.addEventListener('click', event => { const row = event.target.closest('[data-path]'); if (!row) return; selected = row.dataset.path; rows(); });
        list.addEventListener('dblclick', event => { if (event.target.closest('[data-path]')) close(selected); });
        search.addEventListener('input', rows);
        search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); const first = list.querySelector('[data-path]'); if (first) { selected = first.dataset.path; rows(); close(selected); } } });
        overlay.addEventListener('click', event => {
          const choice = event.target.closest('[data-r]')?.dataset.r;
          if (choice === 'ok' && !ok.disabled) close(selected); else if (choice === 'cancel') close(null);
        });
        rows(); search.focus();
      });
    }
    async function moveNoteToFolder(noteId) {
      const note = notes.find(item => item.id === noteId);
      if (!note) return;
      const value = await pickFolderDialog({ title: 'Move to folder', message: `Choose where “${note.title}” should go.`, current: note.folderPath || '' });
      if (value == null) return;
      const folderPath = cleanFolderPath(value) || 'General';
      const moveSnap = await snapshotNotesForUndo([note]);
      note.folderPath = folderPath;
      note.updatedAt = Date.now();
      addFolderPath(folderPath);
      persistNote(note).catch(() => toast('Moved on this device; Firebase sync is queued.', 'error'));
      renderEverything();
      toast(`Moved to ${folderPath}.`);
      offerUndo(moveSnap, 'Note moved');
    }
    async function runActionMenuAction(action) {
      const target = contextTarget;
      closeActionMenu();
      if (!target) return;
      if (target.type === 'import') {
        if (action === 'import-files') $('#file-input').click();
        else if (action === 'import-folder') { pendingFolderBase = ''; $('#folder-input').click(); }
        else if (action === 'import-zip') $('#zip-input').click();
        else if (action === 'import-clipboard') quickCaptureFromClipboard();
        else if (action === 'import-record') openRecorder();
        return;
      }
      if (target.type === 'note') {
        const note = notes.find(item => item.id === target.id);
        if (!note) return;
        if (action === 'open') openNote(note.id);
        else if (action === 'edit') openEditor(note);
        else if (action === 'star') { note.favorite = !note.favorite; note.updatedAt = Date.now(); persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error')); renderEverything(); }
        else if (action === 'review') {
          const shouldReturn = !isReviewDue(note);
          scheduleNoteReview(note, shouldReturn ? 'reset' : 'good');
          persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
          renderEverything();
          toast(shouldReturn ? 'Returned to your review queue.' : `Review scheduled for ${reviewDueLabel(note)}.`, 'success');
        }
        else if (action === 'pin') setNoteFields(note, { pinned: !note.pinned }, note.pinned ? 'Unpinned.' : 'Pinned to the top.');
        else if (action === 'priority') { const order = ['', 'high', 'medium', 'low']; const next = order[(order.indexOf(note.priority || '') + 1) % order.length]; setNoteFields(note, { priority: next }, `Priority set to ${next ? next : 'none'}.`); }
        else if (action === 'local-tags') {
          const suggestions = suggestLocalTags(note).filter(tag => !(note.tags || []).includes(tag));
          if (!suggestions.length) { toast('No new tag ideas for this note.'); }
          else if (await uiConfirm({ title: 'Add suggested tags?', message: `Suggested from the words in this note: ${suggestions.map(tag => '#' + tag).join('  ')}`, confirmLabel: 'Add tags' })) {
            note.tags = [...new Set([...(note.tags || []), ...suggestions])].slice(0, 20); note.updatedAt = Date.now();
            persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error')); renderEverything(); toast('Tags added.');
          }
        }
        else if (action === 'find-duplicates') showDuplicates();
        else if (action === 'backlinks') showBacklinks(note);
        else if (action === 'print') printNote(note);
        else if (action === 'mark-covered') { recordProgress(note.id, 1, { replace: true }); renderEverything(); toast('Marked as covered.'); }
        else if (action === 'reset-progress') { recordProgress(note.id, 0, { replace: true }); renderEverything(); toast('Coverage reset.'); }
        else if (action === 'bookmark') addBookmark(note);
        else if (action === 'bookmarks') showBookmarks(note);
        else if (action === 'rename') {
          const renameSnap = await snapshotNotesForUndo([note]);
          const value = await uiPrompt({ title: 'Rename note', value: note.title, placeholder: 'Note title', confirmLabel: 'Rename' });
          if (value != null && value.trim()) { note.title = value.trim().slice(0, 200); offerUndo(renameSnap, 'Note renamed'); note.updatedAt = Date.now(); persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error')); renderEverything(); toast('Note renamed.'); }
        }
        else if (action === 'tags') {
          const value = await uiPrompt({ title: 'Edit tags', message: 'Separate tags with commas.', value: (note.tags || []).join(', '), placeholder: 'biology, chapter 3', confirmLabel: 'Save tags' });
          if (value != null) { note.tags = [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 20); note.updatedAt = Date.now(); persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error')); renderEverything(); toast('Tags updated.'); }
        }
        else if (action === 'duplicate') await duplicateNote(note);
        else if (action === 'copy-text') {
          const text = String(note.body || '').trim();
          if (!text) toast('This note has no text to copy.', 'error');
          else { try { await navigator.clipboard.writeText(text); toast('Text copied to the clipboard.'); } catch { toast('Your browser blocked clipboard access.', 'error'); } }
        }
        else if (action === 'export-note') await exportNotesJson([note]);
        else if (action === 'ai') openNotezAi(note);
        else if (action === 'read-aloud') readAloud(note);
        else if (action === 'flashcards') studyFlashcards(note);
        else if (action === 'history') showHistory(note);
        else if (action === 'move') await moveNoteToFolder(note.id);
        else if (action === 'download') await downloadNote(note.id);
        else if (action === 'delete') await deleteNote(note.id);
        return;
      }
      const path = cleanFolderPath(target.id);
      if (action === 'open-folder') openFolderPath(path);
      else if (action === 'new-here') {
        openFolderPath(path);
        openEditor();
      } else if (action === 'rename-folder') await renameFolder(path);
      else if (action === 'delete-folder') await deleteFolder(path);
      else if (action === 'export-zip') await exportFolderZip(path);
      else if (action === 'import-here') { pendingFolderBase = path; $('#folder-input').click(); }
      else if (action === 'new-subfolder') promptFolder(`${path}/`);
      else if (action === 'copy-path') {
        try { await navigator.clipboard.writeText(path); toast('Folder path copied.'); }
        catch { await uiPrompt({ title: 'Folder path', message: 'Copy the path below.', value: path, confirmLabel: 'Done' }); }
      }
    }
    function openFolderPath(path) {
      const folderPath = cleanFolderPath(path);
      if (!folderPath) return;
      selectionMode = false; selectedNoteIds.clear();
      expandFolderPath(folderPath);
      currentFolderPath = folderPath; currentPage = 'notes'; activeFilter = 'all';
      $('#search-input').value = '';
      pushAppRoute();
      $('#app-shell').classList.remove('mobile-nav-open');
      renderEverything(); $('#workspace-main').scrollTop = 0;
    }
    async function exportNotesJson(records = notes) {
      const hasAttachments = records.some(note => note.fileName || note.filePath);
      let unavailableHtmlSources = 0;
      const exportedNotes = [];
      for (const note of records) {
        const exported = { ...normalizeNote(note), filePath:'', attachmentEmbedded:false, htmlReadableText:'', htmlReadableSourceKey:'' };
        const embeddedSource = htmlSourceForNote(note);
        if (embeddedSource) exported.htmlSource = embeddedSource;
        if (exported.kind === 'html' && !exported.htmlSource && (note.fileName || note.filePath)) {
          try {
            const attachment = await resolveAttachment(note);
            exported.htmlSource = await attachmentText(attachment);
          } catch (error) { console.info('Could not include the original HTML source in this export:', error); }
          if (!exported.htmlSource) unavailableHtmlSources++;
        }
        exportedNotes.push(exported);
      }
      const bundle = {
        format:'notez-notes-export', version:1, exportedAt:new Date().toISOString(),
        folders:normalizeFolderList([...folders, ...exportedNotes.map(note => note.folderPath)]),
        notes:exportedNotes
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type:'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `notez-notes-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      const attachmentCopy = hasAttachments ? '. Attachment bytes are not embedded; readable HTML source is included when available.' : '.';
      const missingCopy = unavailableHtmlSources ? ` ${unavailableHtmlSources} HTML source${unavailableHtmlSources === 1 ? ' was' : 's were'} unavailable; the saved readable text is still included.` : '';
      toast(`${exportedNotes.length} ${exportedNotes.length === 1 ? 'note' : 'notes'} exported as JSON${attachmentCopy}${missingCopy}`, 'success', 6000);
    }
    async function importNotesJson(file) {
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { toast('That JSON file is larger than the 50 MB import limit.', 'error'); return; }
      let bundle;
      try { bundle = JSON.parse(await file.text()); }
      catch { toast('This file is not valid JSON.', 'error'); return; }
      if (bundle?.format !== 'notez-notes-export' || !Array.isArray(bundle.notes)) {
        toast('This is not a Notez notes export. Use Import files for ordinary documents.', 'error', 5200); return;
      }
      const source = bundle.notes.slice(0, 2000);
      if (!source.length) { toast('This export does not contain any notes.', 'error'); return; }
      if (!(await uiConfirm({ title: 'Import notes', message: `Import ${source.length} ${source.length === 1 ? 'note' : 'notes'} into this workspace? Existing notes are kept, and ID conflicts get new IDs.`, confirmLabel: 'Import' }))) return;
      const usedIds = new Set(notes.map(note => note.id));
      const imported = source.map(raw => {
        const record = raw && typeof raw === 'object' ? raw : {};
        const note = normalizeNote(record);
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(note.id) || usedIds.has(note.id)) note.id = uid();
        usedIds.add(note.id);
        note.filePath = '';
        note.createdAt = Number(record.createdAt) || Date.now();
        note.updatedAt = Number(record.updatedAt) || note.createdAt;
        return note;
      });
      const importedFolders = Array.isArray(bundle.folders) ? bundle.folders : [];
      folders = normalizeFolderList([...folders, ...importedFolders, ...imported.map(note => note.folderPath)]);
      notes = [...imported, ...notes].sort((a,b) => b.updatedAt - a.updatedAt);
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      if (cloudUid) {
        writeCloudFolders(cloudUid, folders, true);
        imported.forEach(note => markPending(cloudUid, note.id, true));
        writeCloudCache(cloudUid, notes);
      } else { writeDemoFolders(); localNotesWrite(); }
      selectionMode = false; selectedNoteIds.clear();
      renderEverything();
      const hasAttachments = imported.some(note => note.fileName);
      toast(`Imported ${imported.length} notes${hasAttachments ? '. Reattach original files; JSON includes file details, not the file bytes.' : '.'}`, 'success', 5600);
      if (cloudUid && navigator.onLine) syncCloudWorkspace(cloudUid).catch(error => { console.warn('Imported notes remain queued:', error); setSyncState('pending'); });
      else if (cloudUid) setSyncState('offline');
    }
    async function runBulkAction(action) {
      let targets = notes.filter(note => selectedNoteIds.has(note.id));
      if (!targets.length) { toast('Select at least one note first.', 'error'); return; }
      if (action === 'export') { await exportNotesJson(targets); return; }
      if (action === 'delete') {
        if (!(await uiConfirm({ title: `Delete ${targets.length} ${targets.length === 1 ? 'note' : 'notes'}?`, message: 'The selected notes and their attachments will be permanently removed. This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
        if (cloudUid && cloudSyncPromise) { try { await cloudSyncPromise; } catch {} }
        targets = notes.filter(note => selectedNoteIds.has(note.id));
        if (!targets.length) return;
        const undoSnaps = await snapshotNotesForUndo(targets);
        const deletedIds = new Set(targets.map(note => note.id));
        deletedIds.forEach(clearReaderPosition);
        notes = notes.filter(note => !deletedIds.has(note.id));
        if (deletedIds.has(activeId)) activeId = '';
        keepInTrash(undoSnaps);
        targets.forEach(note => {
          const objectUrl = objectUrlCache.get(note.id);
          if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrlCache.delete(note.id); }
          if (cloudUid) {
            setCloudDeletion(cloudUid, note.id, { filePath:note.filePath || '', deletedAt:Date.now() });
            markPending(cloudUid, note.id, false);
          }
        });
        if (cloudUid) writeCloudCache(cloudUid, notes); else localNotesWrite();
        selectedNoteIds.clear(); selectionMode = false;
        replaceCurrentAppRoute(); renderEverything();
        offerUndo(undoSnaps);
        if (cloudUid) {
          if (!navigator.onLine) { setSyncState('offline'); toast(`Deleted ${targets.length} notes here. Firebase will sync when you reconnect.`, 'error', 5200); return; }
          try { await syncCloudWorkspace(cloudUid); toast(`${targets.length} notes deleted and synced.`); }
          catch (error) { console.warn('Bulk delete is queued for Firebase retry:', error); setSyncState('pending'); toast(`Deleted ${targets.length} notes locally. Firebase will retry.`, 'error', 5200); }
        } else toast(`${targets.length} ${targets.length === 1 ? 'note' : 'notes'} deleted.`);
        return;
      }
      let destination = '';
      const moveSnaps = action === 'move' ? await snapshotNotesForUndo(targets) : null;
      if (action === 'move') {
        const value = await pickFolderDialog({ title: 'Move to folder', message: `Move ${targets.length} selected ${targets.length === 1 ? 'note' : 'notes'} to:`, current: targets.length === 1 ? (targets[0].folderPath || '') : '', confirmLabel: `Move ${targets.length} ${targets.length === 1 ? 'note' : 'notes'}` });
        if (value == null) return;
        destination = cleanFolderPath(value) || 'General';
        addFolderPath(destination);
      }
      const now = Date.now();
      if (action === 'star') {
        const shouldStar = !targets.every(note => note.favorite);
        targets.forEach(note => { note.favorite = shouldStar; note.updatedAt = now; });
      } else if (action === 'review') {
        const shouldReturnToQueue = targets.every(note => !isReviewDue(note));
        targets.forEach(note => scheduleNoteReview(note, shouldReturnToQueue ? 'reset' : 'good', now));
      } else if (action === 'move') targets.forEach(note => { note.folderPath = destination; note.updatedAt = now; });
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      let syncFailed = false;
      if (cloudUid) {
        const results = await Promise.allSettled(targets.map(note => persistNote(note)));
        syncFailed = results.some(result => result.status === 'rejected');
      } else localNotesWrite();
      selectedNoteIds.clear(); selectionMode = false;
      renderEverything();
      if (syncFailed) toast('Changes saved on this device. Some Firebase updates are queued for retry.', 'error', 5200);
      else toast(action === 'star' ? 'Starred status updated.' : action === 'review' ? 'Spaced review schedules updated.' : `${targets.length} notes moved to ${destination}.`);
      if (moveSnaps) offerUndo(moveSnaps, 'Notes moved');
    }
    function closeCommandPalette(restoreFocus = false) {
      $('#command-overlay').classList.add('hidden');
      $('#command-overlay').setAttribute('aria-hidden', 'true');
      $('#command-input').removeAttribute('aria-activedescendant');
      const target = commandReturnFocus;
      commandReturnFocus = null;
      if (restoreFocus && target?.isConnected) target.focus({ preventScroll:true });
    }
    function commandActions() {
      return [
        { id:'new-note', label:'Create a note', detail:'Start a fresh page', icon:'note', category:'Create' },
        { id:'import', label:'Import files', detail:'Add PDFs, images, HTML, text, and more', icon:'download', category:'Create' },
        { id:'home', label:'Go to Home', detail:'Return to your study dashboard', icon:'open', category:'Navigate' },
        { id:'all', label:'Browse all notes', detail:'Open the full library', icon:'file', category:'Navigate' },
        { id:'starred', label:'Open Starred', detail:'See notes saved for later', icon:'star', category:'Navigate' },
        { id:'recent', label:'Open Recently viewed', detail:'Return to notes you opened', icon:'recent', category:'Navigate' },
        { id:'review', label:'Open review queue', detail:'Find notes whose spaced review is due', icon:'check', category:'Navigate' },
        { id:'study', label:'Start a study session', detail:'Review due notes with spaced repetition', icon:'check', category:'Study' },
        { id:'theme', label:document.documentElement.dataset.theme === 'light' ? 'Switch to dark appearance' : 'Switch to light appearance', detail:'Change the workspace theme', icon:'theme', category:'Appearance' },
        { id:'export', label:'Export notes as JSON', detail:'Download a portable text-and-metadata file', icon:'download', category:'Workspace' },
        { id:'restore', label:'Import Notez JSON', detail:'Merge an existing Notez export into this workspace', icon:'file', category:'Workspace' },
        { id:'back', label:'Go back', detail:'Return to the previous page', icon:'open', category:'Navigate' },
        { id:'ai', label:'Ask NotezAi', detail:'Chat about your notes, quizzes and summaries', icon:'star', category:'AI' },
        { id:'record', label:'Record class or meeting', detail:'Live transcript with speaker labels and notes', icon:'note', category:'AI' },
        { id:'paste', label:'Paste text as a note', detail:'Turn clipboard text into a note', icon:'note', category:'Create' },
        { id:'focus', label:'Open focus timer', detail:'Pomodoro, daily goal and exam countdown', icon:'recent', category:'Study' },
        { id:'insights', label:'Library insights', detail:'Coverage, activity and storage', icon:'check', category:'Study' },
        { id:'settings', label:'Open Settings', detail:'Appearance, study, privacy, data, AI and help', icon:'open', category:'Workspace' },
        { id:'trash', label:'Open Trash', detail:'Restore notes deleted in the last 30 days', icon:'trash', category:'Workspace' },
        { id:'duplicates', label:'Find duplicate notes', detail:'Review and clean up repeated notes', icon:'note', category:'Workspace' },
        { id:'cleanup', label:'Clean up empty folders', detail:'Remove folders that hold no notes', icon:'folder', category:'Workspace' },
        { id:'export-all', label:'Export everything (ZIP)', detail:'Every note as files, in its folder structure', icon:'download', category:'Workspace' },
        { id:'study-folder', label:'Study this folder', detail:'Review due and new notes in the folder you are viewing', icon:'recent', category:'Study' },
        { id:'deck', label:'Study flashcards in this folder', detail:'One deck from every Q/A card in the folder and its subfolders', icon:'star', category:'Study' },
        { id:'shortcuts', label:'Keyboard shortcuts', detail:'See every shortcut', icon:'open', category:'Help' }
      ];
    }
    function renderCommandResults() {
      const query = ($('#command-input').value || '').trim().toLowerCase();
      const actions = commandActions().filter(item => `${item.label} ${item.detail} ${item.category}`.toLowerCase().includes(query));
      const sortedNotes = [...notes].filter(note => !query || `${note.title} ${note.subject} ${note.folderPath} ${(note.tags || []).join(' ')} ${note.body}`.toLowerCase().includes(query))
        .sort((a,b) => (b.lastViewedAt || b.updatedAt) - (a.lastViewedAt || a.updatedAt)).slice(0, query ? 7 : 4);
      commandEntries = [
        ...sortedNotes.map(note => ({ type:'note', id:note.id, label:note.title, detail:`${cleanFolderPath(note.folderPath) || note.subject || 'Unfiled'} · ${kindLabel(note.kind)}`, icon:note.kind })),
        ...actions.map(action => ({ type:'action', ...action }))
      ];
      let html = '';
      if (sortedNotes.length) html += `<div class="command-section-label">${query ? 'MATCHING NOTES' : 'RECENT NOTES'}</div>`;
      let globalIndex = 0;
      for (const entry of commandEntries) {
        if (globalIndex === sortedNotes.length && actions.length) html += `<div class="command-section-label">ACTIONS</div>`;
        const index = globalIndex++;
        html += `<button type="button" class="command-option ${index === commandActiveIndex ? 'active' : ''}" id="command-option-${index}" role="option" aria-selected="${index === commandActiveIndex}" data-command-index="${index}"><span class="command-option-icon">${svgIcon(entry.icon,15)}</span><span class="command-option-copy"><strong>${esc(entry.label)}</strong><small>${esc(entry.detail)}</small></span><kbd>↵</kbd></button>`;
      }
      if (!commandEntries.length) html = `<div class="command-empty">No notes or actions match “${esc(query)}”.</div>`;
      $('#command-results').innerHTML = html;
      commandActiveIndex = commandEntries.length ? Math.max(0, Math.min(commandActiveIndex, commandEntries.length - 1)) : 0;
      const active = $(`#command-option-${commandActiveIndex}`);
      if (active) $('#command-input').setAttribute('aria-activedescendant', active.id);
      else $('#command-input').removeAttribute('aria-activedescendant');
    }
    function openCommandPalette() {
      if (!currentSession) return;
      closeActionMenu(); closeAccountMenu(); closeSortMenu();
      commandReturnFocus = document.activeElement;
      $('#command-overlay').classList.remove('hidden');
      $('#command-overlay').setAttribute('aria-hidden', 'false');
      $('#command-input').value = '';
      commandActiveIndex = 0;
      renderCommandResults();
      $('#command-input').focus({ preventScroll:true });
    }
    function executeCommandEntry(index) {
      const entry = commandEntries[index];
      if (!entry) return;
      closeCommandPalette(false);
      if (entry.type === 'note') { openNote(entry.id); return; }
      if (entry.id === 'new-note') openEditor();
      else if (entry.id === 'import') $('#file-input').click();
      else if (entry.id === 'home') navigateToPage('home','all');
      else if (entry.id === 'all') navigateToPage('notes','all');
      else if (entry.id === 'starred') navigateToPage('notes','starred');
      else if (entry.id === 'recent') navigateToPage('notes','recent');
      else if (entry.id === 'review') navigateToPage('notes','review');
      else if (entry.id === 'study') startStudySession();
      else if (entry.id === 'theme') toggleTheme();
      else if (entry.id === 'ai') openNotezAi(null);
      else if (entry.id === 'record') openRecorder();
      else if (entry.id === 'paste') quickCaptureFromClipboard();
      else if (entry.id === 'focus') window.nzToggleFocus?.();
      else if (entry.id === 'insights') $('#insights-menu')?.click();
      else if (entry.id === 'settings') showSettingsHub('general');
      else if (entry.id === 'trash') showTrash();
      else if (entry.id === 'duplicates') showDuplicates();
      else if (entry.id === 'cleanup') cleanEmptyFolders();
      else if (entry.id === 'export-all') exportFolderZip('');
      else if (entry.id === 'shortcuts') toggleShortcuts(true);
      else if (entry.id === 'study-folder') startStudySession(currentFolderPath || '');
      else if (entry.id === 'deck') studyFlashcardDeck(currentFolderPath || '');
      else if (entry.id === 'export') void exportNotesJson();
      else if (entry.id === 'restore') $('#backup-input').click();
      else if (entry.id === 'back') goBackInApp(currentPage === 'reader' ? previousPage : 'home');
    }
    function renderViewer(note) {
      destroyPdfReader();
      readerRenderedId = note.id;
      removeHtmlExtractionProbe();
      $('#note-view').classList.toggle('html-attachment-reading', note.kind === 'html');
      $('#note-view').classList.toggle('pdf-attachment-reading', isPdfNote(note));
      const trailPath = cleanFolderPath(note.folderPath || '');
      const trailParts = trailPath ? trailPath.split('/') : [];
      const trailButtons = [`<button type="button" class="crumb-btn" data-crumb="all">All notes</button>`,
        ...trailParts.map((part, i) => `<button type="button" class="crumb-btn" data-crumb-folder="${esc(trailParts.slice(0, i + 1).join('/'))}" title="Open ${esc(trailParts.slice(0, i + 1).join(' / '))}">${esc(part)}</button>`)];
      $('#reader-crumb-path').innerHTML = trailButtons.join('<span class="crumb-sep" aria-hidden="true">›</span>') + `<span class="crumb-sep" aria-hidden="true">›</span><strong id="reader-crumb-title">${esc(note.title)}</strong>`;
      $('#reader-title').textContent = note.title;
      $('#reader-subject').textContent = note.subject || 'General';
      $('#reader-date').textContent = `Updated ${dateText(note.updatedAt)}`;
      $('#reader-kind').textContent = isPdfNote(note) ? kindLabel('pdf') : isPptxNote(note) ? 'PRESENTATION' : kindLabel(note.kind);
      const tags = note.tags || [];
      $('#reader-tags').textContent = tags.slice(0, 3).join(' · ');
      $('#tag-divider').classList.toggle('hidden', !tags.length);
      const count = wordCount(note.kind === 'html' ? readableHtmlForNote(note) : note.body);
      $('#reader-word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
      const minutes = Math.max(1, Math.ceil(count / 220));
      $('#reading-time').textContent = isPdfNote(note) ? 'PDF document' : isPptxNote(note) ? 'Presentation' : note.kind === 'file' ? 'Attached file' : `${minutes} min read`;
      const favorite = $('#favorite-current');
      favorite.classList.toggle('starred', note.favorite);
      favorite.title = note.favorite ? 'Remove from starred' : 'Add to starred';
      favorite.setAttribute('aria-label', favorite.title);
      setReviewPopover(false);
      updateReviewControl(note);
      renderStudySessionBar(note);
      $('#reader-outline').classList.add('hidden');
      $('#reader-outline-list').classList.add('hidden');
      $('#reader-outline-toggle').setAttribute('aria-expanded', 'false');
      $('#viewer-content').innerHTML = '<p class="subtle">Preparing your note…</p>';
      readerPositionRestorePendingId = note.id;
      void renderNoteBody(note).then(() => {
        if (currentPage !== 'reader' || activeId !== note.id) return;
        restoreReaderPosition(note.id);
        requestAnimationFrame(() => { if (readerPositionRestorePendingId === note.id) readerPositionRestorePendingId = ''; });
      });
      $('#workspace-main').scrollTop = 0;
    }
    function localAttachmentUrl(note, blob) {
      let url = objectUrlCache.get(note.id);
      if (!url) { url = URL.createObjectURL(blob); objectUrlCache.set(note.id, url); }
      activeObjectUrl = url;
      return { url, blob };
    }
    async function resolveAttachment(note) {
      const cachedBlob = await getLocalFile(note.id);
      if (cachedBlob) return localAttachmentUrl(note, cachedBlob);
      if (currentSession?.mode === 'cloud' && note.filePath) {
        try {
          const sdk = await ensureFirebase();
          const blob = await downloadCloudFile(sdk, note.filePath);
          if (!blob) return null;
          try { await storeLocalFile(note.id, blob); } catch (error) { console.info('Local mirror will fill on a later open:', error); }
          return localAttachmentUrl(note, blob);
        } catch (error) {
          console.warn('Firebase attachment unavailable:', error);
          return null;
        }
      }
      return null;
    }
    function renderAttachmentCard(note, url, mime = '') {
      const title = note.fileName || note.title;
      const size = note.fileSize ? formatBytes(note.fileSize) : '';
      const download = url ? `<a class="attachment-download" href="${esc(url)}" download="${esc(title)}" target="_blank" rel="noopener"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Download file</a>` : '';
      $('#viewer-content').innerHTML = `<div class="attachment-card"><div class="attachment-card-icon">${svgIcon(note.kind,22)}</div><div class="attachment-card-meta"><strong>${esc(title)}</strong><span>${esc(mime || note.mimeType || kindLabel(note.kind))}${size ? ` · ${esc(size)}` : ''}</span></div>${download}</div>${note.body ? `<div style="margin-top:28px">${markdownToHtml(note.body)}</div>` : '<p class="subtle" style="margin-top:22px">Add a summary or study notes with the Edit button.</p>'}`;
    }
    function appendTextExcerptNotice(root) {
      const notice = document.createElement('p');
      notice.className = 'html-source-unavailable';
      notice.textContent = 'Showing a saved excerpt. Reattach the original file to view or edit the complete text.';
      root.append(notice);
    }
    async function attachmentText(attachment) {
      if (attachment?.blob) return attachment.blob.text();
      if (attachment?.url) {
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`Attachment request failed (${response.status})`);
        return response.text();
      }
      return '';
    }
    function pdfReaderMarkup(note, attachment) {
      const title = note.fileName || note.title || 'PDF document';
      const size = note.fileSize ? formatBytes(note.fileSize) : 'PDF document';
      const url = String(attachment?.url || '');
      const safeUrl = esc(url);
      const safeName = esc(note.fileName || note.title || 'document.pdf');
      return `<section class="pdf-reader" id="pdf-reader" aria-label="PDF reader">
        <header class="pdf-reader-toolbar">
          <div class="pdf-file-meta"><span class="pdf-type-badge" aria-hidden="true">PDF</span><span class="pdf-file-copy"><strong title="${esc(title)}">${esc(title)}</strong><small>${esc(size)} · private in-browser reader</small></span></div>
          <div class="pdf-toolbar-group pdf-pagination" aria-label="PDF page navigation">
            <button class="pdf-control-button" type="button" data-pdf-control="previous" title="Previous page" aria-label="Previous page"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="m14.5 5-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <input class="pdf-page-number" id="pdf-page-number" type="number" min="1" value="1" aria-label="Current PDF page" />
            <span class="pdf-page-total">of <span id="pdf-page-total">—</span></span>
            <button class="pdf-control-button" type="button" data-pdf-control="next" title="Next page" aria-label="Next page"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="m9.5 5 7 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
          <div class="pdf-toolbar-group pdf-zoom-controls" aria-label="PDF zoom">
            <button class="pdf-control-button" type="button" data-pdf-control="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
            <output class="pdf-zoom-readout" id="pdf-zoom-readout">Fit</output>
            <button class="pdf-control-button" type="button" data-pdf-control="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="pdf-control-button" type="button" data-pdf-control="fit-width" title="Fit page to width" aria-label="Fit page to width">Fit</button>
          </div>
          <div class="pdf-toolbar-group pdf-toolbar-actions">
            <a class="pdf-download-control" href="${safeUrl}" download="${safeName}" title="Download this PDF"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Download</span></a>
            <a class="pdf-download-control pdf-open-original" href="${safeUrl}" target="_blank" rel="noopener" title="Open the original PDF in a new tab">Open original</a>
            <button class="pdf-focus-toggle" id="pdf-focus-toggle" type="button" title="Enter distraction-free full-screen reading" aria-label="Enter distraction-free full-screen reading" aria-pressed="false"><svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Focus</span></button>
          </div>
        </header>
        <div class="pdf-reader-status" id="pdf-reader-status" role="status" aria-live="polite">Loading the PDF…</div>
        <div class="pdf-reader-viewport" id="pdf-reader-viewport" role="region" aria-label="PDF page view" tabindex="0"><div class="pdf-page-stage" id="pdf-page-stage"><canvas id="pdf-page-canvas" aria-label="PDF page"></canvas></div></div>
        <footer class="pdf-reader-footer"><span id="pdf-page-status" aria-live="polite">Preparing document…</span><span>← → / Page Up · Page Down to turn pages · + / − to zoom</span></footer>
      </section>
      ${note.body ? `<section class="pdf-study-notes"><h2>Study notes</h2><div class="markdown-body">${markdownToHtml(note.body)}</div></section>` : ''}`;
    }
    function setPdfReaderStatus(state, message = '', isError = false) {
      const status = state?.root?.querySelector('#pdf-reader-status');
      if (!status) return;
      status.textContent = message;
      status.classList.toggle('hidden', !message);
      status.classList.toggle('is-error', Boolean(isError));
    }
    function updatePdfFocusControl() {
      const button = $('#pdf-focus-toggle');
      if (!button) return;
      const focused = $('#app-shell').classList.contains('focus-mode');
      button.innerHTML = focused
        ? '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M9 4v5H4m11-5v5h5M4 15h5v5m6 0v-5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Exit focus</span>'
        : '<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Focus</span>';
      button.title = focused ? 'Exit distraction-free reading' : 'Enter distraction-free full-screen reading';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(focused));
    }
    function updatePdfReaderChrome(state) {
      const total = state.pdfDocument?.numPages || 0;
      const pageInput = state.root.querySelector('#pdf-page-number');
      const totalLabel = state.root.querySelector('#pdf-page-total');
      const statusLabel = state.root.querySelector('#pdf-page-status');
      const zoomLabel = state.root.querySelector('#pdf-zoom-readout');
      if (pageInput) { pageInput.max = String(Math.max(1,total)); pageInput.value = String(state.pageNumber); }
      if (totalLabel) totalLabel.textContent = total ? String(total) : '—';
      if (statusLabel) statusLabel.textContent = total ? `Page ${state.pageNumber} of ${total}` : 'Preparing document…';
      if (zoomLabel) zoomLabel.textContent = state.zoomMode === 'fit' ? `Fit · ${Math.round((state.currentScale || 1) * 100)}%` : `${Math.round(state.scale * 100)}%`;
      state.root.querySelectorAll('[data-pdf-control]').forEach(button => {
        const action = button.dataset.pdfControl;
        button.disabled = !total || action === 'previous' && state.pageNumber <= 1 || action === 'next' && state.pageNumber >= total;
      });
      if (pageInput) pageInput.disabled = !total;
      updatePdfFocusControl();
    }
    function pdfReaderPositionRatio(state) {
      const total = state.pdfDocument?.numPages || 1;
      const viewport = state.root.querySelector('#pdf-reader-viewport');
      const room = viewport ? viewport.scrollHeight - viewport.clientHeight : 0;
      const insidePage = room > 0 ? Math.max(0,Math.min(1,viewport.scrollTop / room)) : 0;
      return Math.max(0,Math.min(1,(state.pageNumber - 1 + insidePage) / total));
    }
    function savePdfReaderPosition(state) {
      if (!state?.pdfDocument || state.cancelled || currentPage !== 'reader') return;
      const ratio = pdfReaderPositionRatio(state);
      storeReaderPosition(state.noteId, ratio, 'pdf');
      setReaderProgressPercent(ratio * 100);
    }
    function destroyPdfReader() {
      const state = activePdfReaderState;
      if (!state) return;
      state.cancelled = true;
      if (state.saveTimer) clearTimeout(state.saveTimer);
      if (state.resizeTimer) clearTimeout(state.resizeTimer);
      state.resizeObserver?.disconnect();
      if (state.handleResize) window.removeEventListener('resize',state.handleResize);
      try { state.renderTask?.cancel(); } catch {}
      try { if (state.loadingTask?.destroy) Promise.resolve(state.loadingTask.destroy()).catch(() => {}); else if (state.pdfDocument?.destroy) Promise.resolve(state.pdfDocument.destroy()).catch(() => {}); } catch {}
      if (activePdfReaderState === state) activePdfReaderState = null;
    }
    async function loadPdfJs() {
      const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
      if (typeof Promise.withResolvers !== 'function') Promise.withResolvers = function() {
        let resolve, reject;
        const promise = new Promise((done,fail) => { resolve = done; reject = fail; });
        return { promise, resolve, reject };
      };
      if (!pdfJsPromise) {
        pdfJsPromise = import(`${base}pdf.mjs`).then(module => {
          module.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.mjs`;
          return module;
        }).catch(error => { pdfJsPromise = null; throw error; });
      }
      return pdfJsPromise;
    }
    async function getPdfBytes(attachment) {
      if (attachment?.blob) return new Uint8Array(await attachment.blob.arrayBuffer());
      if (!attachment?.url) throw new Error('No PDF file is available.');
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`PDF request failed (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    }
    async function renderPdfPage(state) {
      if (state.cancelled || !state.pdfDocument || activePdfReaderState !== state) return;
      try { state.renderTask?.cancel(); } catch {}
      const renderId = ++state.renderId;
      const page = await state.pdfDocument.getPage(state.pageNumber);
      if (state.cancelled || activePdfReaderState !== state || renderId !== state.renderId) return;
      const container = state.root.querySelector('#pdf-reader-viewport');
      const canvas = state.root.querySelector('#pdf-page-canvas');
      const stage = state.root.querySelector('#pdf-page-stage');
      const baseViewport = page.getViewport({ scale:1 });
      const availableWidth = Math.max(220,(container?.clientWidth || 700) - 44);
      const fitScale = Math.max(.35,Math.min(2.2,availableWidth / baseViewport.width));
      const scale = state.zoomMode === 'fit' ? fitScale : state.scale;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(2,Math.max(1,window.devicePixelRatio || 1));
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      stage.style.width = `${Math.ceil(viewport.width)}px`;
      stage.style.height = `${Math.ceil(viewport.height)}px`;
      canvas.setAttribute('aria-label', `Page ${state.pageNumber} of ${state.pdfDocument.numPages}`);
      const context = canvas.getContext('2d', { alpha:false });
      const task = page.render({ canvasContext:context, viewport, transform:ratio === 1 ? null : [ratio,0,0,ratio,0,0], background:'#ffffff' });
      state.renderTask = task;
      state.currentScale = scale;
      updatePdfReaderChrome(state);
      await task.promise;
      if (state.cancelled || activePdfReaderState !== state || renderId !== state.renderId) return;
      state.renderTask = null;
      setPdfReaderStatus(state, '');
      updatePdfReaderChrome(state);
    }
    function runPdfRender(state) {
      renderPdfPage(state).catch(error => {
        if (state.cancelled || activePdfReaderState !== state || error?.name === 'RenderingCancelledException') return;
        console.warn('Could not render this PDF page:', error);
        setPdfReaderStatus(state, 'This page could not be rendered. Try another page or open the original PDF.', true);
      });
    }
    function showNativePdfFallback(state, error) {
      if (state.cancelled || activePdfReaderState !== state) return;
      console.warn('Enhanced PDF reader unavailable; using the browser PDF viewer:', error);
      const viewport = state.root.querySelector('#pdf-reader-viewport');
      const input = state.root.querySelector('#pdf-page-number');
      if (viewport && state.attachment?.url) {
        const frame = document.createElement('iframe');
        frame.className = 'pdf-native-fallback';
        frame.title = `${state.note.title} PDF preview`;
        frame.src = `${state.attachment.url}#toolbar=1&navpanes=0&view=FitH`;
        viewport.replaceChildren(frame);
      }
      state.root.querySelectorAll('[data-pdf-control]').forEach(button => { button.disabled = true; });
      if (input) input.disabled = true;
      state.root.querySelector('#pdf-page-total').textContent = '—';
      state.root.querySelector('#pdf-page-status').textContent = 'Browser PDF preview · download or open original if it does not appear';
      setPdfReaderStatus(state, 'The enhanced page reader could not load. Your browser’s PDF preview is shown instead.', true);
      updatePdfFocusControl();
    }
    function setPdfPage(state, pageNumber, restoreFraction = 0) {
      const total = state.pdfDocument?.numPages || 1;
      state.pageNumber = Math.max(1,Math.min(total,Math.floor(Number(pageNumber) || 1)));
      state.restoreFraction = Math.max(0,Math.min(1,Number(restoreFraction) || 0));
      const viewport = state.root.querySelector('#pdf-reader-viewport');
      if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
      updatePdfReaderChrome(state);
      savePdfReaderPosition(state);
      runPdfRender(state);
      if (state.restoreFraction > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (state.cancelled || activePdfReaderState !== state) return;
          const target = state.root.querySelector('#pdf-reader-viewport');
          const room = target.scrollHeight - target.clientHeight;
          if (room > 0) target.scrollTop = room * state.restoreFraction;
          state.restoreFraction = 0;
          savePdfReaderPosition(state);
        }));
      }
    }
    function wirePdfReader(state) {
      const root = state.root;
      const pageInput = root.querySelector('#pdf-page-number');
      const viewport = root.querySelector('#pdf-reader-viewport');
      root.querySelector('[data-pdf-control="previous"]').addEventListener('click', () => setPdfPage(state,state.pageNumber - 1));
      root.querySelector('[data-pdf-control="next"]').addEventListener('click', () => setPdfPage(state,state.pageNumber + 1));
      pageInput.addEventListener('change', () => setPdfPage(state,pageInput.value));
      pageInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); setPdfPage(state,pageInput.value); pageInput.blur(); } });
      root.querySelector('[data-pdf-control="zoom-in"]').addEventListener('click', () => {
        if (state.zoomMode === 'fit') state.scale = state.currentScale || 1;
        state.zoomMode = 'manual'; state.scale = Math.min(3,Math.round((state.scale * 1.18) * 100) / 100); updatePdfReaderChrome(state); runPdfRender(state);
      });
      root.querySelector('[data-pdf-control="zoom-out"]').addEventListener('click', () => {
        if (state.zoomMode === 'fit') state.scale = state.currentScale || 1;
        state.zoomMode = 'manual'; state.scale = Math.max(.4,Math.round((state.scale / 1.18) * 100) / 100); updatePdfReaderChrome(state); runPdfRender(state);
      });
      root.querySelector('[data-pdf-control="fit-width"]').addEventListener('click', () => { state.zoomMode = 'fit'; runPdfRender(state); });
      root.querySelector('#pdf-focus-toggle').addEventListener('click', toggleFocus);
      viewport.addEventListener('pointerdown',event => {
        if (!event.target.closest('input,button,a')) viewport.focus({ preventScroll:true });
      });
      viewport.addEventListener('scroll', () => {
        if (!state.pdfDocument || state.cancelled) return;
        const ratio = pdfReaderPositionRatio(state);
        setReaderProgressPercent(ratio * 100);
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(() => savePdfReaderPosition(state), 180);
      }, { passive:true });
      viewport.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); setPdfPage(state,state.pageNumber - 1); }
        else if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); setPdfPage(state,state.pageNumber + 1); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); root.querySelector('[data-pdf-control="zoom-in"]').click(); }
        else if (event.key === '-' || event.key === '_') { event.preventDefault(); root.querySelector('[data-pdf-control="zoom-out"]').click(); }
      });
      if ('ResizeObserver' in window) {
        state.resizeObserver = new ResizeObserver(() => {
          if (!state.cancelled && state.pdfDocument && state.zoomMode === 'fit') {
            clearTimeout(state.resizeTimer);
            state.resizeTimer = window.setTimeout(() => runPdfRender(state), 90);
          }
        });
        state.resizeObserver.observe(viewport);
      } else {
        state.handleResize = () => { if (!state.cancelled && state.pdfDocument && state.zoomMode === 'fit') runPdfRender(state); };
        window.addEventListener('resize', state.handleResize);
      }
    }
