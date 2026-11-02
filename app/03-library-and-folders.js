async function loadPdfReader(state) {
      try {
        setPdfReaderStatus(state, 'Loading PDF and preparing the reader…');
        const [pdfjs, bytes] = await Promise.all([loadPdfJs(),getPdfBytes(state.attachment)]);
        if (state.cancelled || activePdfReaderState !== state) return;
        state.loadingTask = pdfjs.getDocument({ data:bytes, useSystemFonts:true });
        state.pdfDocument = await state.loadingTask.promise;
        if (state.cancelled || activePdfReaderState !== state) return;
        const saved = readReaderPosition(state.noteId);
        let restoreFraction = 0;
        if (saved?.mode === 'pdf') {
          const scaled = Math.max(0,Math.min(state.pdfDocument.numPages,saved.ratio * state.pdfDocument.numPages));
          const index = Math.min(state.pdfDocument.numPages - 1,Math.floor(scaled));
          state.pageNumber = index + 1;
          restoreFraction = index === state.pdfDocument.numPages - 1 && scaled >= state.pdfDocument.numPages ? 1 : scaled - index;
        }
        updatePdfReaderChrome(state);
        await renderPdfPage(state);
        if (state.cancelled || activePdfReaderState !== state) return;
        if (restoreFraction > 0) {
          requestAnimationFrame(() => {
            if (state.cancelled || activePdfReaderState !== state) return;
            const viewport = state.root.querySelector('#pdf-reader-viewport');
            const room = viewport.scrollHeight - viewport.clientHeight;
            if (room > 0) viewport.scrollTop = room * restoreFraction;
            savePdfReaderPosition(state);
          });
        } else savePdfReaderPosition(state);
      } catch (error) {
        if (error?.name === 'RenderingCancelledException' || state.cancelled || activePdfReaderState !== state) return;
        showNativePdfFallback(state,error);
      }
    }
    function renderPdfReader(note, attachment) {
      destroyPdfReader();
      const root = $('#viewer-content');
      root.innerHTML = pdfReaderMarkup(note,attachment);
      const state = { noteId:note.id, note, attachment, root, pdfDocument:null, loadingTask:null, renderTask:null, renderId:0, pageNumber:1, zoomMode:'fit', scale:1, currentScale:1, restoreFraction:0, cancelled:false, saveTimer:0, resizeTimer:0, resizeObserver:null, handleResize:null };
      activePdfReaderState = state;
      wirePdfReader(state);
      updatePdfReaderChrome(state);
      void loadPdfReader(state);
    }
    function htmlReadableBridge(token) {
      const skipped = new Set(['script','style','noscript','iframe','object','embed','canvas','head','meta','link','base','nav']);
      const block = new Set(['address','article','aside','blockquote','dd','div','dl','dt','figcaption','figure','footer','h1','h2','h3','h4','h5','h6','header','hr','li','main','ol','p','pre','section','table','tbody','td','th','thead','tr','ul']);
      let lastReadable = '';
      document.addEventListener('click', event => {
        const link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
        if (!link) return;
        const id = decodeURIComponent((link.getAttribute('href') || '').slice(1));
        const target = id ? (document.getElementById(id) || document.getElementsByName(id)[0]) : null;
        if (!target) return;
        event.preventDefault();
        let offset = 0;
        document.querySelectorAll('nav,header,[class*=sticky],[class*=nav]').forEach(el => { const cs = getComputedStyle(el); if ((cs.position === 'sticky' || cs.position === 'fixed') && el.getBoundingClientRect().top < 10) offset = Math.max(offset, el.getBoundingClientRect().height); });
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset - 6, behavior: 'smooth' });
      }, true);
      let reportTimer = 0;
      const walk = node => {
        if (node.nodeType === 3) return node.nodeValue || '';
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role') || '';
        if (skipped.has(tag) || role === 'tablist' || role === 'navigation' || node.hasAttribute('data-notez-ignore')) return '';
        if (tag === 'button' && /^(?:dark mode|light mode|print(?:\s*\/\s*save(?:\s+pdf)?)?|save (?:as )?pdf|reload|expand|back to note)$/i.test((node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())) return '';
        if (tag === 'template') return node.content ? Array.from(node.content.childNodes, walk).join('') : '';
        if (tag === 'img') return node.getAttribute('alt') || '';
        if (tag === 'br' || tag === 'hr') return '\n';
        const content = Array.from(node.childNodes, walk).join('');
        return block.has(tag) ? '\n' + content + '\n' : content;
      };
      const publish = () => {
        if (!document.body) return;
        const readable = window.__nzWalk(document.body);
        if (!readable || readable === lastReadable) return;
        lastReadable = readable;
        parent.postMessage({ type:'notez-readable-html', token:String(token), text:readable }, '*');
      };
      const schedule = () => {
        if (reportTimer) clearTimeout(reportTimer);
        reportTimer = setTimeout(publish, 240);
      };
      const start = () => {
        if (!document.body) return;
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class','hidden','aria-hidden','style'] });
        schedule();
        window.addEventListener('load', schedule, { once:true });
        let scrollTimer = 0;
        const reportScroll = () => {
          const scroller = document.scrollingElement || document.documentElement || document.body;
          const max = Math.max(0, (scroller?.scrollHeight || 0) - window.innerHeight);
          const top = Math.max(0, Number(window.scrollY) || Number(scroller?.scrollTop) || 0);
          parent.postMessage({ type:'notez-html-scroll', token:String(token), ratio:max ? Math.min(1, top / max) : 0 }, '*');
        };
        const reportDetails = () => {
          const all = [...document.querySelectorAll('details')];
          if (!all.length) return;
          parent.postMessage({ type:'notez-html-details', token:String(token), ratio: all.filter(item => item.open).length / all.length }, '*');
        };
        document.addEventListener('toggle', reportDetails, true);
        const queueScroll = () => { if (scrollTimer) clearTimeout(scrollTimer); scrollTimer = setTimeout(reportScroll, 110); };
        window.addEventListener('scroll', queueScroll, { passive:true });
        window.addEventListener('resize', queueScroll, { passive:true });
        window.addEventListener('message', event => {
          const data = event.data;
          if (event.source !== parent || !data || data.type !== 'notez-restore-scroll' || data.token !== String(token)) return;
          const ratio = Math.max(0, Math.min(1, Number(data.ratio) || 0));
          requestAnimationFrame(() => {
            const scroller = document.scrollingElement || document.documentElement || document.body;
            const max = Math.max(0, (scroller?.scrollHeight || 0) - window.innerHeight);
            window.scrollTo(0, max * ratio);
          });
        });
        [800, 2200, 5000].forEach(delay => setTimeout(schedule, delay));
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
      else start();
    }
    function instrumentHtmlSource(source, token) {
      const storageShim = '<scr' + 'ipt>(function(){var m={};var st={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}};try{Object.defineProperty(window,"localStorage",{value:st,configurable:true})}catch(e){}try{Object.defineProperty(window,"sessionStorage",{value:st,configurable:true})}catch(e){}})();</scr' + 'ipt>';
      const bridgeTag = storageShim + '<scr' + 'ipt>window.__nzWalk=(' + notezReadableWalker.toString() + ');(' + htmlReadableBridge.toString() + ')(' + JSON.stringify(token) + ');</scr' + 'ipt>';
      const html = String(source || '');
      const headTag = /<head\b[^>]*>/i;
      if (headTag.test(html)) return html.replace(headTag, opening => opening + bridgeTag);
      const htmlTag = /<html\b[^>]*>/i;
      if (htmlTag.test(html)) return html.replace(htmlTag, opening => opening + '<head>' + bridgeTag + '</head>');
      return bridgeTag + html;
    }
    function setHtmlReadableFrameHandler(frame, handler) {
      const context = htmlReadableFrames.get(frame);
      if (context) context.onText = handler;
    }
    function setHtmlReadableFrameScrollHandler(frame, handler) {
      const context = htmlReadableFrames.get(frame);
      if (context) context.onScroll = handler;
    }
    function mergeHtmlReadableSnapshots(previous, next) {
      const before = String(previous || '').trim();
      const after = String(next || '').trim();
      if (!before) return after;
      if (!after || before.includes(after)) return before;
      if (after.includes(before)) return after;
      const blocks = value => value.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
      const merged = blocks(before);
      const seen = new Set(merged.map(block => block.toLocaleLowerCase().replace(/\s+/g, ' ')));
      for (const block of blocks(after)) {
        const key = block.toLocaleLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) { merged.push(block); seen.add(key); }
      }
      return merged.join('\n\n');
    }
    // ---- Reading progress per note: the furthest point actually reached ----
    const PROGRESS_KEY = 'notez-progress-v1';
    let progressMap = (() => { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; } })();
    let progressSaveTimer = 0;
    function progressOf(note) { const entry = note && progressMap[note.id]; return entry ? Math.max(0, Math.min(1, Number(entry.max) || 0)) : 0; }
    function recordProgress(noteId, ratio, { replace = false } = {}) {
      if (!noteId || !Number.isFinite(ratio)) return;
      const value = Math.max(0, Math.min(1, ratio)), current = progressMap[noteId]?.max || 0;
      const next = replace ? value : Math.max(current, value);
      if (progressMap[noteId] && next === current && !replace) return;
      if (replace && !value) delete progressMap[noteId]; else progressMap[noteId] = { max: next, at: Date.now() };
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(() => { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap)); } catch {} }, 400);
    }
    function trackTextProgress() {
      if (currentPage !== 'reader' || !activeId) return;
      const note = notes.find(item => item.id === activeId);
      if (!note || note.kind === 'html' || isPdfNote(note)) return;
      const view = $('#workspace-main'), max = view.scrollHeight - view.clientHeight;
      recordProgress(note.id, max <= 4 ? 1 : view.scrollTop / max);
    }
    function trackPdfProgress() {
      if (currentPage !== 'reader' || !activeId) return;
      const note = notes.find(item => item.id === activeId);
      if (!note || !isPdfNote(note)) return;
      const page = Number($('#pdf-page-number')?.value) || 0, total = Number($('#pdf-page-total')?.textContent) || 0;
      if (page && total) recordProgress(note.id, page / total);
    }
    $('#workspace-main').addEventListener('scroll', trackTextProgress, { passive: true });
    setInterval(() => { trackTextProgress(); trackPdfProgress(); }, 1000);
    function handleHtmlReadableMessage(event) {
      const data = event.data;
      if (!data || !['notez-readable-html','notez-html-scroll','notez-html-details'].includes(data.type) || typeof data.token !== 'string') return;
      const frame = $$('iframe').find(candidate => candidate.contentWindow === event.source);
      const context = frame && htmlReadableFrames.get(frame);
      if (!context || context.token !== data.token) return;
      if (data.type === 'notez-readable-html' && typeof context.onText === 'function') {
        const text = String(data.text || '').trim();
        if (text) context.onText(text);
      } else if (data.type === 'notez-html-scroll' && typeof context.onScroll === 'function') {
        context.onScroll(Math.max(0, Math.min(1, Number(data.ratio) || 0)));
        recordProgress(context.noteId, Number(data.ratio) || 0);
      } else if (data.type === 'notez-html-details') {
        recordProgress(context.noteId, Number(data.ratio) || 0);
      }
    }
    // ---- Smart HTML notes: detect cut-off files and recover text hidden in scripts ----
    function analyzeHtmlSource(source) {
      const html = String(source || '');
      const opens = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
      const closes = (html.match(/<\/script\s*>/gi) || []).length;
      if (opens > closes) return { truncated: true, message: 'This HTML file looks cut off: its script never closes, so browsers will not run it and tabs, quizzes and other interactive parts cannot work. The text that exists in the file is still recovered under "Readable text". Re-export the full file to restore interactivity.' };
      if (html.length > 3000 && !/<\/html\s*>/i.test(html)) return { truncated: true, message: 'This HTML file has no closing </html> tag, so it may be incomplete.' };
      return { truncated: false, message: '' };
    }
    function htmlFragmentToText(fragment) {
      return String(fragment)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
        .replace(/<li\b[^>]*>/gi, '\n• ')
        .replace(/<\/(?:h[1-6]|p|li|div|tr|section|ul|ol|table|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\n+• /g, '\n• ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function recoverHtmlSourceText(source) {
      const html = String(source || '');
      const found = [], seen = new Set();
      const scripts = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)(?:<\/script\s*>|$)/gi;
      const tokens = /`(?:\\[\s\S]|[^`\\])*(?:`|$)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
      let script;
      while ((script = scripts.exec(html))) {
        let token;
        while ((token = tokens.exec(script[1]))) {
          const raw = token[0];
          if (raw[0] === '/') continue;
          let value = raw.slice(1, raw.endsWith(raw[0]) && raw.length > 1 ? -1 : undefined)
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\n/g, '\n').replace(/\\t/g, ' ').replace(/\\(["'`\\\/])/g, '$1');
          const hasTags = /<[a-z][^>]*>/i.test(value);
          const words = value.trim().split(/\s+/).length;
          const nonLatin = /[^\u0000-\u024f\s\d\p{P}]/u.test(value);
          if (value.length < 8 || words < 2 || (!hasTags && !nonLatin && words < 6) || /^(?:https?:|data:|[#.][\w-]+)/.test(value.trim())) continue;
          const text = hasTags ? htmlFragmentToText(value) : value.trim();
          const key = text.replace(/\s+/g, ' ');
          if (text && !seen.has(key)) { seen.add(key); found.push(text); }
        }
      }
      return found.join('\n\n');
    }
    function updateHtmlReadableText(noteId, text, textElement = null) {
      let readable = String(text || '').trim();
      if (!readable) return;
      const note = notes.find(item => item.id === noteId);
      if (note && note.kind === 'html') {
        // Merge in text that only exists inside scripts (JS-built pages, cut-off files).
        const recovered = recoverHtmlSourceText(htmlSourceForNote(note));
        if (recovered) readable = recovered.length > readable.length ? mergeHtmlReadableSnapshots(recovered, readable) : mergeHtmlReadableSnapshots(readable, recovered);
      }
      if (textElement) textElement.textContent = readable;
      if (note && note.kind === 'html') {
        const sourceKey = htmlReadableFingerprint(note);
        if (note.htmlReadableText !== readable || note.htmlReadableSourceKey !== sourceKey) {
          note.htmlReadableText = readable;
          note.htmlReadableSourceKey = sourceKey;
          saveCurrentData();
        }
      }
      if (activeId === noteId) {
        const count = wordCount(readable);
        $('#reader-word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
        $('#reading-time').textContent = `${Math.max(1, Math.ceil(count / 220))} min read`;
      }
      if (currentPage === 'editor' && editorId === noteId && editorKind === 'html' && htmlEditorMayHydrate) {
        const input = $('#note-body-input');
        if (input.value === htmlEditorSeedText) {
          input.value = readable;
          htmlEditorSeedText = readable;
          updateEditorWordCount();
          queueEditorDraft();
        }
      }
    }
    function hasHtmlReadableFrame(noteId) {
      return $$('iframe').some(frame => htmlReadableFrames.get(frame)?.noteId === String(noteId));
    }
    function removeHtmlExtractionProbe() { $('#html-extraction-probe')?.remove(); }
    function startHtmlExtractionProbe(note, source) {
      if (!note || !source || hasHtmlReadableFrame(note.id)) return;
      removeHtmlExtractionProbe();
      const probe = makeInteractiveHtmlPreview(note, source, false);
      probe.shell.id = 'html-extraction-probe';
      probe.shell.classList.add('html-extraction-probe');
      let receivedRuntimeText = false;
      setHtmlReadableFrameHandler(probe.frame, readable => {
        const currentNote = notes.find(item => item.id === note.id);
        const completeText = receivedRuntimeText ? mergeHtmlReadableSnapshots(currentNote?.htmlReadableText, readable) : readable;
        receivedRuntimeText = true;
        updateHtmlReadableText(note.id, completeText);
      });
      $('#editor-view').append(probe.shell);
    }
    function makeInteractiveHtmlPreview(note, source, toolbar = true) {
      const shell = document.createElement('div');
      shell.className = 'html-preview-shell';
      if (toolbar) {
        const controls = document.createElement('div');
        controls.className = 'html-preview-toolbar';
        controls.innerHTML = '<span class="html-preview-label"><i></i> Interactive preview <small>isolated sandbox</small></span><div class="html-preview-actions"><button type="button" data-html-action="reload">Reload</button><button type="button" data-html-action="expand">Expand</button></div>';
        shell.append(controls);
      }
      const frame = document.createElement('iframe');
      frame.id = toolbar ? 'html-preview-frame' : 'html-editor-frame';
      frame.className = toolbar ? 'attachment-frame html-frame' : 'editor-preview-frame';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.setAttribute('allow', 'fullscreen');
      frame.title = `${note.title} interactive HTML preview`;
      const token = uid();
      htmlReadableFrames.set(frame, { token, noteId:String(note?.id || ''), onText:null, onScroll:null });
      frame.srcdoc = instrumentHtmlSource(source || '<!doctype html><html><body><p>HTML preview is empty.</p></body></html>', token);
      shell.append(frame);
      const health = toolbar ? analyzeHtmlSource(source) : { truncated: false };
      if (health.truncated) {
        const banner = document.createElement('div');
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'padding:10px 14px;margin:0 0 8px;border-radius:8px;background:#fff4dc;color:#6b4a00;font-size:12px;line-height:1.5;border:1px solid #f0d28a';
        banner.textContent = health.message;
        shell.prepend(banner);
      }
      return { shell, frame };
    }
    function makeHtmlReaderView(note, source, readableText) {
      const reading = document.createElement('div');
      reading.className = 'html-reading-shell';
      const hasSource = Boolean(String(source || '').trim());
      const textPanel = document.createElement('section');
      textPanel.className = 'html-readable-panel';
      textPanel.setAttribute('aria-label', 'Readable text extracted from the HTML note');
      const textHeading = document.createElement('div');
      textHeading.className = 'html-readable-heading';
      textHeading.textContent = 'Readable text';
      const textHint = document.createElement('p');
      textHint.className = 'html-readable-hint';
      const hasUserTextLayer = Boolean(note.body && !note.bodyPreviewOnly && !isHtmlSource(note.body));
      textHint.textContent = note.bodyPreviewOnly && !hasSource ? 'Only a saved text excerpt is available here. Reattach the original file to restore the full content; the source remains unchanged.' : hasUserTextLayer ? 'Showing your saved editable text layer; the original interactive HTML remains separate and unchanged.' : 'Extracted from the document, including preloaded sections; text from lazy-loaded views is added as it appears. The original HTML stays unchanged.';
      const text = document.createElement('pre');
      text.className = 'html-readable-text';
      text.textContent = readableText || 'No readable text was found in this HTML document.';
      textPanel.append(textHeading, textHint, text);
      if (hasSource) {
        const tabs = document.createElement('div');
        tabs.className = 'html-reader-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'HTML note view');
        const previewTab = document.createElement('button');
        previewTab.type = 'button'; previewTab.className = 'html-reader-tab active'; previewTab.dataset.htmlMode = 'preview';
        previewTab.setAttribute('role', 'tab'); previewTab.setAttribute('aria-selected', 'true'); previewTab.textContent = 'Interactive preview';
        const textTab = document.createElement('button');
        textTab.type = 'button'; textTab.className = 'html-reader-tab'; textTab.dataset.htmlMode = 'text';
        textTab.setAttribute('role', 'tab'); textTab.setAttribute('aria-selected', 'false'); textTab.textContent = 'Readable text';
        tabs.append(previewTab, textTab);
        const preview = makeInteractiveHtmlPreview(note, source);
        let receivedRuntimeText = false;
        setHtmlReadableFrameHandler(preview.frame, readable => {
          const completeText = receivedRuntimeText ? mergeHtmlReadableSnapshots(text.textContent, readable) : readable;
          receivedRuntimeText = true;
          if (hasUserTextLayer) {
            const currentNote = notes.find(item => item.id === note.id);
            if (currentNote) {
              const sourceKey = htmlReadableFingerprint(currentNote);
              if (currentNote.htmlReadableText !== completeText || currentNote.htmlReadableSourceKey !== sourceKey) {
                currentNote.htmlReadableText = completeText;
                currentNote.htmlReadableSourceKey = sourceKey;
                saveCurrentData();
              }
            }
          } else updateHtmlReadableText(note.id, completeText, text);
        });
        setHtmlReadableFrameScrollHandler(preview.frame, ratio => {
          if (currentPage === 'reader' && activeId === note.id) {
            storeReaderPosition(note.id, ratio, 'html');
            setReaderProgressPercent(ratio * 100);
          }
        });
        preview.frame.addEventListener('load', () => restoreHtmlFramePosition(preview.frame, note.id), { once:true });
        preview.shell.classList.add('html-reader-preview');
        textPanel.classList.add('hidden');
        reading.append(tabs, preview.shell, textPanel);
      } else {
        const unavailable = document.createElement('p');
        unavailable.className = 'html-source-unavailable';
        unavailable.textContent = note.fileName ? `The original file “${note.fileName}” is not available here. Reattach it to restore the interactive preview.` : 'No original HTML source is attached. This text-only view is still safe to read and edit.';
        reading.append(unavailable, textPanel);
      }
      return reading;
    }
    function updateHtmlPreviewControl(shell, expanded) {
      const button = shell?.querySelector('[data-html-action="expand"]');
      if (!button) return;
      button.textContent = expanded ? 'Back to note' : 'Expand';
      button.title = expanded ? 'Return to the note viewer' : 'Expand this note to fill the screen';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(Boolean(expanded)));
    }
    function setHtmlPreviewFallback(shell, expanded) {
      if (!shell) return;
      shell.classList.toggle('html-expanded', Boolean(expanded));
      shell.dataset.nativeExpanded = '';
      updateHtmlPreviewControl(shell, expanded);
    }
    async function toggleHtmlPreviewExpansion(shell) {
      if (!shell) return;
      const isNativeFullscreen = document.fullscreenElement === shell;
      if (isNativeFullscreen) {
        try { await document.exitFullscreen(); } catch { setHtmlPreviewFallback(shell, false); }
        return;
      }
      if (shell.classList.contains('html-expanded')) { setHtmlPreviewFallback(shell, false); return; }
      if (shell.requestFullscreen) {
        try {
          await shell.requestFullscreen();
          shell.dataset.nativeExpanded = 'true';
          updateHtmlPreviewControl(shell, true);
        } catch { setHtmlPreviewFallback(shell, true); }
      } else setHtmlPreviewFallback(shell, true);
    }
    function renderReaderOutline(root) {
      const outline = $('#reader-outline');
      const list = $('#reader-outline-list');
      const toggle = $('#reader-outline-toggle');
      list.replaceChildren();
      const headings = [...root.querySelectorAll('h1,h2,h3,h4')].filter(heading => heading.textContent.trim());
      if (headings.length < 2) {
        outline.classList.add('hidden');
        list.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
        return;
      }
      const used = new Map();
      headings.forEach((heading, index) => {
        const base = heading.textContent.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `section-${index + 1}`;
        const occurrence = (used.get(base) || 0) + 1;
        used.set(base, occurrence);
        heading.id = `notez-heading-${base}${occurrence > 1 ? `-${occurrence}` : ''}`;
        heading.tabIndex = -1;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `reader-outline-link level-${Math.min(4, Number(heading.tagName.slice(1)) || 2)}`;
        item.dataset.outlineTarget = heading.id;
        item.textContent = heading.textContent.trim();
        item.setAttribute('aria-label', `Jump to ${heading.textContent.trim()}`);
        list.append(item);
      });
      $('#reader-outline-count').textContent = `${headings.length} sections`;
      list.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
      outline.classList.remove('hidden');
    }
    async function renderNoteBody(note) {
      const id = note.id;
      const root = $('#viewer-content');
      const body = note.body || '';
      const hasAttachment = Boolean(note.filePath || note.fileName);
      if (note.kind === 'html') {
        let source = htmlSourceForNote(note);
        if (!source && hasAttachment) {
          try { source = await attachmentText(await resolveAttachment(note)); }
          catch (error) { console.warn('Could not read HTML attachment:', error); }
        }
        if (activeId !== id) return;
        const readable = readableHtmlForNote(note, source);
        const htmlWordCount = wordCount(readable);
        $('#reader-word-count').textContent = `${htmlWordCount.toLocaleString()} ${htmlWordCount === 1 ? 'word' : 'words'}`;
        $('#reading-time').textContent = `${Math.max(1, Math.ceil(htmlWordCount / 220))} min read`;
        root.replaceChildren(makeHtmlReaderView(note, source, readable));
        return;
      }
      if (note.kind === 'markdown' || note.kind === 'note') {
        let source = body;
        let loadedFullAttachment = false;
        if ((!source || note.bodyPreviewOnly) && note.kind === 'markdown' && hasAttachment) {
          try {
            const attachment = await resolveAttachment(note);
            if (attachment) { source = await attachmentText(attachment); loadedFullAttachment = true; }
          } catch (error) { console.warn('Could not read Markdown attachment:', error); }
        }
        if (activeId !== id) return;
        if (loadedFullAttachment) {
          const count = wordCount(source);
          $('#reader-word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
          $('#reading-time').textContent = `${Math.max(1, Math.ceil(count / 220))} min read`;
        }
        if (source) root.innerHTML = markdownToHtml(source);
        else if (hasAttachment && !loadedFullAttachment) { renderAttachmentCard(note, '', note.mimeType); return; }
        else root.innerHTML = '<p class="subtle">This note has no Markdown content yet. Choose Edit to add text.</p>';
        if (note.bodyPreviewOnly && !loadedFullAttachment) appendTextExcerptNotice(root);
        renderReaderOutline(root);
        return;
      }
      if (note.kind === 'text' && body && !note.bodyPreviewOnly) {
        root.innerHTML = `<pre class="plain-text">${esc(body)}</pre>`;
        return;
      }
      if (!note.filePath && !note.fileName && !body) {
        root.innerHTML = '<p class="subtle">This note has no content yet. Choose Edit to add a summary.</p>';
        return;
      }
      try {
        const attachment = await resolveAttachment(note);
        if (activeId !== id) return;
        if (!attachment) {
          if (note.kind === 'text' && body) {
            root.innerHTML = `<pre class="plain-text">${esc(body)}</pre>`;
            if (note.bodyPreviewOnly) appendTextExcerptNotice(root);
          } else renderAttachmentCard(note, '', note.mimeType);
          return;
        }
        const url = attachment.url;
        if (isPdfNote(note)) {
          renderPdfReader(note,attachment);
          return;
        } else if (note.kind === 'image') {
          root.innerHTML = `<div class="attachment-image-wrap"><img class="attachment-image" src="${esc(url)}" alt="${esc(note.title)}" /></div>${body ? `<div style="margin-top:28px">${markdownToHtml(body)}</div>` : ''}`;
        } else if (note.kind === 'audio') {
          root.innerHTML = `<audio class="media-player" controls src="${esc(url)}"></audio>${renderAttachmentCardMarkup(note, url)}${body ? `<div style="margin-top:28px">${markdownToHtml(body)}</div>` : ''}`;
        } else if (note.kind === 'video') {
          root.innerHTML = `<video class="media-player" controls src="${esc(url)}"></video>${body ? `<div style="margin-top:28px">${markdownToHtml(body)}</div>` : ''}`;
        } else if (note.kind === 'html' || note.mimeType === 'text/html') {
          const html = await attachmentText(attachment);
          if (activeId !== id) return;
          const preview = makeInteractiveHtmlPreview(note, html);
          root.replaceChildren(preview.shell);
        } else if (note.kind === 'text' || (note.mimeType || '').startsWith('text/')) {
          const text = await attachmentText(attachment);
          if (activeId !== id) return;
          const count = wordCount(text);
          $('#reader-word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
          $('#reading-time').textContent = `${Math.max(1, Math.ceil(count / 220))} min read`;
          root.innerHTML = `<pre class="plain-text">${esc(text || 'No text content.')}</pre>`;
        } else if (isPptxNote(note)) {
          await renderPptxViewer(note, attachment, root, id);
        } else {
          renderAttachmentCard(note, url, note.mimeType);
        }
        renderReaderOutline(root);
      } catch (error) {
        console.warn('Preview could not be loaded:', error);
        if (activeId === id) renderAttachmentCard(note, '', note.mimeType);
        toast('Could not load this attachment. Check Firebase Storage rules or try downloading it again.', 'error', 5200);
      }
    }
    function renderAttachmentCardMarkup(note, url) {
      const title = note.fileName || note.title;
      return `<div class="attachment-card" style="margin-top:18px"><div class="attachment-card-icon">${svgIcon(note.kind,22)}</div><div class="attachment-card-meta"><strong>${esc(title)}</strong><span>${esc(note.mimeType || kindLabel(note.kind))}${note.fileSize ? ` · ${esc(formatBytes(note.fileSize))}` : ''}</span></div><a class="attachment-download" href="${esc(url)}" download="${esc(title)}" target="_blank" rel="noopener">Download</a></div>`;
    }

    function editorDraftScope() {
      return currentSession?.mode === 'cloud' ? `cloud-${currentSession.user.uid}` : 'demo';
    }
    function editorDraftKey(id = 'new') { return `notez-draft-v1-${editorDraftScope()}-${id}`; }
    function readEditorDraft(id = 'new') {
      try { const raw = localStorage.getItem(editorDraftKey(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    }
    function setEditorSaveStatus(state, label) {
      const status = $('#editor-save-status');
      if (!status) return;
      status.className = `editor-save-status ${state}`;
      status.setAttribute('aria-label', label);
      status.title = label;
      status.querySelector('span').textContent = label;
    }
    function saveEditorDraft() {
      if (!currentSession || !editorId) return;
      const key = editorDraftKey(editingNew ? 'new' : editorId);
      try {
        localStorage.setItem(key, JSON.stringify({ id: editorId, title: $('#note-title-input').value, subject: $('#note-subject-input').value, folderPath: $('#note-folder-input').value, tags: $('#note-tags-input').value, body: $('#note-body-input').value, savedAt: Date.now() }));
        setEditorSaveStatus('saved', currentSession.mode === 'cloud' ? 'Saved on this device' : 'Saved on this device');
        $('#editor-subtitle').textContent = currentSession.mode === 'cloud' ? 'Device mirror saved · syncing draft to Firebase…' : 'Draft saved on this device · just now';
      } catch (error) { console.warn('Draft could not be saved locally:', error); setEditorSaveStatus('error', 'Could not save draft'); }
    }
    function saveCloudEditorDraft() {
      if (currentSession?.mode !== 'cloud' || !editorId) return;
      if (!navigator.onLine) { setEditorSaveStatus('offline', 'Saved offline · cloud sync will retry'); return; }
      if (!dbSdk) return;
      const uidValue = currentSession.user.uid;
      const draftKey = editingNew ? 'new' : editorId;
      const draftData = { id: editorId, title: $('#note-title-input').value, subject: $('#note-subject-input').value, folderPath: $('#note-folder-input').value, tags: $('#note-tags-input').value, body: $('#note-body-input').value, kind: editorKind };
      const signature = `${uidValue}:${draftKey}:${JSON.stringify(draftData)}`;
      if (signature === lastCloudDraftSignature) { setEditorSaveStatus('synced', 'No draft changes to sync'); return; }
      const payload = { ...draftData, savedAt:Date.now() };
      dbSdk.dbSet(dbSdk.dbRef(dbSdk.database, `users/${uidValue}/drafts/${draftKey}`), payload).then(() => {
        lastCloudDraftSignature = signature;
        if (currentSession?.user?.uid === uidValue && editorId === payload.id && !$('#editor-view').classList.contains('hidden')) { $('#editor-subtitle').textContent = 'Draft saved to Firebase · just now'; setEditorSaveStatus('synced', 'Synced to Firebase'); }
      }).catch(error => {
        console.info('Draft stays in the local mirror until Firebase is available:', error?.message || error);
        if (currentSession?.user?.uid === uidValue && editorId === payload.id && !$('#editor-view').classList.contains('hidden')) { $('#editor-subtitle').textContent = 'Device mirror saved · cloud retry will follow'; setEditorSaveStatus('offline', 'Saved locally · cloud retry pending'); }
      });
    }
    function clearEditorDraft() {
      if (editorDraftTimer) clearTimeout(editorDraftTimer);
      if (cloudDraftTimer) clearTimeout(cloudDraftTimer);
      lastCloudDraftSignature = '';
      try { localStorage.removeItem(editorDraftKey(editingNew ? 'new' : editorId)); } catch {}
      if (currentSession?.mode === 'cloud' && dbSdk && navigator.onLine) {
        const draftKey = editingNew ? 'new' : editorId;
        dbSdk.dbRemove(dbSdk.dbRef(dbSdk.database, `users/${currentSession.user.uid}/drafts/${draftKey}`)).catch(() => {});
      }
    }
    function queueEditorDraft() {
      setEditorSaveStatus('saving', 'Saving draft…');
      if (editorDraftTimer) clearTimeout(editorDraftTimer);
      editorDraftTimer = window.setTimeout(saveEditorDraft, 250);
      if (cloudDraftTimer) clearTimeout(cloudDraftTimer);
      cloudDraftTimer = window.setTimeout(saveCloudEditorDraft, 5000);
    }
    function setEditorMode(mode) {
      editorPreviewMode = mode === 'preview';
      $('#editor-write-tab').classList.toggle('active', !editorPreviewMode);
      $('#editor-preview-tab').classList.toggle('active', editorPreviewMode);
      $('#note-body-input').classList.toggle('hidden', editorPreviewMode);
      $('#editor-preview').classList.toggle('hidden', !editorPreviewMode);
      $('#markdown-toolbar').classList.toggle('hidden', editorPreviewMode || !['note','markdown'].includes(editorKind));
      if (editorPreviewMode) renderEditorPreview();
    }
    function applyMarkdownFormat(format) {
      if (!['note','markdown'].includes(editorKind)) return;
      const area = $('#note-body-input');
      const value = area.value;
      const start = area.selectionStart ?? value.length;
      const end = area.selectionEnd ?? start;
      const selected = value.slice(start, end);
      const inlineFormats = { bold:['**','**','bold text'], italic:['*','*','italic text'], code:['`','`','code'] };
      if (format === 'link') {
        const text = selected || 'link text';
        area.setRangeText(`[${text}](url)`, start, end, 'select');
        if (selected) area.setSelectionRange(start + text.length + 3, start + text.length + 6);
        else area.setSelectionRange(start + 1, start + 1 + text.length);
      } else if (inlineFormats[format]) {
        const [before, after, placeholder] = inlineFormats[format];
        const text = selected || placeholder;
        const insert = `${before}${text}${after}`;
        area.setRangeText(insert, start, end, 'select');
        const selectionStart = start + before.length;
        area.setSelectionRange(selectionStart, selectionStart + text.length);
      } else {
        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const lineEndIndex = value.indexOf('\n', end);
        const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
        const rangeEnd = format === 'heading' ? (value.indexOf('\n', lineStart) < 0 ? value.length : value.indexOf('\n', lineStart)) : lineEnd;
        const block = value.slice(lineStart, rangeEnd);
        const existingPrefix = line => line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/);
        let replacement = block;
        if (format === 'heading') {
          const content = block.replace(/^\s*#{1,6}\s+/, '');
          replacement = `## ${content || 'Heading'}`;
        } else {
          const prefixes = { bullet:'- ', numbered:'1. ', checklist:'- [ ] ', quote:'> ' };
          const prefix = prefixes[format];
          if (!prefix) return;
          replacement = block.split('\n').map((line, index) => {
            const match = existingPrefix(line);
            const content = match ? line.slice(match[0].length) : line;
            return prefix === '1. ' ? `${index + 1}. ${content}` : `${prefix}${content}`;
          }).join('\n');
        }
        area.setRangeText(replacement, lineStart, rangeEnd, 'end');
      }
      area.focus({ preventScroll:true });
      area.dispatchEvent(new Event('input', { bubbles:true }));
    }
    function renderEditorPreview() {
      const preview = $('#editor-preview');
      const value = $('#note-body-input').value;
      if (editorKind === 'html') {
        const panel = document.createElement('div'); panel.className = 'html-readable-panel';
        const heading = document.createElement('div'); heading.className = 'html-readable-heading'; heading.textContent = 'Text-only preview';
        const hint = document.createElement('p'); hint.className = 'html-readable-hint'; hint.textContent = 'This is the editable text layer; the original HTML source is not changed.';
        const text = document.createElement('pre'); text.className = 'html-readable-text'; text.textContent = value || 'No readable text yet.';
        panel.append(heading, hint, text); preview.replaceChildren(panel);
      } else if (editorKind === 'text') {
        preview.innerHTML = `<pre class="plain-text">${esc(value || 'No text content.')}</pre>`;
      } else {
        preview.innerHTML = `<div class="markdown-body">${markdownToHtml(value)}</div>`;
      }
    }
    async function hydrateEditorFromAttachment(note, expectedEditorId, originalFieldValue) {
      if (!note || (!note.fileName && !note.filePath) || !['html','markdown','text'].includes(note.kind) || (originalFieldValue.trim() && !note.bodyPreviewOnly)) return;
      if (note.kind === 'html' && htmlSourceForNote(note)) return;
      try {
        const attachment = await resolveAttachment(note);
        if (!attachment) return;
        const sourceText = await attachmentText(attachment);
        const readable = note.kind === 'html' ? extractReadableHtml(sourceText) : sourceText;
        if (note.kind === 'html') {
          if (currentPage === 'editor' && editorId === expectedEditorId && $('#note-body-input').value === originalFieldValue && readable) {
            $('#note-body-input').value = readable;
            htmlEditorSeedText = readable;
            $('#editor-subtitle').textContent = 'Text loaded from the attachment · original file remains unchanged';
            updateEditorWordCount();
          }
          if (currentPage === 'editor' && editorId === expectedEditorId) startHtmlExtractionProbe(note, sourceText);
          return;
        }
        if (currentPage !== 'editor' || editorId !== expectedEditorId || $('#note-body-input').value !== originalFieldValue || !readable) return;
        $('#note-body-input').value = readable;
        $('#editor-subtitle').textContent = 'Text loaded from the attachment · original file remains unchanged';
        updateEditorWordCount();
      } catch (error) {
        console.warn('Could not load attachment text into the editor:', error);
      }
    }
    function openEditor(note = null, options = {}) {
      if (!currentSession) return;
      removeHtmlExtractionProbe();
      selectionMode = false; selectedNoteIds.clear();
      if (currentPage === 'editor') saveEditorDraft();
      editorReturnPage = note && currentPage === 'reader' ? 'reader' : currentPage;
      if (editorReturnPage === 'editor') editorReturnPage = 'home';
      editingNew = !note;
      const draft = readEditorDraft(note ? note.id : 'new');
      const usableDraft = draft && (Date.now() - Number(draft.savedAt || 0) < 30 * 86400000) && (!note || Number(draft.savedAt) > Number(note.updatedAt || 0));
      const target = note || normalizeNote({ id: usableDraft?.id || uid(), title: '', subject: 'Learning', kind: 'note', body: '', folderPath: currentFolderPath || '', createdAt: Date.now(), updatedAt: Date.now() });
      editorId = options.id || note?.id || usableDraft?.id || target.id;
      editorKind = note?.kind || options.kind || target.kind || 'note';
      currentPage = 'editor';
      if (options.push !== false) pushAppRoute();
      $('#editor-title').textContent = note ? 'Edit note' : 'Create a new note';
      $('#editor-subtitle').textContent = note ? 'Refine the ideas you want to keep.' : 'A clean page for your next idea.';
      $('#note-title-input').value = usableDraft ? (usableDraft.title || '') : (note?.title || '');
      $('#note-subject-input').value = usableDraft ? (usableDraft.subject || '') : (note?.subject || (currentFolderPath ? currentFolderPath.split('/').pop() : 'Learning'));
      $('#note-tags-input').value = usableDraft ? (usableDraft.tags || '') : (note?.tags || []).join(', ');
      $('#note-folder-input').value = usableDraft ? (usableDraft.folderPath || '') : (note?.folderPath || currentFolderPath || '');
      const draftBody = String(usableDraft?.body || '');
      const editorBody = note?.kind === 'html' && isHtmlSource(draftBody) ? extractReadableHtml(draftBody) : draftBody;
      const initialBody = usableDraft ? editorBody : (note?.kind === 'html' ? readableHtmlForNote(note) : (note?.body || ''));
      $('#note-body-input').value = initialBody;
      htmlEditorSeedText = editorKind === 'html' ? initialBody : '';
      htmlEditorMayHydrate = editorKind === 'html' && !usableDraft && (!note?.body || note.bodyPreviewOnly || isHtmlSource(note.body));
      if (usableDraft) toast('Your unsaved draft was restored from this device.', 'success', 2800);
      setEditorMode('write');
      setEditorSaveStatus(usableDraft ? 'saved' : note ? 'saved' : 'ready', usableDraft ? 'Draft restored' : note ? 'Saved' : 'Ready');
      $('#editor-preview-tab').textContent = editorKind === 'html' ? 'Text preview' : 'Preview';
      $('#body-label').textContent = editorKind === 'html' ? 'READABLE HTML TEXT' : (editorKind === 'text' ? 'TEXT CONTENT' : editorKind === 'markdown' ? 'MARKDOWN CONTENT' : 'NOTE CONTENT');
      $('#body-hint').textContent = editorKind === 'html' ? 'Edit only this safe text layer · the original HTML source and attachment stay untouched.' : editorKind === 'text' ? 'Text edits update the note copy; the original attachment remains unchanged.' : 'Markdown supported · use # for headings, - for bullets, > for a callout.';
      $('#editor-info').textContent = editorKind === 'html' ? 'The text field is separate from the original HTML source. Saving changes only this readable text layer; the original HTML preview and attached file are preserved.' : (currentSession.mode === 'cloud' ? 'Firebase is primary. Drafts auto-save as you type; saved notes mirror locally and retry sync every 30 seconds.' : 'Demo drafts and notes save on this device. Sign in to use Firebase as your primary store.');
      const hasAttachment = Boolean(note?.fileName || note?.filePath);
      $('#attachment-detail').classList.toggle('hidden', !hasAttachment);
      if (hasAttachment) {
        $('#attachment-detail-name').textContent = note.fileName || 'Stored attachment';
        $('#attachment-detail-type').textContent = `${kindLabel(note.kind)}${note.fileSize ? ` · ${formatBytes(note.fileSize)}` : ''}`;
      }
      $('#delete-current').classList.toggle('hidden', !note);
      updateEditorWordCount();
      $('#app-shell').classList.remove('focus-mode','pdf-focus-mode');
      renderEverything();
      if (note && editorKind === 'html') {
        const embeddedSource = htmlSourceForNote(note);
        if (embeddedSource) startHtmlExtractionProbe(note, embeddedSource);
      }
      $('#workspace-main').scrollTop = 0;
      if (note && !usableDraft && (note.bodyPreviewOnly || !initialBody.trim()) && ['html','markdown','text'].includes(note.kind)) void hydrateEditorFromAttachment(note, editorId, initialBody);
      window.setTimeout(() => $('#note-title-input').focus(), 40);
    }
    function closeEditor() {
      saveEditorDraft();
      removeHtmlExtractionProbe();
      goBackInApp(editorReturnPage || 'home');
    }
    function updateEditorWordCount() {
      const count = wordCount($('#note-body-input').value);
      $('#body-word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
      if (editorPreviewMode) renderEditorPreview();
    }
    async function handleSaveNote(event) {
      event?.preventDefault();
      const title = $('#note-title-input').value.trim();
      if (!title) { $('#note-title-input').focus(); toast('Add a title before saving.', 'error'); return; }
      const original = notes.find(note => note.id === editorId);
      const now = Date.now();
      const rawTags = $('#note-tags-input').value.split(',').map(tag => tag.trim()).filter(Boolean);
      const note = normalizeNote({
        ...(original || {}),
        id: editorId,
        title,
        subject: $('#note-subject-input').value.trim() || 'General',
        folderPath: cleanFolderPath($('#note-folder-input').value) || cleanFolderPath($('#note-subject-input').value.trim() || 'General'),
        tags: [...new Set(rawTags)].slice(0, 15),
        body: $('#note-body-input').value,
        bodyPreviewOnly: false,
        htmlSource: original?.kind === 'html' ? (htmlSourceForNote(original) || String(original.htmlSource || '')) : String(original?.htmlSource || ''),
        kind: original?.kind || 'note',
        createdAt: original?.createdAt || now,
        updatedAt: now,
        lastViewedAt: now
      });
      const saveButton = $('#save-note');
      saveButton.disabled = true;
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      notes = [note, ...notes.filter(item => item.id !== note.id)].sort((a,b) => b.updatedAt - a.updatedAt);
      activeId = note.id;
      previousPage = editorReturnPage === 'reader' ? (previousPage || 'home') : (editorReturnPage || 'home');
      currentPage = 'reader';
      replaceAppRoute();
      if (note.folderPath) addFolderPath(note.folderPath);
      if (cloudUid) updateCachedCloudNote(note, true);
      else localNotesWrite();
      clearEditorDraft();
      renderEverything();
      $('#workspace-main').scrollTop = 0;
      try {
        if (cloudUid && navigator.onLine) {
          saveButton.textContent = 'Syncing…';
          setSyncState('syncing');
          const prepared = await prepareCloudAttachment(normalizeNote(note), cloudUid);
          await saveCloudNote(prepared, cloudUid);
          notes = notes.map(item => item.id === prepared.id ? prepared : item);
          markPending(cloudUid, prepared.id, false);
          writeCloudCache(cloudUid, notes);
          setSyncState(hasPendingCloudChanges(cloudUid) ? 'pending' : 'cloud');
          renderEverything();
          toast('Saved to Firebase and mirrored on this device.');
        } else if (cloudUid) {
          setSyncState('offline');
          toast('Saved to this device. Firebase sync is queued for when you are online.', 'error', 6000);
        } else toast('Note saved on this device.');
      } catch (error) {
        console.error(error);
        if (cloudUid) {
          markPending(cloudUid, note.id, true);
          writeCloudCache(cloudUid, notes);
          setSyncState('pending');
          toast('Saved to this device. Firebase sync is queued and will retry automatically.', 'error', 6000);
        } else toast('Could not save this note.', 'error');
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save note';
      }
    }
    async function deleteNote(noteId) {
      let note = notes.find(item => item.id === noteId);
      if (!note) return;
      if (!(await uiConfirm({ title: 'Delete this note?', message: `“${note.title}” and its attachment will be permanently removed. This cannot be undone.`, confirmLabel: 'Delete note', danger: true }))) return;
      const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
      const returnPage = currentPage === 'editor' ? (editorReturnPage || 'home') : currentPage;
      if (cloudUid && cloudSyncPromise) { try { await cloudSyncPromise; } catch {} note = notes.find(item => item.id === noteId) || note; }
      const undoSnaps = await snapshotNotesForUndo([note]);
      clearReaderPosition(note.id);
      notes = notes.filter(item => item.id !== note.id);
      if (activeId === note.id) activeId = notes[0]?.id || '';
      keepInTrash(undoSnaps);
      const objectUrl = objectUrlCache.get(note.id);
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrlCache.delete(note.id); }
      if (cloudUid) {
        setCloudDeletion(cloudUid, note.id, { filePath: note.filePath || '', deletedAt: Date.now() });
        markPending(cloudUid, note.id, false);
        writeCloudCache(cloudUid, notes);
      } else localNotesWrite();
      currentPage = returnPage || 'home';
      if (currentPage === 'reader') currentPage = previousPage || 'home';
      replaceCurrentAppRoute();
      renderEverything();
      offerUndo(undoSnaps);
      if (!cloudUid) return;
      if (!navigator.onLine) { setSyncState('offline'); toast('Deleted here. Firebase deletion will sync when you are online.', 'error', 5200); return; }
      try {
        const sdk = await ensureFirebase();
        await sdk.dbRemove(sdk.dbRef(sdk.database, `users/${cloudUid}/notes/${note.id}`));
        if (window.notezAiBackendConfigured?.() && typeof window.notezAiDeleteIndexedNote === 'function') {
          try { await window.notezAiDeleteIndexedNote(note.id); }
          catch (error) { console.warn('The note was deleted from Firebase, but semantic index cleanup failed:', error); }
        }
        if (note.filePath && note.filePath.includes('/files/')) await deleteCloudFile(sdk, note.filePath);
        setCloudDeletion(cloudUid, note.id, null);
        writeCloudCache(cloudUid, notes);
        setSyncState(hasPendingCloudChanges(cloudUid) ? 'pending' : 'cloud');
        toast('Note deleted from Firebase and this device.');
      } catch (error) {
        console.warn('Cloud delete queued for retry:', error);
        setSyncState('pending');
        toast('Deleted here. Firebase will finish the deletion on its next sync.', 'error', 6000);
      }
    }

    async function importFiles(fileList, options = {}) {
      let files = [...(fileList || [])];
      if (options.folderMode) {
        files = sortFolderFiles(files);
      }
      const folderBase = cleanFolderPath(options.basePath || '');
      const batchStamp = Date.now();
      const importFolder = cleanFolderPath(currentFolderPath || '');   // the folder the user is viewing when the import starts
      const touchedFolders = new Set();
      let fileIndex = 0;
      if (!files.length || !currentSession) return;
      const input = $('#file-input');
      input.value = '';
      let firstId = '';
      let imported = 0;
      for (const sourceFile of files) {
        let file = sourceFile;
        fileIndex++;
        if (options.folderMode) nzProgress(`Importing ${fileIndex} of ${files.length}`, sourceFile.webkitRelativePath || sourceFile.name, (fileIndex - 1) / files.length);
        if (Number(file.size) > MAX_IMPORT_FILE_BYTES) {
          toast(`${file.name} exceeds the ${formatBytes(MAX_IMPORT_FILE_BYTES)} per-file import limit.`, 'error', 6000);
          continue;
        }
        if (fileKind(sourceFile) === 'pdf') {
          // The PDF is stored exactly as uploaded. Only its text layer is read, for search and the assistant.
          file = sourceFile;
          try {
            const pdfText = await readPdfTextLayer(sourceFile);
            file.notezText = pdfText.text; file.notezPageTexts = pdfText.pageTexts;
          } catch (readError) {
            console.warn('PDF text could not be read:', readError);
            file.notezText = ''; file.notezPageTexts = [];
          }
        }
        const id = uid();
        let kind = fileKind(file);
        let body = '';
        let bodyPreviewOnly = false;
        let htmlSource = '';
        if (['markdown','html','text'].includes(kind)) {
          try {
            const fullReadLimit = kind === 'html' ? 8_000_000 : 4_000_000;
            const previewReadLimit = 750_000;
            const isPreview = file.size > fullReadLimit;
            const textContent = isPreview ? await file.slice(0, previewReadLimit).text() : await file.text();
            if (kind === 'html') {
              if (!isPreview && file.size <= 1_350_000) htmlSource = textContent;
              body = extractReadableHtml(textContent);
            } else body = textContent;
            if (isPreview || file.size > 1_350_000) {
              body = body.slice(0, 120_000);
              bodyPreviewOnly = true;
            }
          } catch (error) { console.warn('Could not read text attachment:', error); }
        }
        let pdfMarkdown = null;
        if (!PDF_KEEP_ORIGINAL && kind === 'pdf' && file.notezPageTexts && file.notezPageTexts.some(text => text.trim())) {
          if (!aiReady()) toast(`${sourceFile.name} was saved as a PDF. Add a Gemini or Groq key in NotezAi settings to turn text PDFs into Markdown notes.`, 'error', 7000);
          else {
            try {
              pdfMarkdown = await convertPdfPagesToMarkdown(file.notezPageTexts, (done, total) => nzProgress('Converting to Markdown with NotezAi', `${sourceFile.name} · section ${done} of ${total}`, (done - 1) / total));
            } catch (error) { console.warn('PDF conversion failed:', error); toast(`Could not convert ${sourceFile.name}: ${aiErrorMessage(error)} Saved as a PDF.`, 'error', 7000); }
          }
        }
        let scanned = null;
        if (!PDF_KEEP_ORIGINAL && kind === 'pdf' && !pdfMarkdown && file.notezPageImages && file.notezPageImages.length && !(file.notezPageTexts || []).some(text => text.trim())) {
          if (!aiKey('gemini')) toast(`${sourceFile.name} looks scanned. Add a Gemini key in NotezAi settings to transcribe it into a Markdown note.`, 'error', 7000);
          else {
            try {
              scanned = await ocrPagesToMarkdown(file.notezPageImages, (done, total) => nzProgress('Transcribing scanned pages with NotezAi', `${sourceFile.name} · page ${done} of ${total}`, (done - 1) / total));
            } catch (error) { console.warn('OCR failed:', error); toast(`Could not transcribe ${sourceFile.name}: ${aiErrorMessage(error)} Saved as a PDF.`, 'error', 7000); }
          }
        }
        if (scanned) {
          kind = 'markdown';
          body = `> AI transcription of a scanned PDF${scanned.failed.length ? ` (${scanned.failed.length} page${scanned.failed.length === 1 ? '' : 's'} failed)` : ''}. Review it against the original before relying on it.

${scanned.markdown}`;
          bodyPreviewOnly = false;
        }
        if (pdfMarkdown) { kind = 'markdown'; body = pdfMarkdown.markdown; bodyPreviewOnly = false; }
        else if (kind === 'pdf' && file.notezText) { body = file.notezText.slice(0, 120000); if (file.notezText.length > 120000) bodyPreviewOnly = true; }
        if (isPptxNote({ fileName: file.name, mimeType: file.type })) {
          try { const parsed = await parsePptx(file); if (parsed.text) { body = parsed.text.slice(0, 120000); if (parsed.text.length > 120000) bodyPreviewOnly = true; } } catch (error) { console.info('Presentation text was not extracted:', error); }
        }
        const relDir = options.folderMode ? cleanFolderPath(String(sourceFile.webkitRelativePath || '').split('/').slice(0, -1).join('/')) : '';
        const targetFolder = options.folderMode ? (cleanFolderPath([folderBase, relDir].filter(Boolean).join('/')) || 'Imported files') : (importFolder || 'Imported files');
        const stamp = options.folderMode ? batchStamp - fileIndex * 1000 : Date.now();
        touchedFolders.add(targetFolder);
        const note = normalizeNote({
          id,
          title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || file.name,
          subject: targetFolder.split('/')[0] || 'Imported files',
          folderPath: targetFolder,
          tags: pdfMarkdown ? ['PDF', 'MARKDOWN'] : scanned ? ['PDF', 'SCANNED', 'REVIEW'] : [getExtension(file.name).toUpperCase()].filter(Boolean),
          kind,
          body,
          bodyPreviewOnly,
          htmlSource,
          fileName: (pdfMarkdown || scanned) ? '' : file.name,
          mimeType: (pdfMarkdown || scanned) ? '' : (file.type || 'application/octet-stream'),
          fileSize: (pdfMarkdown || scanned) ? 0 : file.size,
          createdAt: stamp,
          updatedAt: stamp,
          lastViewedAt: (firstId || options.folderMode) ? 0 : Date.now()
        });
        try {
          const storedLocally = (pdfMarkdown || scanned) ? false : await storeLocalFile(id, file);
          if (scanned) toast(`${sourceFile.name} transcribed${scanned.failed.length ? ` with ${scanned.failed.length} failed page(s)` : ''}. Review the note against the original.`, scanned.failed.length ? 'error' : 'success', 7000);
          if (pdfMarkdown) toast(`${sourceFile.name} → Markdown note · ${pdfMarkdown.verifiedSections} of ${pdfMarkdown.totalSections} sections verified word-for-word`, 'success', 6500);
          if (kind === 'html' && storedLocally) note.htmlSource = '';
          if (currentSession.mode === 'demo') {
            notes.unshift(note);
            localNotesWrite();
          } else {
            const cloudUid = currentSession.user.uid;
            notes.unshift(note);
            updateCachedCloudNote(note, true);
            try {
              if (!navigator.onLine) throw new Error('Offline; queued in the device mirror');
              setSyncState('syncing');
              const sdk = await ensureFirebase();
              const uploadedPath = await uploadCloudFile(sdk, cloudUid, id, file, file.type);
              if (uploadedPath) note.filePath = uploadedPath;
              else toast(`${file.name} is over the 150 MB cloud limit, so it stays on this device only.`, 'error', 6000);
              await saveCloudNote(note, cloudUid);
              markPending(cloudUid, id, false);
              writeCloudCache(cloudUid, notes);
              setSyncState(hasPendingCloudChanges(cloudUid) ? 'pending' : 'cloud');
            } catch (cloudError) {
              console.warn('Import is queued in the local mirror:', cloudError);
              markPending(cloudUid, id, true);
              writeCloudCache(cloudUid, notes);
              setSyncState(navigator.onLine ? 'pending' : 'offline');
            }
          }
          imported++;
          if (!firstId) firstId = id;
        } catch (error) {
          console.error(error);
          toast(`Could not keep ${file.name} in this browser. Check available storage and try again.`, 'error', 6000);
        }
      }
      nzProgressHide();
      if (firstId && options.folderMode) {
        touchedFolders.forEach(path => addFolderPath(path));
        const root = folderBase || String(files[0]?.webkitRelativePath || '').split('/')[0] || 'Imported files';
        renderEverything();
        openFolderPath(root);
        toast(`Imported ${imported} file${imported === 1 ? '' : 's'} into “${root}” (${touchedFolders.size} folder${touchedFolders.size === 1 ? '' : 's'}), keeping the original order.`, 'success', 6000);
        return;
      }
      if (firstId) {
        previousPage = currentPage === 'reader' ? previousPage : currentPage;
        activeId = firstId;
        activeFilter = 'all';
        currentFolderPath = importFolder;
        currentPage = 'reader';
        pushAppRoute();
        $('#search-input').value = '';
        addFolderPath(importFolder || 'Imported files');
        renderEverything();
        if (files.length > 1) toast(`${imported} of ${files.length} files added to your library.`);
        else if (imported) toast('File added. Use Edit to add a summary or study notes.');
      }
    }
    async function downloadNote(noteId = activeId) {
      const note = notes.find(item => item.id === noteId);
      if (!note) return;
      let attachment = null;
      const hasAttachment = Boolean(note.fileName || note.filePath);
      if (hasAttachment) {
        try { attachment = await resolveAttachment(note); }
        catch (error) { console.warn('Attachment download unavailable; trying saved note text:', error); }
      }
      if (attachment?.url) {
        const anchor = document.createElement('a');
        anchor.href = attachment.url;
        anchor.download = note.fileName || note.title;
        anchor.target = '_blank';
        document.body.append(anchor); anchor.click(); anchor.remove();
        return;
      }
      const rawHtml = note.kind === 'html' ? htmlSourceForNote(note) : '';
      const body = rawHtml || (note.kind === 'html' ? readableHtmlForNote(note) : (note.body || ''));
      if (!body && hasAttachment) { toast('The original attachment is unavailable. Reattach it to download its bytes.', 'error', 5200); return; }
      const baseName = String(note.title || 'note').replace(/[\\/:*?"<>|]/g, '-').slice(0,80) || 'note';
      const extension = rawHtml ? 'html' : note.kind === 'text' ? 'txt' : note.kind === 'html' ? 'txt' : 'md';
      const mime = rawHtml ? 'text/html;charset=utf-8' : extension === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
      const url = URL.createObjectURL(new Blob([body], { type:mime }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${baseName}.${extension}`; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      if (hasAttachment) toast(`Original attachment unavailable; downloaded the saved ${note.bodyPreviewOnly ? 'text excerpt' : rawHtml ? 'HTML source' : 'text'} instead.`, 'success', 5200);
    }

    function readerPositionKey(noteId) {
      const scope = currentSession?.mode === 'cloud' ? `cloud-${currentSession.user.uid}` : 'demo';
      return `notez-reader-position-v1-${scope}-${noteId}`;
    }
    function readReaderPosition(noteId) {
      try {
        const saved = JSON.parse(localStorage.getItem(readerPositionKey(noteId)) || 'null');
        if (!saved || !Number.isFinite(Number(saved.ratio))) return null;
        const mode = ['html','pdf'].includes(saved.mode) ? saved.mode : 'page';
        return { ratio:Math.max(0,Math.min(1,Number(saved.ratio))), mode };
      } catch { return null; }
    }
    function storeReaderPosition(noteId, ratio, mode = 'page') {
      if (!currentSession || !noteId) return;
      const value = Math.max(0,Math.min(1,Number(ratio) || 0));
      const safeMode = ['html','pdf'].includes(mode) ? mode : 'page';
      try { localStorage.setItem(readerPositionKey(noteId), JSON.stringify({ ratio:value, mode:safeMode, savedAt:Date.now() })); } catch {}
    }
    function clearReaderPosition(noteId) { try { localStorage.removeItem(readerPositionKey(noteId)); } catch {} }
    function setReaderProgressPercent(percent) {
      const value = Math.max(0,Math.min(100,Number(percent) || 0));
      $('#reader-progress-fill').style.width = `${value}%`;
      $('#reader-progress').setAttribute('aria-valuenow', String(Math.round(value)));
      $('#reader-progress').setAttribute('aria-valuetext', `${Math.round(value)} percent through this note`);
    }
    function queueReaderPositionSave() {
      const noteId = readerRenderedId || activeId;
      if (currentPage !== 'reader' || !noteId || readerPositionRestorePendingId === noteId || isPdfNote(notes.find(item => item.id === noteId))) return;
      if (readerPositionTimer) clearTimeout(readerPositionTimer);
      readerPositionTimer = window.setTimeout(() => {
        const element = $('#workspace-main');
        const room = element.scrollHeight - element.clientHeight;
        if (currentPage === 'reader' && readerRenderedId === noteId && room > 0) storeReaderPosition(noteId, element.scrollTop / room, 'page');
      }, 220);
    }
    function saveReaderPositionNow(noteId = readerRenderedId) {
      if (readerPositionTimer) { clearTimeout(readerPositionTimer); readerPositionTimer = 0; }
      if (!noteId) return;
      const element = $('#workspace-main');
      const saved = readReaderPosition(noteId);
      const note = notes.find(item => item.id === noteId);
      if (isPdfNote(note) && activePdfReaderState?.noteId === noteId) { savePdfReaderPosition(activePdfReaderState); return; }
      if ((note?.kind === 'html' && saved?.mode === 'html' || isPdfNote(note) && saved?.mode === 'pdf') && element.scrollTop <= 3) return;
      const room = element.scrollHeight - element.clientHeight;
      if (room <= 0) return;
      storeReaderPosition(noteId, element.scrollTop / room, 'page');
    }
    function restoreHtmlFramePosition(frame, noteId) {
      const saved = readReaderPosition(noteId);
      const context = frame && htmlReadableFrames.get(frame);
      if (!saved || saved.mode !== 'html' || !context || currentPage !== 'reader' || activeId !== noteId) return;
      setReaderProgressPercent(saved.ratio * 100);
      frame.contentWindow?.postMessage({ type:'notez-restore-scroll', token:context.token, ratio:saved.ratio }, '*');
    }
    function restoreReaderPosition(noteId) {
      const saved = readReaderPosition(noteId);
      if (!saved || currentPage !== 'reader' || activeId !== noteId) return;
      setReaderProgressPercent(saved.ratio * 100);
      if (saved.mode === 'html' || saved.mode === 'pdf') return;
      requestAnimationFrame(() => {
        if (currentPage !== 'reader' || activeId !== noteId) return;
        const element = $('#workspace-main');
        const room = element.scrollHeight - element.clientHeight;
        if (room > 0) element.scrollTop = room * saved.ratio;
        updateReadingProgress();
      });
    }
    function toggleFocus() {
      const shell = $('#app-shell');
      const focused = shell.classList.contains('focus-mode');
      const activeNote = notes.find(note => note.id === activeId);
      if (focused) {
        shell.classList.remove('focus-mode','pdf-focus-mode');
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      } else {
        shell.classList.remove('mobile-nav-open','pdf-focus-mode');
        shell.classList.add('focus-mode');
        if (isPdfNote(activeNote)) shell.classList.add('pdf-focus-mode');
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      }
      updatePdfFocusControl();
      updateReadingProgress();
    }
    function queueReadingProgressUpdate() {
      if (readingProgressFrame) return;
      readingProgressFrame = window.requestAnimationFrame(() => { readingProgressFrame = 0; updateReadingProgress(); });
    }
    function updateReadingProgress() {
      const el = $('#workspace-main');
      if (!el) return;
      const room = el.scrollHeight - el.clientHeight;
      const saved = currentPage === 'reader' && activeId ? readReaderPosition(activeId) : null;
      if (saved?.mode === 'pdf' && activePdfReaderState?.noteId === activeId) { setReaderProgressPercent(saved.ratio * 100); return; }
      if (['html','pdf'].includes(saved?.mode) && el.scrollTop <= 3) { setReaderProgressPercent(saved.ratio * 100); return; }
      const percent = room > 0 ? Math.max(0, Math.min(100, (el.scrollTop / room) * 100)) : 0;
      setReaderProgressPercent(percent);
    }
    function setLoginMode(mode) {
      loginMode = mode;
      clearAuthError();
      const create = mode === 'signup';
      $('#signin-tab').classList.toggle('active', !create);
      $('#signup-tab').classList.toggle('active', create);
      $('#signin-tab').setAttribute('aria-selected', String(!create));
      $('#signup-tab').setAttribute('aria-selected', String(create));
      $('#auth-heading').textContent = create ? 'Create your space' : 'Welcome back';
      $('#auth-intro').textContent = create ? 'A private home for your notes, references, and ideas.' : 'Sign in to return to your personal study space.';
      $('#auth-submit').textContent = create ? 'Create secure account' : 'Sign in securely';
      $('#forgot-password').classList.toggle('hidden', create);
      $('#auth-password').autocomplete = create ? 'new-password' : 'current-password';
    }
    async function submitAuth(event) {
      event.preventDefault();
      clearAuthError();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      if (!email || !password) return;
      const button = $('#auth-submit');
      button.disabled = true;
      button.textContent = 'Connecting securely…';
      try {
        userChoseDemo = false;
        const sdk = await ensureFirebase();
        try {
          await sdk.setPersistence(sdk.auth, $('#remember-me').checked ? sdk.browserLocalPersistence : sdk.browserSessionPersistence);
        } catch (persistError) {
          console.warn('Persistence unavailable, continuing with in-memory session:', persistError);
          try { await sdk.setPersistence(sdk.auth, sdk.inMemoryPersistence); } catch {}
        }
        const response = loginMode === 'signup'
          ? await sdk.createUserWithEmailAndPassword(sdk.auth, email, password)
          : await sdk.signInWithEmailAndPassword(sdk.auth, email, password);
        await enterCloudWorkspace(response.user);
      } catch (error) {
        console.error(error);
        const message = !error?.code && (String(error?.message || '').includes('Failed to fetch') || String(error?.message || '').includes('dynamically imported'))
          ? 'Firebase could not load. Check your connection, then try again.'
          : friendlyFirebaseError(error);
        showAuthError(message);
      } finally {
        button.disabled = false;
        button.textContent = loginMode === 'signup' ? 'Create secure account' : 'Sign in securely';
      }
    }
    async function resetPassword() {
      clearAuthError();
      const emailInput = $('#auth-email');
      const email = emailInput.value.trim();
      if (!email) { showAuthError('Enter your account email above to receive a password-reset link.'); emailInput.focus(); return; }
      if (!emailInput.checkValidity()) { showAuthError('Enter a valid email address, then request a new reset link.'); emailInput.focus(); return; }
      const button = $('#forgot-password');
      button.disabled = true;
      emailInput.disabled = true;
      button.textContent = 'Sending link…';
      try {
        const sdk = await ensureFirebase();
        await sdk.sendPasswordResetEmail(sdk.auth,email);
        showAuthStatus(`If an account exists for ${email}, a reset link will arrive shortly. Check your inbox and spam folder.`);
      } catch (error) {
        console.warn('Password reset request failed:',error);
        if (error?.code === 'auth/user-not-found') {
          showAuthStatus(`If an account exists for ${email}, a reset link will arrive shortly. Check your inbox and spam folder.`);
        } else {
          const detail = String(error?.message || '');
          showAuthError(detail.includes('Failed to fetch') || detail.includes('dynamically imported')
            ? 'Firebase could not load. Check your connection, then request the reset link again.'
            : friendlyFirebaseError(error));
        }
      } finally {
        button.disabled = false;
        emailInput.disabled = false;
        button.textContent = 'Forgot password?';
      }
    }

    // Event wiring
    $('#signin-tab').addEventListener('click', () => setLoginMode('signin'));
    $('#signup-tab').addEventListener('click', () => setLoginMode('signup'));
    $('#auth-form').addEventListener('submit', submitAuth);
    $('#auth-email').addEventListener('input',clearAuthError);
    $('#forgot-password').addEventListener('click', resetPassword);
    $('#demo-button').addEventListener('click', enterDemoWorkspace);
    $('#theme-toggle').addEventListener('click', toggleTheme);
    $('#theme-toggle-login').addEventListener('click', toggleTheme);
    $('#editor-write-tab').addEventListener('click', () => setEditorMode('write'));
    $('#editor-preview-tab').addEventListener('click', () => setEditorMode('preview'));
    $('#markdown-toolbar').addEventListener('mousedown', event => { if (event.target.closest('[data-markdown-format]')) event.preventDefault(); });
    $('#markdown-toolbar').addEventListener('click', event => {
      const button = event.target.closest('[data-markdown-format]');
      if (button) applyMarkdownFormat(button.dataset.markdownFormat);
    });
    $('#side-new-note').addEventListener('click', () => { $('#app-shell').classList.remove('mobile-nav-open'); openEditor(); });
    $('#top-new-note').addEventListener('click', () => pickTemplate());
    $('#home-new-note').addEventListener('click', () => pickTemplate());
    $('#home-import').addEventListener('click', () => $('#file-input').click());
    $('#top-upload').addEventListener('click', () => $('#file-input').click());
    $('#add-folder-button').addEventListener('click', () => promptFolder());
    $('#home-add-folder').addEventListener('click', () => promptFolder());
    $('#folder-tree').addEventListener('click', event => {
      const menuButton = event.target.closest('[data-folder-menu]');
      if (menuButton) {
        event.preventDefault(); event.stopPropagation();
        const rect = menuButton.getBoundingClientRect();
        openActionMenu('folder', menuButton.dataset.folderMenu, rect.right - 230, rect.bottom + 4, menuButton);
        return;
      }
      const toggle = event.target.closest('[data-folder-toggle]');
      if (toggle) {
        const path = toggle.dataset.folderToggle;
        if (expandedFolders.has(path)) expandedFolders.delete(path); else expandedFolders.add(path);
        renderFolderTree(); return;
      }
      const link = event.target.closest('[data-folder-open]');
      if (link) {
        currentFolderPath = cleanFolderPath(link.dataset.folderOpen);
        currentPage = 'notes'; activeFilter = 'all'; $('#search-input').value = '';
        pushAppRoute();
        $('#app-shell').classList.remove('mobile-nav-open');
        renderEverything(); $('#workspace-main').scrollTop = 0;
      }
    });
    $('#file-input').addEventListener('change', event => importFiles(event.target.files));
    $('#search-input').addEventListener('input', () => {
      if (selectionMode) { selectionMode = false; selectedNoteIds.clear(); }
      if ($('#search-input').value.trim()) {
        const enteringSearch = currentPage !== 'notes' || activeFilter !== 'all' || Boolean(currentFolderPath);
        currentPage = 'notes'; activeFilter = 'all'; currentFolderPath = '';
        if (enteringSearch) pushAppRoute();
        else replaceCurrentAppRoute();
      } else if (currentPage === 'notes') replaceCurrentAppRoute();
      if (searchRenderTimer) clearTimeout(searchRenderTimer);
      searchRenderTimer = window.setTimeout(() => { searchRenderTimer = 0; renderEverything(); }, 120);
    });
    $('#sort-button').addEventListener('click', () => {
      const willOpen = $('#sort-menu').classList.contains('hidden');
      closeSortMenu();
      if (willOpen) {
        $('#sort-menu').classList.remove('hidden');
        $('#sort-button').setAttribute('aria-expanded', 'true');
        $('#sort-menu').querySelector('[aria-checked="true"]')?.focus({ preventScroll:true });
      }
    });
    $('#sort-menu').addEventListener('click', event => {
      const option = event.target.closest('[data-sort-mode]');
      if (!option) return;
      sortMode = option.dataset.sortMode;
      try { localStorage.setItem('notez-sort-mode-v1',sortMode); } catch {}
      closeSortMenu();
      renderNotesPage();
      $('#sort-button').focus({ preventScroll:true });
    });
    $('#sort-menu').addEventListener('keydown', event => {
      const options = $$('[data-sort-mode]', $('#sort-menu'));
      const current = options.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        options[(current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
      } else if (event.key === 'Home') { event.preventDefault(); options[0]?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); options.at(-1)?.focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); closeSortMenu(); $('#sort-button').focus({ preventScroll:true }); }
    });
    $$('[data-view-mode]').forEach(button => button.addEventListener('click', () => {
      libraryView = button.dataset.viewMode === 'list' ? 'list' : 'grid';
      try { localStorage.setItem('notez-library-view-v1', libraryView); } catch {}
      renderNotesPage();
    }));
    $('#selection-toggle').addEventListener('click', () => toggleSelectionMode());
    $('#view-notes-grid').addEventListener('click', event => {
      const open = event.target.closest('[data-folder-open]')?.dataset.folderOpen;
      if (open) { openFolderPath(open); return; }
      if (event.target.closest('[data-folder-notes]')) { folderNotesOnly = true; renderNotesPage(); return; }
      if (event.target.closest('[data-folder-back]')) { folderNotesOnly = false; renderNotesPage(); }
    });
    $('#select-all-visible').addEventListener('click', toggleVisibleSelection);
    $('#clear-selection').addEventListener('click', () => { selectedNoteIds.clear(); renderNotesPage(); });
    $$('[data-bulk-action]').forEach(button => button.addEventListener('click', () => void runBulkAction(button.dataset.bulkAction)));
    $('#command-input').addEventListener('input', () => { commandActiveIndex = 0; renderCommandResults(); });
    $('#command-input').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (commandEntries.length) commandActiveIndex = (commandActiveIndex + (event.key === 'ArrowDown' ? 1 : commandEntries.length - 1)) % commandEntries.length;
        renderCommandResults();
      } else if (event.key === 'Enter') { event.preventDefault(); executeCommandEntry(commandActiveIndex); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCommandPalette(true); }
    });
    $('#command-results').addEventListener('click', event => {
      const option = event.target.closest('[data-command-index]');
      if (option) executeCommandEntry(Number(option.dataset.commandIndex));
    });
    $('#command-overlay').addEventListener('click', event => { if (event.target === event.currentTarget) closeCommandPalette(true); });
    $('#command-overlay').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCommandPalette(true); }
      else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target !== $('#command-input')) {
        event.preventDefault();
        if (commandEntries.length) commandActiveIndex = (commandActiveIndex + (event.key === 'ArrowDown' ? 1 : commandEntries.length - 1)) % commandEntries.length;
        renderCommandResults(); $('#command-input').focus({ preventScroll:true });
      } else if (event.key === 'Tab') {
        const focusables = [$('#command-input'), ...$$('[data-command-index]', $('#command-results'))];
        const position = focusables.indexOf(document.activeElement);
        if (event.shiftKey && position === 0) { event.preventDefault(); focusables.at(-1)?.focus(); }
        else if (!event.shiftKey && position === focusables.length - 1) { event.preventDefault(); focusables[0]?.focus(); }
      }
    });
    $$('.nav-item[data-page]').forEach(button => button.addEventListener('click', () => {
      const page = button.dataset.page;
      navigateToPage(page === 'home' ? 'home' : 'notes', page === 'home' || page === 'all' ? 'all' : page);
    }));
    $('#workspace-main').addEventListener('click', event => {
      if (event.target.closest('#empty-start-note') || event.target.closest('#spotlight-create-note')) { openEditor(); return; }
      const selectButton = event.target.closest('[data-select-id]');
      if (selectButton) { event.preventDefault(); event.stopPropagation(); toggleNoteSelection(selectButton.dataset.selectId); return; }
      const menuButton = event.target.closest('[data-note-menu],[data-folder-menu]');
      if (menuButton) {
        event.preventDefault(); event.stopPropagation();
        const rect = menuButton.getBoundingClientRect();
        if (menuButton.hasAttribute('data-note-menu')) openActionMenu('note', menuButton.dataset.noteMenu, rect.right - 230, rect.bottom + 4, menuButton);
        else openActionMenu('folder', menuButton.dataset.folderMenu, rect.right - 230, rect.bottom + 4, menuButton);
        return;
      }
      const star = event.target.closest('[data-star-id]');
      if (star) {
        event.preventDefault(); event.stopPropagation();
        const note = notes.find(item => item.id === star.dataset.starId);
        if (note) { note.favorite = !note.favorite; note.updatedAt = Date.now(); persistNote(note).catch(() => toast('Saved locally; Firebase sync is queued.', 'error')); renderEverything(); }
        return;
      }
      const openButton = event.target.closest('[data-note-open]');
      if (openButton) { if (selectionMode && openButton.closest('[data-note-tile]')) toggleNoteSelection(openButton.closest('[data-note-tile]').dataset.noteTile); else openNote(openButton.dataset.noteOpen); return; }
      const folderToggle = event.target.closest('[data-folder-toggle]');
      if (folderToggle) {
        const path = folderToggle.dataset.folderToggle;
        if (expandedFolders.has(path)) expandedFolders.delete(path); else expandedFolders.add(path);
        renderFolderTree(); return;
      }
      const folderButton = event.target.closest('[data-folder-open]');
      if (folderButton) {
        const path = cleanFolderPath(folderButton.dataset.folderOpen);
        expandFolderPath(path);
        currentFolderPath = path;
        currentPage = 'notes'; activeFilter = 'all'; $('#search-input').value = '';
        pushAppRoute();
        $('#app-shell').classList.remove('mobile-nav-open');
        renderEverything(); $('#workspace-main').scrollTop = 0; return;
      }
      const subfolder = event.target.closest('[data-create-subfolder]');
      if (subfolder) { promptFolder(`${cleanFolderPath(subfolder.dataset.createSubfolder)}/`); return; }
      if (event.target.closest('[data-create-folder]')) { promptFolder(); return; }
      const pageLink = event.target.closest('[data-page]');
      if (pageLink && $('#workspace-main').contains(pageLink)) {
        const page = pageLink.dataset.page;
        navigateToPage(page === 'home' ? 'home' : 'notes', page === 'home' || page === 'all' ? 'all' : page);
      }
    });
    $('#workspace-main').addEventListener('contextmenu', event => {
      const folderButton = event.target.closest('[data-folder-menu]');
      const folderLink = event.target.closest('[data-folder-open]');
      const subfolderButton = event.target.closest('[data-create-subfolder]');
      const folderPath = folderButton?.dataset.folderMenu || folderLink?.dataset.folderOpen || subfolderButton?.dataset.createSubfolder;
      if (folderPath) {
        event.preventDefault();
        openActionMenu('folder', folderPath, event.clientX, event.clientY, event.target.closest('button'));
        return;
      }
      const noteTile = event.target.closest('[data-note-tile]');
      if (noteTile) { event.preventDefault(); openActionMenu('note', noteTile.dataset.noteTile, event.clientX, event.clientY, event.target.closest('button')); }
    });
    $('#folder-tree').addEventListener('contextmenu', event => {
      const item = event.target.closest('[data-folder-menu],[data-folder-open]');
      if (!item) return;
      event.preventDefault();
      openActionMenu('folder', item.dataset.folderMenu || item.dataset.folderOpen, event.clientX, event.clientY, event.target.closest('button'));
    });
    $('#action-menu').addEventListener('click', event => {
      const button = event.target.closest('[data-menu-action]');
      if (button) void runActionMenuAction(button.dataset.menuAction);
    });
    $('#action-menu').addEventListener('keydown', event => {
      const items = $$('[role="menuitem"]', $('#action-menu'));
      const current = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
      else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeActionMenu(true); }
    });
    $('#reader-back').addEventListener('click', () => goBackInApp(previousPage || 'home'));
    $('#list-back').addEventListener('click', () => goBackInApp('home'));
    $('#reader-crumb-path').addEventListener('click', event => {
      const folder = event.target.closest('[data-crumb-folder]')?.dataset.crumbFolder;
      if (folder) { openFolderPath(folder); return; }
      if (event.target.closest('[data-crumb="all"]')) navigateToPage('notes', 'all');
    });
    $('#favorite-current').addEventListener('click', () => {
      const note = notes.find(item => item.id === activeId); if (!note) return;
      note.favorite = !note.favorite; note.updatedAt = Date.now();
      persistNote(note).catch(() => toast('Saved locally; Firebase sync is queued.', 'error'));
      renderEverything();
    });
    $('#complete-current').addEventListener('click', event => {
      event.stopPropagation();
      setReviewPopover($('#review-popover').classList.contains('hidden'));
    });
    $('#review-popover').addEventListener('click', event => {
      const rating = event.target.closest('[data-review-rating]')?.dataset.reviewRating;
      if (rating) handleReviewRating(rating);
    });
    $('#start-study-session').addEventListener('click', startStudySession);
    $('#study-session-skip').addEventListener('click', () => advanceStudySession('skipped'));
    $('#study-session-finish').addEventListener('click', () => finishStudySession(true));
    $('#edit-current').addEventListener('click', () => { const note = notes.find(item => item.id === activeId); if (note) openEditor(note); });
    $('#focus-current').addEventListener('click', toggleFocus);
    $('#exit-focus').addEventListener('click', toggleFocus);
