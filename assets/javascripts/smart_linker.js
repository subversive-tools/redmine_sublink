/**
 * smart_linker.js — Redmine Sublink: Smart Linker
 *
 * Trigger: >> (nach Leerzeichen oder Zeilenanfang)
 *
 * Ebene 1 (Projekt wählen / Allgemeine Links):
 *   – Allgemeine Links  → E-Mail | Weblink | Anhang
 *   – Projektliste       → Issues | Mitglieder | Wiki
 *
 * Eingefügte Link-Syntax (Redmine Textile):
 *   Issue     : identifier#42   (aktuelles Projekt: #42)
 *   Mitglied  : @login
 *   Wiki      : [[identifier:Seite]]  (aktuelles Projekt: [[Seite]])
 *   E-Mail    : "addr":mailto:addr
 *   Weblink   : "display":https://url
 *   Anhang    : attachment:datei.pdf  |  !attachment:bild.png!
 */
(function () {
  'use strict';

  /* ── Konfiguration ──────────────────────────────────────────────────────── */
  var PANEL_W        = 400;
  var MAX_RESULTS    = 10;
  var ISSUE_DEBOUNCE = 280;

  /* ── State ──────────────────────────────────────────────────────────────── */
  // closed | project | general | category |
  // issue  | member  | wiki    | mailto   | weblink | attachment
  var st       = 'closed';
  var activeTa = null;
  var tStart   = -1;
  var tEnd     = -1;
  var curProj  = null;   // { id, identifier, name }

  /* ── Aktuelles Projekt aus URL ──────────────────────────────────────────── */
  var urlProjId = (location.pathname.match(/\/projects\/([^\/]+)/) || [])[1] || null;

  /* ── Cache ──────────────────────────────────────────────────────────────── */
  var cache = {
    projects:    null,
    members:     {},
    wiki:        {},
    attachments: {}   // keyed by location.pathname
  };

  /* ── DOM ────────────────────────────────────────────────────────────────── */
  var panel, pBack, pTitle, pSearch, pList;
  var issueTimer = null;
  var selIdx     = -1;

  /* ════════════════════════════════════════════════════════════════════════
   * Panel bauen
   * ════════════════════════════════════════════════════════════════════════ */
  function buildPanel() {
    panel = mk('div', 'sl-panel');
    panel.style.cssText = 'display:none;position:fixed;z-index:100000;width:' + PANEL_W + 'px';
    panel.setAttribute('role', 'dialog');

    var hdr = mk('div', 'sl-header');
    pBack = mk('button', 'sl-back');
    pBack.type = 'button';
    pBack.innerHTML = '&#8592;';
    pBack.title = 'Zurück';
    pBack.style.display = 'none';
    pBack.addEventListener('mousedown', function (e) { e.preventDefault(); goBack(); });
    pTitle = mk('span', 'sl-title');
    hdr.appendChild(pBack);
    hdr.appendChild(pTitle);
    panel.appendChild(hdr);

    pSearch = mk('input');
    pSearch.type = 'text';
    pSearch.className = 'sl-search';
    pSearch.setAttribute('autocomplete', 'off');
    pSearch.setAttribute('spellcheck', 'false');
    pSearch.addEventListener('input',   function () { onPanelSearch(this.value); });
    pSearch.addEventListener('keydown', onPanelKeydown);
    panel.appendChild(pSearch);

    pList = mk('ul', 'sl-list');
    pList.setAttribute('role', 'listbox');
    panel.appendChild(pList);

    document.addEventListener('mousedown', function (e) {
      if (st !== 'closed' && !panel.contains(e.target) && e.target !== activeTa) cancel();
    });
    document.body.appendChild(panel);
  }

  /* ── Positionierung ─────────────────────────────────────────────────────── */
  function posPanel(ta) {
    var r    = ta.getBoundingClientRect();
    var left = r.left;
    var top  = r.bottom + 6;
    var estH = 44 + 38 + MAX_RESULTS * 36;
    if (left + PANEL_W > window.innerWidth  - 8) left = window.innerWidth  - PANEL_W - 8;
    if (left < 4) left = 4;
    if (top  + estH > window.innerHeight - 8) top = Math.max(4, r.top - estH - 6);
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  }

  /* ── Öffnen / Schließen ─────────────────────────────────────────────────── */
  function openPanel(ta) { activeTa = ta; panel.style.display = 'block'; posPanel(ta); }

  function closePanel() {
    if (panel) panel.style.display = 'none';
    st = 'closed'; curProj = null;
    activeTa = null; tStart = tEnd = selIdx = -1;
  }

  function cancel() {
    if (activeTa && tStart >= 0) {
      var v = activeTa.value, end = tEnd >= 0 ? tEnd : tStart + 2;
      activeTa.value = v.substring(0, tStart) + v.substring(end);
      activeTa.selectionStart = activeTa.selectionEnd = tStart;
      activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      activeTa.focus();
    }
    closePanel();
  }

  /* ── Navigation ─────────────────────────────────────────────────────────── */
  function goBack() {
    if (st === 'mailto' || st === 'weblink' || st === 'attachment') {
      showGeneralCategory();
    } else if (st === 'general') {
      showProjects('');
    } else if (st === 'issue' || st === 'member' || st === 'wiki') {
      showCategory();
    } else if (st === 'category') {
      showProjects('');
    } else {
      cancel();
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 1 — Projekt wählen (+ Allgemeine Links oben)
   * ════════════════════════════════════════════════════════════════════════ */
  function showProjects(q) {
    st = 'project';
    pBack.style.display   = 'none';
    pTitle.textContent    = '🔗\u2009Verknüpfung erstellen';
    pSearch.style.display = '';
    pSearch.placeholder   = 'Projekt suchen …';
    pSearch.value         = q;
    if (cache.projects) { renderProjects(q); }
    else {
      renderItems([{ label: 'Lade Projekte …', disabled: true }]);
      loadJSON('/projects.json?limit=100', function (d) {
        cache.projects = d.projects || [];
        renderProjects(q);
      }, function () { renderItems([{ label: 'Fehler beim Laden', disabled: true }]); });
    }
    focusSearch();
  }

  function renderProjects(q) {
    var lq       = q.toLowerCase().trim();
    var all      = cache.projects || [];
    var filtered = lq
      ? all.filter(function (p) {
          return p.name.toLowerCase().indexOf(lq) !== -1 ||
                 p.identifier.toLowerCase().indexOf(lq) !== -1;
        })
      : all.slice();

    filtered.sort(function (a, b) {
      if (a.identifier === urlProjId) return -1;
      if (b.identifier === urlProjId) return 1;
      return a.name.localeCompare(b.name);
    });

    var items = [];

    // Allgemeine Links nur anzeigen wenn nicht nach Projekt gesucht wird
    if (!lq) {
      items.push({
        icon: '🔗', label: 'Allgemeine Links', sub: 'E-Mail · Web · Anhang',
        onSelect: function () { showGeneralCategory(); }
      });
      if (filtered.length) items.push({ section: true, label: 'Projekte' });
    }

    filtered.forEach(function (p) {
      items.push({
        icon:     p.identifier === urlProjId ? '✓' : '📁',
        label:    p.name,
        sub:      p.identifier,
        onSelect: function () { curProj = p; showCategory(); }
      });
    });

    if (!items.length) items.push({ label: 'Kein Projekt gefunden', disabled: true });
    renderItems(items);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 1b — Allgemeine Links
   * ════════════════════════════════════════════════════════════════════════ */
  function showGeneralCategory() {
    st = 'general';
    pBack.style.display   = '';
    pTitle.textContent    = 'Allgemeine Links';
    pSearch.style.display = 'none';
    pSearch.value         = '';
    renderItems([
      { icon: '📧', label: 'E-Mail',   sub: 'mailto:…',      onSelect: function () { showMailto(); } },
      { icon: '🌐', label: 'Weblink',  sub: 'https://…',     onSelect: function () { showWeblink(); } },
      { icon: '📎', label: 'Anhang',   sub: 'attachment:…',  onSelect: function () { showAttachment(); } }
    ]);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 2 — Projekt-Kategorien
   * ════════════════════════════════════════════════════════════════════════ */
  function showCategory() {
    st = 'category';
    pBack.style.display   = '';
    pTitle.textContent    = curProj.name;
    pSearch.style.display = 'none';
    pSearch.value         = '';
    renderItems([
      { icon: '🐛', label: 'Issues',     sub: curProj.identifier + '#42',  onSelect: function () { showIssues(''); } },
      { icon: '👤', label: 'Mitglieder', sub: '@benutzername',             onSelect: function () { showMembers(''); } },
      { icon: '📄', label: 'Wiki-Seiten',sub: '[[…]]',                     onSelect: function () { showWiki(''); } }
    ]);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Issues
   * ════════════════════════════════════════════════════════════════════════ */
  function showIssues(q) {
    st = 'issue';
    pBack.style.display   = '';
    pTitle.textContent    = curProj.name + ' \u203a Issues';
    pSearch.style.display = '';
    pSearch.placeholder   = '#Nummer oder Titel …';
    pSearch.value         = q;
    fetchIssues(q);
    focusSearch();
  }

  function fetchIssues(q) {
    renderItems([{ label: 'Suche …', disabled: true }]);
    var stripped = q.replace(/^#/, '').trim();
    var url = '/issues.json?project_id=' + enc(curProj.identifier) + '&limit=' + MAX_RESULTS;
    if (/^\d+$/.test(stripped))  url += '&issue_id=' + stripped;
    else if (stripped)           url += '&status_id=*&subject=~' + enc(stripped);
    else                         url += '&status_id=open&sort=updated_on:desc';

    loadJSON(url, function (d) {
      var iss = d.issues || [];
      renderItems(iss.length ? iss.map(function (i) {
        return {
          icon: '#' + i.id, label: i.subject,
          sub:  i.status ? i.status.name : '',
          onSelect: function () {
            doInsert(curProj.identifier === urlProjId
              ? '#' + i.id
              : curProj.identifier + '#' + i.id);
          }
        };
      }) : [{ label: 'Keine Issues gefunden', disabled: true }]);
    }, function () { renderItems([{ label: 'Fehler beim Laden', disabled: true }]); });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Mitglieder
   * ════════════════════════════════════════════════════════════════════════ */
  function showMembers(q) {
    st = 'member';
    pBack.style.display   = '';
    pTitle.textContent    = curProj.name + ' \u203a Mitglieder';
    pSearch.style.display = '';
    pSearch.placeholder   = 'Name oder Login …';
    pSearch.value         = q;
    var pid = curProj.identifier;
    if (cache.members[pid]) { renderMemberItems(cache.members[pid], q); focusSearch(); }
    else {
      renderItems([{ label: 'Lade …', disabled: true }]);
      loadMembers(function (members) {
        cache.members[pid] = members;
        renderMemberItems(members, q);
        focusSearch();
      });
    }
  }

  function loadMembers(cb) {
    var pid = curProj.identifier;
    loadJSON('/users/auto_complete.json?term=&project_id=' + curProj.id,
      function (data) {
        cb((Array.isArray(data) ? data : []).map(function (u) {
          return { id: u.id, name: u.value || u.name || '', login: u.login || '' };
        }));
      },
      function () {
        loadJSON('/projects/' + pid + '/memberships.json?limit=100',
          function (d) {
            cb((d.memberships || []).filter(function (m) { return m.user; })
              .map(function (m) { return { id: m.user.id, name: m.user.name, login: '' }; }));
          },
          function () { cb([]); }
        );
      }
    );
  }

  function renderMemberItems(members, q) {
    var lq = q.toLowerCase().trim();
    var list = lq
      ? members.filter(function (m) {
          return m.name.toLowerCase().indexOf(lq) !== -1 ||
                 m.login.toLowerCase().indexOf(lq) !== -1;
        })
      : members;
    renderItems(list.slice(0, MAX_RESULTS).map(function (m) {
      var mention = m.login || m.name.toLowerCase().replace(/\s+/g, '.');
      return { icon: '👤', label: m.name, sub: '@' + mention,
               onSelect: function () { doInsert('@' + mention); } };
    }), 'Keine Mitglieder gefunden');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Wiki
   * ════════════════════════════════════════════════════════════════════════ */
  function showWiki(q) {
    st = 'wiki';
    pBack.style.display   = '';
    pTitle.textContent    = curProj.name + ' \u203a Wiki';
    pSearch.style.display = '';
    pSearch.placeholder   = 'Seitentitel …';
    pSearch.value         = q;
    var pid = curProj.identifier;
    if (cache.wiki[pid]) { renderWikiItems(cache.wiki[pid], q); focusSearch(); }
    else {
      renderItems([{ label: 'Lade …', disabled: true }]);
      loadJSON('/projects/' + pid + '/wiki/index.json',
        function (d) {
          cache.wiki[pid] = d.wiki_pages || [];
          renderWikiItems(cache.wiki[pid], q);
          focusSearch();
        },
        function () {
          cache.wiki[pid] = [];
          renderItems([{ label: 'Fehler beim Laden', disabled: true }]);
        }
      );
    }
  }

  function renderWikiItems(pages, q) {
    var lq = q.toLowerCase().trim();
    var list = lq
      ? pages.filter(function (p) { return p.title.toLowerCase().indexOf(lq) !== -1; })
      : pages;
    renderItems(list.slice(0, MAX_RESULTS).map(function (p) {
      var link = curProj.identifier === urlProjId
        ? '[[' + p.title + ']]'
        : '[[' + curProj.identifier + ':' + p.title + ']]';
      return { icon: '📄', label: p.title, sub: link,
               onSelect: function () { doInsert(link); } };
    }), 'Keine Wiki-Seiten gefunden');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * E-Mail
   * ════════════════════════════════════════════════════════════════════════ */
  function showMailto() {
    st = 'mailto';
    pBack.style.display   = '';
    pTitle.textContent    = '📧\u2009E-Mail-Link';
    pSearch.style.display = '';
    pSearch.placeholder   = 'email@beispiel.de …';
    pSearch.value         = '';
    renderMailtoPreview('');
    focusSearch();
  }

  function renderMailtoPreview(v) {
    if (!v || v.indexOf('@') < 1) {
      renderItems([{ label: 'E-Mail-Adresse eingeben …', disabled: true }]);
      return;
    }
    var link = '"' + v + '":mailto:' + v;
    renderItems([{ icon: '📧', label: v, sub: link,
                   onSelect: function () { doInsert(link); } }]);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Weblink
   * ════════════════════════════════════════════════════════════════════════ */
  function showWeblink() {
    st = 'weblink';
    pBack.style.display   = '';
    pTitle.textContent    = '🌐\u2009Web-Link';
    pSearch.style.display = '';
    pSearch.placeholder   = 'https://beispiel.de …';
    pSearch.value         = '';
    renderWeblinkPreview('');
    focusSearch();
  }

  function renderWeblinkPreview(raw) {
    if (!raw) { renderItems([{ label: 'URL eingeben …', disabled: true }]); return; }
    var url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    var display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    var link    = '"' + display + '":' + url;
    renderItems([{ icon: '🌐', label: display, sub: url,
                   onSelect: function () { doInsert(link); } }]);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Anhang
   * ════════════════════════════════════════════════════════════════════════ */
  function showAttachment() {
    st = 'attachment';
    pBack.style.display   = '';
    pTitle.textContent    = '📎\u2009Anhang verlinken';
    pSearch.style.display = '';
    pSearch.placeholder   = 'Dateiname …';
    pSearch.value         = '';
    var key = location.pathname;
    if (cache.attachments[key]) { renderAttachItems(cache.attachments[key], ''); focusSearch(); }
    else {
      renderItems([{ label: 'Lade Anhänge …', disabled: true }]);
      loadAttachments(function (list) {
        cache.attachments[key] = list;
        renderAttachItems(list, '');
        focusSearch();
      });
    }
  }

  function loadAttachments(cb) {
    var m;
    m = location.pathname.match(/\/issues\/(\d+)/);
    if (m) {
      loadJSON('/issues/' + m[1] + '.json?include=attachments',
        function (d) { cb((d.issue && d.issue.attachments) || []); },
        function () { cb([]); });
      return;
    }
    m = location.pathname.match(/\/projects\/([^\/]+)\/wiki\/([^\/\?]+)/);
    if (m) {
      loadJSON('/projects/' + m[1] + '/wiki/' + m[2] + '.json',
        function (d) { cb((d.wiki_page && d.wiki_page.attachments) || []); },
        function () { cb([]); });
      return;
    }
    cb([]);
  }

  function renderAttachItems(list, q) {
    if (!list.length) {
      renderItems([{ label: 'Keine Anhänge auf dieser Seite', disabled: true }]);
      return;
    }
    var lq = q.toLowerCase().trim();
    var filtered = lq
      ? list.filter(function (a) { return a.filename.toLowerCase().indexOf(lq) !== -1; })
      : list;
    renderItems(filtered.slice(0, MAX_RESULTS).map(function (a) {
      var isImg = /^image\//i.test(a.content_type || '');
      var link  = isImg ? '!attachment:' + a.filename + '!' : 'attachment:' + a.filename;
      return { icon: isImg ? '🖼️' : '📎', label: a.filename, sub: link,
               onSelect: function () { doInsert(link); } };
    }), 'Keine Dateien gefunden');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Panel-Interaktion
   * ════════════════════════════════════════════════════════════════════════ */
  function onPanelSearch(q) {
    if      (st === 'project')    renderProjects(q);
    else if (st === 'member')     renderMemberItems(cache.members[curProj && curProj.identifier] || [], q);
    else if (st === 'wiki')       renderWikiItems(cache.wiki[curProj && curProj.identifier] || [], q);
    else if (st === 'mailto')     renderMailtoPreview(q);
    else if (st === 'weblink')    renderWeblinkPreview(q);
    else if (st === 'attachment') renderAttachItems(cache.attachments[location.pathname] || [], q);
    else if (st === 'issue') {
      clearTimeout(issueTimer);
      issueTimer = setTimeout(function () { fetchIssues(q); }, ISSUE_DEBOUNCE);
    }
  }

  function onPanelKeydown(e) {
    var items = pList.querySelectorAll('li[data-idx]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selIdx = Math.min(selIdx + 1, items.length - 1);
      applyHL(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = Math.max(selIdx - 1, 0);
      applyHL(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var t = selIdx >= 0 ? items[selIdx] : items.length === 1 ? items[0] : null;
      if (t) t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      goBack();
    }
  }

  /* ── Listendarstellung ──────────────────────────────────────────────────── */
  function renderItems(items, emptyMsg) {
    selIdx = -1;
    if (!items || !items.length) {
      pList.innerHTML = '<li class="sl-disabled">' + h(emptyMsg || 'Keine Ergebnisse') + '</li>';
      return;
    }
    pList.innerHTML = items.map(function (item, i) {
      if (item.section)  return '<li class="sl-section">' + h(item.label) + '</li>';
      if (item.disabled) return '<li class="sl-disabled">' + h(item.label) + '</li>';
      return '<li data-idx="' + i + '" role="option">' +
             '<span class="sl-icon">' + h(item.icon || '') + '</span>' +
             '<span class="sl-label">' + h(item.label) + '</span>' +
             (item.sub ? '<span class="sl-sub">' + h(item.sub) + '</span>' : '') +
             '</li>';
    }).join('');

    pList.querySelectorAll('li[data-idx]').forEach(function (li) {
      var item = items[parseInt(li.dataset.idx, 10)];
      if (!item || !item.onSelect) return;
      li.addEventListener('mouseenter', function () {
        selIdx = parseInt(li.dataset.idx, 10);
        applyHL(pList.querySelectorAll('li[data-idx]'));
      });
      li.addEventListener('mousedown', function (e) { e.preventDefault(); item.onSelect(); });
    });
  }

  function applyHL(items) {
    items.forEach(function (li, i) {
      li.classList.toggle('sl-selected', i === selIdx);
      li.setAttribute('aria-selected', i === selIdx ? 'true' : 'false');
    });
    if (items[selIdx]) items[selIdx].scrollIntoView({ block: 'nearest' });
  }

  /* ── Link einfügen ──────────────────────────────────────────────────────── */
  function doInsert(text) {
    if (!activeTa || tStart < 0) { closePanel(); return; }
    var v = activeTa.value, end = tEnd >= 0 ? tEnd : tStart + 2;
    activeTa.value = v.substring(0, tStart) + text + v.substring(end);
    var np = tStart + text.length;
    activeTa.selectionStart = activeTa.selectionEnd = np;
    activeTa.dispatchEvent(new Event('input', { bubbles: true }));
    activeTa.focus();
    closePanel();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Trigger-Erkennung im Textarea
   * ════════════════════════════════════════════════════════════════════════ */
  function onTaInput(e) {
    var ta     = e.target;
    var pos    = ta.selectionStart;
    var before = ta.value.substring(0, pos);
    var m      = before.match(/(^|[\s\n])>>$/);
    if (!m) { if (st === 'project') cancel(); return; }
    var newStart = pos - 2;
    if (st === 'closed') {
      activeTa = ta; tStart = newStart; tEnd = pos;
      openPanel(ta); showProjects('');
    } else if (st === 'project') {
      tStart = newStart; tEnd = pos;
    }
  }

  function onTaBlur() {
    setTimeout(function () {
      if (st === 'closed') return;
      if (panel && panel.contains(document.activeElement)) return;
      cancel();
    }, 180);
  }

  /* ── Textareas anbinden ──────────────────────────────────────────────────── */
  function bindTa(ta) {
    if (ta._slBound) return;
    ta._slBound = true;
    ta.addEventListener('input', onTaInput);
    ta.addEventListener('blur',  onTaBlur);
  }

  function bindAll(root) {
    var sel = 'textarea.wiki-edit, textarea[id$="_notes"], textarea[id="notes"], textarea[name="notes"]';
    if (root.querySelectorAll) root.querySelectorAll(sel).forEach(bindTa);
    if (root.matches && root.matches(sel)) bindTa(root);
  }

  /* ── AJAX ───────────────────────────────────────────────────────────────── */
  function loadJSON(url, ok, err) {
    fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(ok).catch(err || function () {});
  }

  /* ── Hilfsfunktionen ────────────────────────────────────────────────────── */
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function h(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function enc(s){ return encodeURIComponent(s); }
  function focusSearch() { setTimeout(function () { if (pSearch) pSearch.focus(); }, 0); }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    buildPanel();
    bindAll(document);

    // Projektliste im Hintergrund vorladen (nach 2 s)
    setTimeout(function () {
      if (!cache.projects) {
        loadJSON('/projects.json?limit=100', function (d) { cache.projects = d.projects || []; });
      }
    }, 2000);

    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (node) { if (node.nodeType === 1) bindAll(node); });
      });
    }).observe(document.body, { childList: true, subtree: true });

    var n = 0, t = setInterval(function () { bindAll(document); if (++n >= 5) clearInterval(t); }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
