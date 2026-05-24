/**
 * smart_linker.js — Redmine Sublink: Smart Linker
 *
 * Trigger: >> (nach Leerzeichen oder Zeilenanfang)
 *
 * States: closed → project → subpages → subitems
 *
 * Tab   = Autocomplete (Projekt wählen → >>identifier > ; Subseite wählen → >>identifier > Subseite > ; Item → Text vervollständigen)
 * Enter = Link sofort einfügen
 * Esc   = Abbrechen (entfernt >>...) / Eine Ebene zurück
 * ↑↓    = Navigation in der aktiven Spalte
 * →     = Wechselt in die rechte Spalte (Submenü)
 * ←     = Wechselt zurück in die linke Spalte
 *
 * Alle eingefügten Links sind Standard-Redmine-Textile-Syntax.
 */
(function () {
  'use strict';

  /* ── Konfiguration ──────────────────────────────────────────────────────── */
  var ISSUE_DEBOUNCE = 250;  // ms

  /* ── State ──────────────────────────────────────────────────────────────── */
  var st          = 'closed';  // closed | project | subpages | subitems
  var activeTa    = null;
  var tStart      = -1;        // position of first '>' in >>
  var tEnd        = -1;        // current cursor position
  
  var curProj     = null;      // { id, identifier, name }
  var curSubpage  = null;      // normalized name of active subpage: 'Tickets', 'Wiki', etc.
  
  var selIdx1     = -1;        // selected index in Column 1 (Projects)
  var selIdx2     = -1;        // selected index in Column 2 (Subpages)
  var selIdx3     = -1;        // selected index in Column 3 (Subitems)
  var activeCol   = 1;         // active focused column: 1, 2, or 3
  
  var col1Items   = [];        // active items in Column 1
  var col2Items   = [];        // active items in Column 2
  var col3Items   = [];        // active items in Column 3
  
  var itemsQ      = '';        // current query for Column 3
  var subpageQ    = '';        // current query for Column 2
  var projectQ    = '';        // current query for Column 1
  var issueReqId  = 0;         // stale-request guard
  var mouseX      = -1;
  var mouseY      = -1;
  var mouseTrackActive = false;
  var mouseMustLeaveFirst = false;
  var ignoreInput = false;

  /* ── Aktuelles Projekt aus URL ──────────────────────────────────────────── */
  var urlProjId = (location.pathname.match(/\/projects\/([^\/]+)/) || [])[1] || null;

  /* ── Aktuelle Subseite aus URL ──────────────────────────────────────────── */
  var urlSubpageKey = null;
  (function () {
    var p = location.pathname;
    if (p.indexOf('/issues') !== -1) {
      if (p.indexOf('/calendar') !== -1) urlSubpageKey = 'calendar';
      else if (p.indexOf('/gantt') !== -1) urlSubpageKey = 'gantt';
      else urlSubpageKey = 'issues';
    } else if (p.indexOf('/wiki') !== -1) {
      urlSubpageKey = 'wiki';
    } else if (p.indexOf('/activity') !== -1) {
      urlSubpageKey = 'activity';
    } else if (p.indexOf('/files') !== -1) {
      urlSubpageKey = 'files';
    } else if (p.indexOf('/documents') !== -1) {
      urlSubpageKey = 'documents';
    } else if (p.indexOf('/boards') !== -1) {
      urlSubpageKey = 'boards';
    } else if (p.indexOf('/repository') !== -1) {
      urlSubpageKey = 'repository';
    }
  })();
  var urlSubpage = null;

  /* ── Cache ──────────────────────────────────────────────────────────────── */
  var cache = {
    projects:       null,
    projectDetails: {},   // keyed by project identifier
    members:        {},   // keyed by project identifier
    wiki:           {},   // keyed by project identifier
    attachments:    {},   // keyed by location.pathname
    files:          {},   // keyed by project identifier
    issues:         {}    // keyed by 'projId:query'
  };

  /* ── DOM ────────────────────────────────────────────────────────────────── */
  var panel, pBody, pCol1, pCol2, pCol3, pList1, pList2, pList3;
  var issTimer = null;

  /* ════════════════════════════════════════════════════════════════════════
   * Panel bauen (Drei Spalten für macOS Finder Column View)
   * ════════════════════════════════════════════════════════════════════════ */
  function buildPanel() {
    panel = mk('div', 'sl-panel tribute-container');
    panel.style.cssText = 'display:none;position:fixed;z-index:100000;width:280px;';
    panel.setAttribute('role', 'listbox');

    // Body und Spalten
    pBody = mk('div', 'sl-body');
    
    pCol1 = mk('div', 'sl-col sl-col-1 sl-focused');
    pList1 = mk('ul', 'sl-list');
    pCol1.appendChild(pList1);
    
    pCol2 = mk('div', 'sl-col sl-col-2');
    pCol2.style.display = 'none';
    pList2 = mk('ul', 'sl-list');
    pCol2.appendChild(pList2);

    pCol3 = mk('div', 'sl-col sl-col-3');
    pCol3.style.display = 'none';
    pList3 = mk('ul', 'sl-list');
    pCol3.appendChild(pList3);
    
    pBody.appendChild(pCol1);
    pBody.appendChild(pCol2);
    pBody.appendChild(pCol3);
    panel.appendChild(pBody);

    // Klick außerhalb → schließen
    document.addEventListener('mousedown', function (e) {
      if (st !== 'closed' && !panel.contains(e.target) && e.target !== activeTa) cancel();
    });

    panel.addEventListener('mouseleave', function () {
      mouseMustLeaveFirst = false;
      mouseTrackActive = false;
    });

    panel.addEventListener('mouseenter', function () {
      if (!mouseMustLeaveFirst) {
        mouseTrackActive = true;
      }
    });

    document.body.appendChild(panel);
  }

  function handleGoLeft() {
    if (activeCol === 3) {
      st = 'subpages';
      activeCol = 2;
      selIdx3 = -1;
      applyHL(3);
      focusColumn(2);
      goBackToSubpages();
    } else if (activeCol === 2) {
      st = 'project';
      activeCol = 1;
      selIdx2 = -1;
      applyHL(2);
      focusColumn(1);
      goBackToProject();
    }
  }

  function handleBackAction() {
    if (activeCol === 3 || activeCol === 2) {
      handleGoLeft();
    } else {
      cancel();
    }
  }

  function setPanelWidth() {
    panel.style.width = '280px';
    pCol1.style.display = (activeCol === 1) ? 'block' : 'none';
    pCol2.style.display = (activeCol === 2) ? 'block' : 'none';
    pCol3.style.display = (activeCol === 3) ? 'block' : 'none';
  }

  function focusColumn(colNum) {
    pCol1.classList.toggle('sl-focused', colNum === 1);
    pCol2.classList.toggle('sl-focused', colNum === 2);
    pCol3.classList.toggle('sl-focused', colNum === 3);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Cursor-Positionierung (Mirror-Div-Technik)
   * ════════════════════════════════════════════════════════════════════════ */
  function posPanel(ta) {
    var off = measureCursor(ta);
    var r   = ta.getBoundingClientRect();
    var top  = r.top  + off.top  + off.lineH + 4;
    var left = r.left + off.left;

    var panelW = panel.offsetWidth || 280;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (left < 4) left = 4;

    var dropH = panel.offsetHeight || 320;
    if (top + dropH > window.innerHeight - 8) top = r.top + off.top - dropH - 4;
    if (top < 4) top = 4;

    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  }

  function measureCursor(ta) {
    var cs    = window.getComputedStyle(ta);
    var props = ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
                 'lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft',
                 'borderTopWidth','borderLeftWidth','boxSizing','wordWrap','whiteSpace'];
    var m = document.createElement('div');
    props.forEach(function (p) { m.style[p] = cs[p]; });
    m.style.cssText += ';position:absolute;visibility:hidden;top:-9999px;left:-9999px;' +
                       'width:' + ta.clientWidth + 'px;height:auto;overflow:hidden;white-space:pre-wrap';
    m.textContent = ta.value.substring(0, ta.selectionStart);
    var sp = document.createElement('span');
    sp.textContent = '\u200b';
    m.appendChild(sp);
    document.body.appendChild(m);
    var lh = parseInt(cs.lineHeight) || parseInt(cs.fontSize) + 4;
    var res = {
      left:  sp.offsetLeft - ta.scrollLeft,
      top:   sp.offsetTop  - ta.scrollTop,
      lineH: lh
    };
    document.body.removeChild(m);
    return res;
  }

  /* ── Öffnen / Schließen ── */
  function openPanel(ta) {
    var wasHidden = panel.style.display === 'none';
    activeTa = ta;
    panel.style.display = 'block';
    posPanel(ta);

    if (wasHidden) {
      var r = panel.getBoundingClientRect();
      var isInside = (mouseX >= r.left && mouseX <= r.right && mouseY >= r.top && mouseY <= r.bottom);
      if (isInside) {
        mouseTrackActive = false;
        mouseMustLeaveFirst = true;
      } else {
        mouseTrackActive = false;
        mouseMustLeaveFirst = false;
      }
    }
  }

  function closePanel() {
    panel.style.display = 'none';
    st = 'closed'; curProj = null; curSubpage = null;
    selIdx1 = selIdx2 = selIdx3 = -1; activeCol = 1;
    col1Items = []; col2Items = []; col3Items = [];
    activeTa = null; tStart = tEnd = -1;
    focusColumn(1);
    setPanelWidth(1);
    mouseTrackActive = false;
    mouseMustLeaveFirst = false;
  }

  function cancel() {
    if (activeTa && tStart >= 0) {
      var v   = activeTa.value;
      var end = tEnd >= 0 ? tEnd : tStart + 2;
      if (v.substring(tStart, tStart + 2) === '>>') {
        activeTa.value = v.substring(0, tStart) + v.substring(end);
        activeTa.selectionStart = activeTa.selectionEnd = tStart;
        activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      }
      activeTa.focus();
    }
    closePanel();
  }

  function goBackToProject() {
    if (activeTa && tStart >= 0) {
      var v = activeTa.value;
      var projId = curProj ? curProj.identifier : '';
      var repl = '>>' + projId;
      activeTa.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      activeTa.selectionStart = activeTa.selectionEnd = tEnd;
      activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      activeTa.focus();
    }
  }

  function goBackToSubpages() {
    if (activeTa && tStart >= 0 && curProj) {
      var v = activeTa.value;
      var sub = curSubpage ? getSubpageLabel(curSubpage) : '';
      var repl = '>>' + curProj.identifier + '>' + sub;
      activeTa.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      activeTa.selectionStart = activeTa.selectionEnd = tEnd;
      activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      activeTa.focus();
    }
  }

  function updateTextareaFromSelection() {
    if (!activeTa || tStart < 0) return;
    
    var repl = '';
    if (activeCol === 1) {
      var item = col1Items[selIdx1];
      if (item && item.project) {
        repl = '>>' + item.project.identifier;
      } else {
        return;
      }
    } else if (activeCol === 2) {
      var item = col2Items[selIdx2];
      if (item && curProj) {
        repl = '>>' + curProj.identifier + '>' + item.label;
      } else {
        return;
      }
    } else if (activeCol === 3) {
      var item = col3Items[selIdx3];
      if (item && curProj && curSubpage) {
        var txt = item.autotext || item.label || '';
        repl = '>>' + curProj.identifier + '>' + getSubpageLabel(curSubpage) + '>' + txt;
      } else {
        return;
      }
    }
    
    if (repl) {
      var v = activeTa.value;
      ignoreInput = true;
      activeTa.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      activeTa.selectionStart = activeTa.selectionEnd = tEnd;
      activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      ignoreInput = false;
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Text nach >> parsen (Pfad-Handling)
   * ════════════════════════════════════════════════════════════════════════ */
  function parseAfter(raw) {
    var text = raw.replace(/^\s+/, ''); // führende Leerzeichen entfernen
    if (!text) return { level: 'project', query: '' };

    var parts = text.split(/\s*>\s*/);
    
    if (parts.length === 1) {
      var potId = parts[0];
      var isTransitioned = raw.slice(-1) === '>' || raw.slice(-1) === ' ';
      if (isTransitioned && cache.projects && cache.projects.some(function (p) { return p.identifier === potId; })) {
        return { level: 'subpages', projId: potId, query: '' };
      }
      return { level: 'project', query: potId };
    }

    var projId = parts[0];
    var subpageName = parts[1] || '';

    if (parts.length === 2) {
      var isTransitioned = raw.slice(-1) === '>' || raw.slice(-1) === ' ';
      if (isTransitioned && isValidSubpage(subpageName) && hasSubitems(subpageName)) {
        return { level: 'subitems', projId: projId, subpage: subpageName, query: '' };
      }
      return { level: 'subpages', projId: projId, query: subpageName };
    }

    var subpage = parts[1];
    var subitemQuery = parts[2] || '';
    return { level: 'subitems', projId: projId, subpage: subpage, query: subitemQuery };
  }

  function getSubpageLabel(name) {
    if (!name) return '';
    for (var i = 0; i < ALL_SUBPAGES.length; i++) {
      if (ALL_SUBPAGES[i].name === name) {
        return ALL_SUBPAGES[i].label;
      }
    }
    return name;
  }

  function findSubpageNormalized(subpageName) {
    if (!subpageName) return null;
    var s = subpageName.toLowerCase().trim();
    if (subpageLookup[s]) {
      return subpageLookup[s];
    }
    // Fallbacks for extra robustness or specific module keys
    if (s === 'issue_tracking') return 'issues';
    if (s === 'mitgliederliste') return 'members';
    if (s === 'anhange' || s === 'anhang') return 'attachments';
    if (s === 'ubersicht') return 'overview';
    if (s === 'aktivitat') return 'activity';
    if (s === 'repo') return 'repository';
    return null;
  }

  function isValidSubpage(subpageName) {
    return findSubpageNormalized(subpageName) !== null;
  }

  function hasSubitems(subpageName) {
    var norm = findSubpageNormalized(subpageName);
    return norm === 'issues' || norm === 'wiki' || norm === 'members' || norm === 'attachments' || norm === 'files';
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 1 — Projekte
   * ════════════════════════════════════════════════════════════════════════ */
  function renderProjectsList(q) {
    curProj = null;

    if (!cache.projects) {
      renderColumn(1, [{ label: 'Lade Projekte…', disabled: true }], -1, true);
      loadJSON('/projects.json?limit=100', function (d) {
        cache.projects = d.projects || [];
        renderProjectsList(q);
      }, function () {
        renderColumn(1, [{ label: 'Fehler beim Laden', disabled: true }], -1, true);
      });
      return;
    }

    var lq = q.toLowerCase().trim();

    // 1. Build a map of all projects for fast lookup
    var projMap = {};
    if (cache.projects) {
      cache.projects.forEach(function (p) {
        if (p && p.id) {
          projMap[p.id] = p;
        }
      });
    }
    
    // Check if there is an exact project match for the query
    var exactProj = null;
    if (cache.projects && lq) {
      cache.projects.forEach(function (p) {
        var pid = (p.identifier || '').toLowerCase();
        var pname = (p.name || '').toLowerCase();
        if (pid === lq || pname === lq) {
          exactProj = p;
        }
      });
    }

    // 2. Determine matches based on query
    var matches = [];
    if (q && !exactProj) {
      matches = cache.projects.filter(function (p) {
        var pid = (p.identifier || '').toLowerCase();
        var pname = (p.name || '').toLowerCase();
        return pname.indexOf(lq) !== -1 || pid.indexOf(lq) !== -1;
      });
    } else {
      matches = cache.projects.slice();
    }

    // 3. For all matches, gather themselves and all their ancestors
    var resultSet = {}; // keyed by project.id to prevent duplicates
    matches.forEach(function (p) {
      resultSet[p.id] = { project: p, isMatch: true };
      
      var cur = p;
      while (cur && cur.parent) {
        var parentId = cur.parent.id;
        var parentProj = projMap[parentId];
        if (parentProj) {
          if (!resultSet[parentId]) {
            resultSet[parentId] = { project: parentProj, isMatch: false };
          }
          cur = parentProj;
        } else {
          break;
        }
      }
    });

    // 4. Convert resultSet back to an array
    var resultList = [];
    for (var id in resultSet) {
      if (resultSet.hasOwnProperty(id)) {
        resultList.push(resultSet[id]);
      }
    }

    // 5. Build tree relationships & calculate depths
    var childrenMap = {}; // parentId -> array of child projects
    var roots = [];
    var resultIds = resultList.map(function (item) { return item.project.id; });

    resultList.forEach(function (item) {
      var p = item.project;
      p.depth = getProjectDepth(p, cache.projects);
      p.isMatch = item.isMatch;
      
      var hasParentInResults = p.parent && resultIds.indexOf(p.parent.id) !== -1;
      if (hasParentInResults) {
        var parentId = p.parent.id;
        if (!childrenMap[parentId]) childrenMap[parentId] = [];
        childrenMap[parentId].push(p);
      } else {
        roots.push(p);
      }
    });

    // 6. Sort roots and branches, ensuring urlProjId branch is bubbled to the top
    roots.sort(function (a, b) {
      var aHasUrlProj = containsProject(a, urlProjId, childrenMap);
      var bHasUrlProj = containsProject(b, urlProjId, childrenMap);
      if (aHasUrlProj && !bHasUrlProj) return -1;
      if (!aHasUrlProj && bHasUrlProj) return 1;
      return a.name.localeCompare(b.name);
    });

    var orderedList = [];
    function traverse(node) {
      orderedList.push(node);
      var children = childrenMap[node.id] || [];
      children.sort(function (a, b) {
        var aHasUrlProj = containsProject(a, urlProjId, childrenMap);
        var bHasUrlProj = containsProject(b, urlProjId, childrenMap);
        if (aHasUrlProj && !bHasUrlProj) return -1;
        if (!aHasUrlProj && bHasUrlProj) return 1;
        return a.name.localeCompare(b.name);
      });
      children.forEach(traverse);
    }
    roots.forEach(traverse);

    // 7. Map ordered list to items with hierarchy styles
    var matchedIdx = -1;
    var items = orderedList.length
      ? orderedList.map(function (p, idx) {
          var indent = p.depth * 16;
          var paddingLeftVal = indent + 12;
          var style = 'padding-left: ' + paddingLeftVal + 'px;';
          if (!p.isMatch) {
            style += ' opacity: 0.55; font-weight: 300; font-style: italic;';
          }
          if (q) {
            var pid = (p.identifier || '').toLowerCase();
            var pname = (p.name || '').toLowerCase();
            if (pid === lq || pname === lq) {
              matchedIdx = idx;
            }
          }
          return {
            icon:     p.identifier === urlProjId ? 'checked' : 'folder',
            label:    p.name,
            sub:      p.identifier,
            project:  p,
            style:    style
          };
        })
      : [{ label: 'Kein Projekt gefunden', disabled: true }];

    selIdx1 = matchedIdx !== -1 ? matchedIdx : findFirstSelectable(items, 1);
    renderColumn(1, items, selIdx1, true);

    if (selIdx1 !== -1) {
      updateCol2AndCol3(selIdx1);
    } else {
      setPanelWidth(1);
    }
  }

  function getProjectDepth(p, projectsList) {
    var depth = 0;
    var cur = p;
    while (cur && cur.parent) {
      depth++;
      var parentId = cur.parent.id;
      cur = projectsList.filter(function (x) { return x.id === parentId; })[0];
    }
    return depth;
  }

  function containsProject(node, targetId, childrenMap) {
    if (!targetId) return false;
    if (node.identifier === targetId) return true;
    var children = childrenMap[node.id] || [];
    for (var i = 0; i < children.length; i++) {
      if (containsProject(children[i], targetId, childrenMap)) return true;
    }
    return false;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 2 — Haupt-Unterseiten
   * ════════════════════════════════════════════════════════════════════════ */
  var ALL_SUBPAGES = [
    { name: 'overview', label: 'Overview', icon: 'folder', module: null, link_pattern: 'project:{pid}' },
    { name: 'activity', label: 'Activity', icon: 'history', module: null, link_pattern: '"Activity":/projects/{pid}/activity' },
    { name: 'issues', label: 'Issues', icon: 'issue', module: 'issue_tracking', link_pattern: '"Issues":/projects/{pid}/issues', has_sub: true },
    { name: 'wiki', label: 'Wiki', icon: 'wiki-page', module: 'wiki', link_pattern: '"Wiki":/projects/{pid}/wiki', has_sub: true },
    { name: 'members', label: 'Members', icon: 'group', module: null, link_pattern: '"Members":/projects/{pid}', has_sub: true },
    { name: 'attachments', label: 'Attachments', icon: 'attachment', module: null, link_pattern: null, has_sub: true },
    { name: 'files', label: 'Files', icon: 'file', module: 'files', link_pattern: '"Files":/projects/{pid}/files', has_sub: true },
    { name: 'documents', label: 'Documents', icon: 'document', module: 'documents', link_pattern: '"Documents":/projects/{pid}/documents' },
    { name: 'boards', label: 'Boards', icon: 'comments', module: 'boards', link_pattern: '"Boards":/projects/{pid}/boards' },
    { name: 'repository', label: 'Repository', icon: 'package', module: 'repository', link_pattern: '"Repository":/projects/{pid}/repository' },
    { name: 'calendar', label: 'Calendar', icon: 'time', module: 'calendar', link_pattern: '"Calendar":/projects/{pid}/issues/calendar' },
    { name: 'gantt', label: 'Gantt', icon: 'stats', module: 'gantt', link_pattern: '"Gantt":/projects/{pid}/issues/gantt' }
  ];

  function getProjectSubpages(pid, cb) {
    loadProjectDetails(pid, function (details) {
      if (!details || !details.modules) {
        cb(ALL_SUBPAGES);
        return;
      }
      var enabledMods = details.modules;
      var filtered = ALL_SUBPAGES.filter(function (sp) {
        if (sp.module) {
          if (sp.module === 'calendar' && !enabledMods.includes('calendar')) {
            return enabledMods.includes('issue_tracking');
          }
          if (sp.module === 'gantt' && !enabledMods.includes('gantt')) {
            return enabledMods.includes('issue_tracking');
          }
          return enabledMods.includes(sp.module);
        }
        return true;
      });

      var seen = {};
      var uniqueFiltered = filtered.filter(function (sp) {
        var lbl = (sp.label || '').toLowerCase().trim();
        if (seen[lbl]) {
          return false;
        }
        seen[lbl] = true;
        return true;
      });
      cb(uniqueFiltered);
    });
  }

  function resolveProjectAndRenderSubpages(projId, q) {
    if (!cache.projects) {
      renderColumn(1, [{ label: 'Lade Projekte…', disabled: true }], -1, false);
      loadJSON('/projects.json?limit=100', function (d) {
        cache.projects = d.projects || [];
        resolveProjectAndRenderSubpages(projId, q);
      }, function () {
        renderColumn(1, [{ label: 'Fehler beim Laden', disabled: true }], -1, false);
      });
      return;
    }

    var proj = cache.projects.filter(function (p) {
      return p.identifier === projId;
    })[0];

    if (!proj) {
      st = 'project';
      renderProjectsList(projId);
      return;
    }

    curProj = proj;

    // Highlight that project in Column 1
    var matchedIdx = -1;
    var col1ItemsLocal = cache.projects.map(function (p, idx) {
      if (p.identifier === projId) matchedIdx = idx;
      return {
        icon:     p.identifier === urlProjId ? 'checked' : 'folder',
        label:    p.name,
        sub:      p.identifier,
        project:  p
      };
    });
    selIdx1 = matchedIdx !== -1 ? matchedIdx : 0;
    renderColumn(1, col1ItemsLocal, selIdx1, false);

    // Get subpages for this project
    getProjectSubpages(projId, function (subpages) {
      var lq = q.toLowerCase().trim();
      
      // Check if there is an exact match for the query
      var exactMatch = null;
      if (lq) {
        subpages.forEach(function (sp) {
          if ((sp.name || '').toLowerCase() === lq || (sp.label || '').toLowerCase() === lq) exactMatch = sp;
        });
      }

      var filtered = (q && !exactMatch)
        ? subpages.filter(function (sp) {
            return (sp.name || '').toLowerCase().indexOf(lq) !== -1 || (sp.label || '').toLowerCase().indexOf(lq) !== -1;
          })
        : subpages;

      var matchedSubpageIdx = -1;
      var items = filtered.map(function (sp, idx) {
        var linkText = '';
        if (sp.name === 'overview') {
          linkText = 'project:' + projId;
        } else if (sp.link_pattern) {
          var path = sp.link_pattern;
          if (path.indexOf(':/') !== -1) {
            path = path.substring(path.indexOf(':/') + 1);
          }
          path = path.replace('{pid}', projId);
          linkText = formatLink(sp.label, path);
        }
        if (q && ((sp.name || '').toLowerCase() === lq || (sp.label || '').toLowerCase() === lq)) {
          matchedSubpageIdx = idx;
        }
        return {
          icon:       sp.icon,
          label:      sp.label,
          sub:        linkText,
          link:       linkText,
          hasSubmenu: sp.has_sub
        };
      });

      if (!items.length) {
        items = [{ label: 'Keine passenden Unterseiten', disabled: true }];
      }
      selIdx2 = matchedSubpageIdx !== -1 ? matchedSubpageIdx : findFirstSelectable(items, 2);

      activeCol = 2;
      setPanelWidth(2);
      renderColumn(2, items, selIdx2, true);

      // Cascade load Column 3
      if (selIdx2 !== -1) {
        updateCol3(selIdx2);
      } else {
        setPanelWidth(2);
        col3Items = [];
        selIdx3 = -1;
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 3 — Unterelemente (Issues, Wiki-Pages, Members, Attachments)
   * ════════════════════════════════════════════════════════════════════════ */
  function resolveProjectAndSubpageAndRenderSubitems(projId, subpageName, q) {
    itemsQ = q;

    if (!cache.projects) {
      renderColumn(1, [{ label: 'Lade Projekte…', disabled: true }], -1, false);
      loadJSON('/projects.json?limit=100', function (d) {
        cache.projects = d.projects || [];
        resolveProjectAndSubpageAndRenderSubitems(projId, subpageName, q);
      }, function () {
        renderColumn(1, [{ label: 'Fehler beim Laden', disabled: true }], -1, false);
      });
      return;
    }

    var proj = cache.projects.filter(function (p) {
      return p.identifier === projId;
    })[0];

    if (!proj) {
      st = 'project';
      renderProjectsList(projId);
      return;
    }

    curProj = proj;

    // Highlight that project in Column 1
    var matchedProjIdx = -1;
    var col1ItemsLocal = cache.projects.map(function (p, idx) {
      if (p.identifier === projId) matchedProjIdx = idx;
      return {
        icon:     p.identifier === urlProjId ? 'checked' : 'folder',
        label:    p.name,
        sub:      p.identifier,
        project:  p
      };
    });
    selIdx1 = matchedProjIdx !== -1 ? matchedProjIdx : 0;
    renderColumn(1, col1ItemsLocal, selIdx1, false);

    // Get subpages and select the correct one
    getProjectSubpages(projId, function (subpages) {
      var normalizedTarget = findSubpageNormalized(subpageName);
      if (!normalizedTarget) {
        st = 'subpages';
        resolveProjectAndRenderSubpages(projId, subpageName);
        return;
      }

      curSubpage = normalizedTarget;

      var matchedSubpageIdx = -1;
      var items = subpages.map(function (sp, idx) {
        var isMatch = findSubpageNormalized(sp.name) === normalizedTarget;
        if (isMatch) matchedSubpageIdx = idx;
        var subText = '';
        if (sp.name === 'overview') {
          subText = 'project:' + projId;
        } else if (sp.link_pattern) {
          var path = sp.link_pattern;
          if (path.indexOf(':/') !== -1) {
            path = path.substring(path.indexOf(':/') + 1);
          }
          path = path.replace('{pid}', projId);
          subText = formatLink(sp.label, path);
        }
        return {
          icon:       sp.icon,
          label:      sp.label,
          sub:        subText,
          hasSubmenu: sp.has_sub
        };
      });

      selIdx2 = matchedSubpageIdx !== -1 ? matchedSubpageIdx : 0;
      renderColumn(2, items, selIdx2, false);

      activeCol = 3;
      setPanelWidth(3);

      loadSubitems(curSubpage, q, function (subitems) {
        selIdx3 = findFirstSelectable(subitems, 3);
        renderColumn(3, subitems, selIdx3, true);
      });
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Cascading Updates (macOS Finder-Style)
   * ════════════════════════════════════════════════════════════════════════ */
  function updateCol2AndCol3(projIdx) {
    var item = col1Items[projIdx];
    if (!item || !item.project) return;
    
    var projId = item.project.identifier;
    
    getProjectSubpages(projId, function (subpages) {
      // Render in Column 2 (not focused)
      var items = subpages.map(function (sp) {
        var linkText = '';
        if (sp.name === 'overview') {
          linkText = 'project:' + projId;
        } else if (sp.link_pattern) {
          var path = sp.link_pattern;
          if (path.indexOf(':/') !== -1) {
            path = path.substring(path.indexOf(':/') + 1);
          }
          path = path.replace('{pid}', projId);
          linkText = formatLink(sp.label, path);
        }
        return {
          icon:       sp.icon,
          label:      sp.label,
          sub:        linkText,
          link:       linkText,
          hasSubmenu: sp.has_sub
        };
      });
      
      selIdx2 = findFirstSelectable(items, 2);
      renderColumn(2, items, selIdx2, activeCol === 2);
      
      // Cascade to Column 3
      if (selIdx2 !== -1) {
        updateCol3(selIdx2);
      } else {
        setPanelWidth(2);
        col3Items = [];
        selIdx3 = -1;
      }
    });
  }

  function updateCol3(subpageIdx) {
    var item = col2Items[subpageIdx];
    if (!item || item.section || item.disabled) return;

    if (item.hasSubmenu) {
      setPanelWidth(3);
      var subpageName = item.label;

      loadSubitems(subpageName, itemsQ, function (subitems) {
        if (selIdx2 !== subpageIdx) return;
        
        selIdx3 = findFirstSelectable(subitems, 3);
        renderColumn(3, subitems, selIdx3, activeCol === 3);
      });
    } else {
      setPanelWidth(2);
      col3Items = [];
      selIdx3 = -1;
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Daten laden und formatieren
   * ════════════════════════════════════════════════════════════════════════ */
  function loadProjectDetails(pid, cb) {
    if (cache.projectDetails[pid]) {
      cb(cache.projectDetails[pid]);
      return;
    }
    loadJSON('/projects/' + pid + '.json?include=enabled_modules', function (d) {
      if (d && d.project) {
        var mods = (d.project.enabled_modules || []).map(function (m) { return m.name; });
        cache.projectDetails[pid] = {
          name: d.project.name,
          modules: mods
        };
        cb(cache.projectDetails[pid]);
      } else {
        cb(null);
      }
    }, function () {
      cb(null);
    });
  }

  function loadSubitems(subpageName, q, cb) {
    var pid = curProj ? curProj.identifier : urlProjId;
    if (!pid) { cb([]); return; }
    
    var normalized = findSubpageNormalized(subpageName);

    if (normalized === 'issues') {
      if (!cache.issues) cache.issues = {};
      var issKey = pid + ':' + q;
      if (cache.issues[issKey] !== undefined) {
        cb(formatIssues(cache.issues[issKey]));
      } else {
        clearTimeout(issTimer);
        issTimer = setTimeout(function () {
          fetchIssues(q, pid, ++issueReqId, function (issues) {
            cb(formatIssues(issues));
          });
        }, q ? ISSUE_DEBOUNCE : 0);
      }
    } else if (normalized === 'wiki') {
      if (!cache.wiki[pid]) {
        loadWiki(pid, function () {
          cb(filterAndFormatWiki(cache.wiki[pid], q));
        });
      } else {
        cb(filterAndFormatWiki(cache.wiki[pid], q));
      }
    } else if (normalized === 'members') {
      if (!cache.members[pid]) {
        loadMembers(pid, function () {
          cb(filterAndFormatMembers(cache.members[pid], q));
        });
      } else {
        cb(filterAndFormatMembers(cache.members[pid], q));
      }
    } else if (normalized === 'attachments') {
      if (!cache.attachments[location.pathname]) {
        loadAttachments(function () {
          cb(filterAndFormatAttachments(cache.attachments[location.pathname], q));
        });
      } else {
        cb(filterAndFormatAttachments(cache.attachments[location.pathname], q));
      }
    } else if (normalized === 'files') {
      if (!cache.files) cache.files = {};
      if (!cache.files[pid]) {
        loadFiles(pid, function () {
          cb(filterAndFormatFiles(cache.files[pid], q));
        });
      } else {
        cb(filterAndFormatFiles(cache.files[pid], q));
      }
    } else {
      cb([]);
    }
  }

  function fetchIssues(q, pid, reqId, cb) {
    var stripped = q.replace(/^#/, '').trim();
    var url = '/issues.json?project_id=' + enc(pid) + '&limit=10';
    if (/^\d+$/.test(stripped))  url += '&issue_id=' + stripped;
    else if (stripped)           url += '&status_id=*&subject=~' + enc(stripped);
    else                         url += '&status_id=open&sort=updated_on:desc';

    loadJSON(url, function (d) {
      var issues = d.issues || [];
      cache.issues[pid + ':' + q] = issues;
      if (reqId === issueReqId) cb(issues);
    }, function () {
      cache.issues[pid + ':' + q] = [];
      if (reqId === issueReqId) cb([]);
    });
  }

  function formatIssues(issuesList) {
    var pid = curProj ? curProj.identifier : urlProjId;
    if (!issuesList || issuesList.length === 0) {
      return [{ label: 'Keine Tickets gefunden', disabled: true }];
    }
    return issuesList.slice(0, 10).map(function (i) {
      var displayShort = '#' + i.id;
      var insertLink = '#' + i.id;
      return {
        icon:     'issue',
        label:    displayShort + ': ' + i.subject,
        sub:      i.status ? i.status.name : '',
        autotext: '#' + i.id + ' ' + i.subject,
        link:     insertLink
      };
    });
  }

  function filterAndFormatWiki(pages, q) {
    var pid = curProj ? curProj.identifier : urlProjId;
    var lq = q.toLowerCase().trim();
    var filtered = pages.filter(function (p) {
      return !lq || (p.title || '').toLowerCase().indexOf(lq) !== -1;
    });
    if (filtered.length === 0) {
      return [{ label: 'Keine Wiki-Seiten', disabled: true }];
    }
    return filtered.slice(0, 10).map(function (p) {
      var link = pid === urlProjId ? '[[' + p.title + ']]' : '[[' + pid + ':' + p.title + ']]';
      return { icon: 'wiki-page', label: p.title, sub: link, autotext: p.title, link: link };
    });
  }

  function filterAndFormatMembers(members, q) {
    var lq = q.toLowerCase().trim();
    var filtered = members.filter(function (m) {
      return !lq || (m.name || '').toLowerCase().indexOf(lq) !== -1 || (m.login || '').toLowerCase().indexOf(lq) !== -1;
    });
    if (filtered.length === 0) {
      return [{ label: 'Keine Mitglieder', disabled: true }];
    }
    return filtered.slice(0, 10).map(function (m) {
      var nameLower = (m.name || '').toLowerCase();
      var mention = m.login || nameLower.replace(/\s+/g, '.');
      return { icon: 'user', label: m.name, sub: '@' + mention, autotext: '@' + mention, link: '@' + mention };
    });
  }

  function filterAndFormatAttachments(attachs, q) {
    var lq = q.toLowerCase().trim();
    var filtered = attachs.filter(function (a) {
      return !lq || (a.filename || '').toLowerCase().indexOf(lq) !== -1;
    });
    if (filtered.length === 0) {
      return [{ label: 'Keine Anhänge', disabled: true }];
    }
    return filtered.slice(0, 10).map(function (a) {
      var isImg = /^image\//i.test(a.content_type || '');
      var link = '';
      if (isImg) {
        if (isMarkdownEditor()) {
          link = '![](attachment:' + a.filename + ')';
        } else {
          link = '!attachment:' + a.filename + '!';
        }
      } else {
        link = 'attachment:' + a.filename;
      }
      return { icon: isImg ? 'image-png' : 'attachment', label: a.filename, sub: link, autotext: a.filename, link: link };
    });
  }

  function loadMembers(pid, cb) {
    var projIdForMembers = curProj ? curProj.id : null;
    if (!projIdForMembers && cache.projects) {
      var matched = cache.projects.filter(function (p) { return p.identifier === pid; })[0];
      if (matched) projIdForMembers = matched.id;
    }
    if (!projIdForMembers) { cb(); return; }

    loadJSON('/users/auto_complete.json?term=&project_id=' + projIdForMembers,
      function (data) {
        cache.members[pid] = (Array.isArray(data) ? data : []).map(function (u) {
          return { id: u.id, name: u.value || u.name || '', login: u.login || '' };
        });
        cb();
      },
      function () {
        loadJSON('/projects/' + pid + '/memberships.json?limit=100',
          function (d) {
            cache.members[pid] = (d.memberships || []).filter(function (m) { return m.user; })
              .map(function (m) { return { id: m.user.id, name: m.user.name, login: '' }; });
            cb();
          },
          function () { cache.members[pid] = []; cb(); }
        );
      }
    );
  }

  function loadWiki(pid, cb) {
    loadJSON('/projects/' + pid + '/wiki/index.json',
      function (d) { cache.wiki[pid] = d.wiki_pages || []; cb(); },
      function ()   { cache.wiki[pid] = [];               cb(); }
    );
  }

  function loadAttachments(cb) {
    var key = location.pathname;
    var m;
    m = location.pathname.match(/\/issues\/(\d+)/);
    if (m) {
      loadJSON('/issues/' + m[1] + '.json?include=attachments',
        function (d) { cache.attachments[key] = (d.issue && d.issue.attachments) || []; cb(); },
        function ()   { cache.attachments[key] = []; cb(); }
      );
      return;
    }
    m = location.pathname.match(/\/projects\/([^\/]+)\/wiki\/([^\/\?]+)/);
    if (m) {
      loadJSON('/projects/' + m[1] + '/wiki/' + m[2] + '.json',
        function (d) { cache.attachments[key] = (d.wiki_page && d.wiki_page.attachments) || []; cb(); },
        function ()   { cache.attachments[key] = []; cb(); }
      );
      return;
    }
    cache.attachments[key] = [];
    cb();
  }

  function loadFiles(pid, cb) {
    loadJSON('/projects/' + pid + '/files.json',
      function (d) { cache.files[pid] = d.files || []; cb(); },
      function ()   { cache.files[pid] = [];            cb(); }
    );
  }

  function filterAndFormatFiles(filesList, q) {
    var lq = q.toLowerCase().trim();
    var filtered = filesList.filter(function (f) {
      return !lq || (f.filename || '').toLowerCase().indexOf(lq) !== -1;
    });
    if (filtered.length === 0) {
      return [{ label: 'Keine Dateien', disabled: true }];
    }
    return filtered.slice(0, 10).map(function (f) {
      var isImg = /^image\//i.test(f.content_type || '');
      var link = '';
      if (isImg) {
        if (isMarkdownEditor()) {
          link = '![](attachment:' + f.filename + ')';
        } else {
          link = '!attachment:' + f.filename + '!';
        }
      } else {
        link = 'attachment:' + f.filename;
      }
      return { icon: isImg ? 'image-png' : 'attachment', label: f.filename, sub: link, autotext: f.filename, link: link };
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Spalten rendern
   * ════════════════════════════════════════════════════════════════════════ */
  function renderColumn(colNum, items, selIdx, focused) {
    var pList = colNum === 1 ? pList1 : (colNum === 2 ? pList2 : pList3);
    var pCol  = colNum === 1 ? pCol1 : (colNum === 2 ? pCol2 : pCol3);

    pCol.className = 'sl-col sl-col-' + colNum + (focused ? ' sl-focused' : '');

    if (colNum === 1) col1Items = items;
    else if (colNum === 2) col2Items = items;
    else col3Items = items;

    pList.innerHTML = (items || []).map(function (item, i) {
      if (item.section)  return '<li class="sl-section">'  + h(item.label) + '</li>';
      if (item.disabled) return '<li class="sl-disabled">' + h(item.label) + '</li>';

      var classes = [];
      if (i === selIdx) classes.push('highlight');
      if (item.hasSubmenu) classes.push('sl-has-submenu');

      var classStr = classes.length ? ' class="' + classes.join(' ') + '"' : '';
      var styleStr = item.style ? ' style="' + item.style + '"' : '';

      var iconHtml = item.icon ? getIconHtml(item.icon) : '<span class="sl-icon"></span>';

      return '<li data-idx="' + i + '"' + classStr + styleStr + ' role="option">' +
             iconHtml +
             '<span class="sl-label">' + h(item.label || '') + '</span>' +
             (item.sub ? '<span class="sl-sub">' + h(item.sub) + '</span>' : '') +
             '</li>';
    }).join('');

    pList.querySelectorAll('li[data-idx]').forEach(function (li) {
      li.addEventListener('mouseenter', function () {
        if (!mouseTrackActive) return;

        var idx = parseInt(li.dataset.idx, 10);
        activeCol = colNum;
        focusColumn(colNum);

        if (colNum === 1) {
          selIdx1 = idx;
          applyHL(1);
          updateCol2AndCol3(selIdx1);
        } else if (colNum === 2) {
          selIdx2 = idx;
          applyHL(2);
          updateCol3(selIdx2);
        } else {
          selIdx3 = idx;
          applyHL(3);
        }
      });

      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var idx = parseInt(li.dataset.idx, 10);
        if (colNum === 1) {
          selIdx1 = idx;
          applyHL(1);
          handleEnter1();
        } else if (colNum === 2) {
          selIdx2 = idx;
          applyHL(2);
          handleEnter2();
        } else {
          selIdx3 = idx;
          applyHL(3);
          handleEnter3();
        }
      });
    });

    // Auto-highlight single selectable options
    var selectableLis = pList.querySelectorAll('li[data-idx]');
    if (selectableLis.length === 1 && focused) {
      var onlyIdx = parseInt(selectableLis[0].dataset.idx, 10);
      if (colNum === 1) selIdx1 = onlyIdx;
      else if (colNum === 2) selIdx2 = onlyIdx;
      else selIdx3 = onlyIdx;
    }

    // Scroll selected item into view and apply highlight styles
    var activeSelIdx = colNum === 1 ? selIdx1 : (colNum === 2 ? selIdx2 : selIdx3);
    if (activeSelIdx !== -1) {
      applyHL(colNum);
    }

    if (activeTa) posPanel(activeTa);
  }

  function applyHL(colNum) {
    var pList = colNum === 1 ? pList1 : (colNum === 2 ? pList2 : pList3);
    var selIdx = colNum === 1 ? selIdx1 : (colNum === 2 ? selIdx2 : selIdx3);

    var lis = pList.querySelectorAll('li[data-idx]');
    lis.forEach(function (li, i) {
      li.classList.toggle('highlight', i === selIdx);
      li.setAttribute('aria-selected', String(i === selIdx));
    });
    if (lis[selIdx]) lis[selIdx].scrollIntoView({ block: 'nearest' });
  }

  function getSelectedItem(colNum) {
    var items = colNum === 1 ? col1Items : (colNum === 2 ? col2Items : col3Items);
    var selIdx = colNum === 1 ? selIdx1 : (colNum === 2 ? selIdx2 : selIdx3);
    var pList = colNum === 1 ? pList1 : (colNum === 2 ? pList2 : pList3);

    var lis = pList.querySelectorAll('li[data-idx]');
    var li  = selIdx >= 0
      ? lis[selIdx]
      : lis.length === 1 ? lis[0] : null;
    if (!li) return null;
    return items[parseInt(li.dataset.idx, 10)] || null;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Tab & Enter — Aktionen
   * ════════════════════════════════════════════════════════════════════════ */
  function handleTab1() {
    var item = getSelectedItem(1);
    if (!item || item.section || item.disabled) return;

    var ta = activeTa;
    var v  = ta.value;

    if (st === 'project') {
      var proj = item.project;
      if (!proj) return;
      curProj = proj;
      st = 'subpages';

      var repl = '>>' + proj.identifier + '>';
      ta.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
    }
  }

  function handleTab2() {
    var item = getSelectedItem(2);
    if (!item || item.section || item.disabled) return;

    var ta = activeTa;
    var v  = ta.value;

    if (st === 'subpages') {
      if (!item.hasSubmenu) {
        var repl = '>>' + curProj.identifier + '>' + item.label;
        ta.value = v.substring(0, tStart) + repl + v.substring(tEnd);
        tEnd = tStart + repl.length;
        ta.selectionStart = ta.selectionEnd = tEnd;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
        return;
      }

      st = 'subitems';
      activeCol = 3;

      var repl = '>>' + curProj.identifier + '>' + item.label + '>';
      ta.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
    }
  }

  function handleTab3() {
    var item = getSelectedItem(3);
    if (!item || item.section || item.disabled) return;

    var ta = activeTa;
    var v  = ta.value;

    var txt = item.autotext || item.label;
    if (txt) {
      var subpageLabel = curSubpage ? getSubpageLabel(curSubpage) : '';
      var repl = '>>' + curProj.identifier + '>' + subpageLabel + '>' + txt;
      ta.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
    }
  }

  function handleEnter1() {
    handleTab1(); // Auf Projektebene: Enter = Tab (ins nächste Menü gehen)
  }

  function handleEnter2() {
    var item = getSelectedItem(2);
    if (!item || item.section || item.disabled) return;

    var linkToInsert = item.link || item.autotext || item.label;
    if (linkToInsert) {
      doInsert(linkToInsert);
    } else if (item.hasSubmenu) {
      handleTab2();
    }
  }

  function handleEnter3() {
    var item = getSelectedItem(3);
    if (!item || item.section || item.disabled) return;

    var linkToInsert = item.link || item.autotext || item.label;
    if (linkToInsert) {
      doInsert(linkToInsert);
    }
  }

  function doInsert(linkText) {
    if (!activeTa || tStart < 0) { closePanel(); return; }
    var v   = activeTa.value;
    var end = tEnd >= 0 ? tEnd : tStart + 2;
    activeTa.value = v.substring(0, tStart) + linkText + v.substring(end);
    var np = tStart + linkText.length;
    activeTa.selectionStart = activeTa.selectionEnd = np;
    activeTa.dispatchEvent(new Event('input', { bubbles: true }));
    activeTa.focus();
    closePanel();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Input & Keydown Listeners
   * ════════════════════════════════════════════════════════════════════════ */
  function onTaInput(e) {
    if (ignoreInput) return;
    var ta     = e.target;
    var pos    = ta.selectionStart;
    var before = ta.value.substring(0, pos);
    var m      = before.match(/(^|[\s\n])>>([^\n]*)$/);

    if (!m) {
      if (st !== 'closed') closePanel();
      return;
    }

    tStart = pos - m[0].length + m[1].length;
    tEnd   = pos;

    var isInitialOpen = (panel.style.display === 'none');
    if (panel.style.display === 'none') openPanel(ta);
    else posPanel(ta);

    var queryText = m[2];
    if (isInitialOpen && !queryText && urlProjId) {
      var prefill = urlProjId;
      if (urlSubpage) {
        prefill += '>' + urlSubpage;
        if (hasSubitems(urlSubpage)) {
          prefill += '>';
        }
      } else {
        prefill += '>';
      }

      var newText = '>>' + prefill;
      ta.value = before.substring(0, tStart) + newText + ta.value.substring(tEnd);
      tEnd = tStart + newText.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      queryText = prefill;
    }

    var parsed = parseAfter(queryText);

    if (parsed.level === 'project') {
      st = 'project';
      curProj = null;
      curSubpage = null;
      activeCol = 1;
      setPanelWidth(1);
      renderProjectsList(parsed.query);

    } else if (parsed.level === 'subpages') {
      st = 'subpages';
      curSubpage = null;
      resolveProjectAndRenderSubpages(parsed.projId, parsed.query);

    } else if (parsed.level === 'subitems') {
      st = 'subitems';
      resolveProjectAndSubpageAndRenderSubitems(parsed.projId, parsed.subpage, parsed.query);
    }
  }

  /* ── Current Project Helper ──────────────────────────────────────────────── */
  function detectCurrentProjectIdentifier() {
    // 1. From URL pathname
    var m = location.pathname.match(/\/projects\/([^\/]+)/);
    if (m) return m[1];
    
    // 2. From Header breadcrumbs (last link inside h1 under #header)
    var headerLinks = document.querySelectorAll('#header h1 a');
    for (var i = headerLinks.length - 1; i >= 0; i--) {
      var href = headerLinks[i].getAttribute('href') || '';
      var m2 = href.match(/\/projects\/([^\/]+)/);
      if (m2) return m2[1];
    }
    
    // 3. Fallback to active menu item
    var activeMenu = document.querySelector('#main-menu a.active, #main-menu a.selected');
    if (activeMenu) {
      var href = activeMenu.getAttribute('href') || '';
      var m3 = href.match(/\/projects\/([^\/]+)/);
      if (m3) return m3[1];
    }
    
    return urlProjId;
  }

  /* ── Link Under Cursor Editing ───────────────────────────────────────────── */
  function getLinkOrTokenAtCursor(ta) {
    var val = ta.value;
    var pos = ta.selectionStart;
    var candidates = [];
    var match;
    
    // Pattern 1: Markdown Link: [Title](URL)
    var mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = mdRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'markdown_link',
          text: match[0],
          title: match[1],
          url: match[2],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }
    
    // Pattern 2: Textile Link: "Title":URL
    var txRegex = /"([^"]+)":([^\s"<>]+)/g;
    while ((match = txRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'textile_link',
          text: match[0],
          title: match[1],
          url: match[2],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 3: Double Bracket Wiki Link: [[Page]] or [[Project:Page]] or [[Page|Label]]
    var dbRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    while ((match = dbRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        var target = match[1];
        var proj = detectCurrentProjectIdentifier() || '';
        var item = target;
        var colonIdx = target.indexOf(':');
        if (colonIdx !== -1) {
          proj = target.substring(0, colonIdx);
          item = target.substring(colonIdx + 1);
        }
        candidates.push({
          type: 'double_bracket',
          text: match[0],
          target: target,
          project: proj,
          subitem: item,
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 4: Attachment image Markdown format: ![](attachment:file.ext)
    var attMdImgRegex = /!\[\]\(attachment:([^\s)]+)\)/g;
    while ((match = attMdImgRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'attachment_md_img',
          text: match[0],
          filename: match[1],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 5: Attachment image Textile format: !attachment:file.ext!
    var attTxImgRegex = /!attachment:([^\s!]+)!/g;
    while ((match = attTxImgRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'attachment_tx_img',
          text: match[0],
          filename: match[1],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 6: Raw attachment link: attachment:file.ext
    var attRawRegex = /\battachment:([^\s!)]+)/g;
    while ((match = attRawRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'attachment_raw',
          text: match[0],
          filename: match[1],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 7: Project-specific Issue shorthand link: sandbox#123
    var issueProjRegex = /\b([a-z0-9\-_]+)#(\d+)\b/gi;
    while ((match = issueProjRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'issue_project',
          text: match[0],
          project: match[1],
          issueId: match[2],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    // Pattern 8: Issue shorthand link: #123 or issue#123
    var issueRawRegex = /(?:issue)?#(\d+)/g;
    while ((match = issueRawRegex.exec(val)) !== null) {
      if (pos >= match.index && pos <= match.index + match[0].length) {
        candidates.push({
          type: 'issue_raw',
          text: match[0],
          issueId: match[1],
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    if (candidates.length === 0) return null;
    
    // Sort by length descending, so we get the most specific match
    candidates.sort(function (a, b) {
      return b.text.length - a.text.length;
    });
    
    return candidates[0];
  }

  function parseLinkToQuery(candidate) {
    var project = detectCurrentProjectIdentifier() || '';
    var subpageKey = '';
    var subitem = '';

    if (candidate.type === 'issue_project') {
      project = candidate.project;
      subpageKey = 'issues';
      subitem = '#' + candidate.issueId;
    }
    else if (candidate.type === 'issue_raw') {
      subpageKey = 'issues';
      subitem = '#' + candidate.issueId;
    }
    else if (candidate.type === 'attachment_raw' || candidate.type === 'attachment_md_img' || candidate.type === 'attachment_tx_img') {
      subpageKey = 'attachments';
      subitem = candidate.filename;
    }
    else if (candidate.type === 'double_bracket') {
      project = candidate.project;
      subpageKey = 'wiki';
      subitem = candidate.subitem;
    }
    else {
      var url = candidate.url;
      if (url.indexOf(location.origin) === 0) {
        url = url.substring(location.origin.length);
      }
      
      var m;
      if ((m = url.match(/\/projects\/([^\/]+)\/wiki\/([^\/?#]+)/))) {
        project = m[1];
        subpageKey = 'wiki';
        subitem = decodeURIComponent(m[2]).replace(/_/g, ' ');
      }
      else if ((m = url.match(/\/projects\/([^\/]+)\/wiki\/?$/))) {
        project = m[1];
        subpageKey = 'wiki';
      }
      else if ((m = url.match(/\/projects\/([^\/]+)\/issues\/(\d+)/))) {
        project = m[1];
        subpageKey = 'issues';
        subitem = '#' + m[2];
      }
      else if ((m = url.match(/\/projects\/([^\/]+)\/(issues|activity|files|documents|boards|repository|members)\/?/))) {
        project = m[1];
        subpageKey = m[2];
      }
      else if ((m = url.match(/\/projects\/([^\/]+)\/?$/))) {
        project = m[1];
      }
      else if ((m = url.match(/\/issues\/(\d+)/))) {
        subpageKey = 'issues';
        subitem = '#' + m[1];
      }
      else if ((m = url.match(/\/attachments\/(?:download\/\d+\/|)?([^\/?#]+)/))) {
        subpageKey = 'attachments';
        subitem = decodeURIComponent(m[1]);
      }
    }

    var q = '>>';
    if (project) {
      q += project;
    }
    
    if (subpageKey) {
      var subpageLabel = getSubpageLabel(subpageKey);
      q += '>' + subpageLabel;
      
      if (subitem) {
        q += '>' + subitem;
      } else {
        q += '>';
      }
    } else if (project) {
      q += '>';
    }
    
    return q;
  }

  function editLinkUnderCursor(ta) {
    var candidate = getLinkOrTokenAtCursor(ta);
    if (!candidate) return false;
    
    var query = parseLinkToQuery(candidate);
    if (!query) return false;
    
    activeTa = ta;
    
    var val = ta.value;
    ignoreInput = true;
    ta.value = val.substring(0, candidate.start) + query + val.substring(candidate.end);
    
    tStart = candidate.start;
    tEnd = candidate.start + query.length;
    ta.selectionStart = ta.selectionEnd = tEnd;
    
    ignoreInput = false;
    
    var e = new Event('input', { bubbles: true });
    ta.dispatchEvent(e);
    
    return true;
  }

  function onTaKeydown(e) {
    var ta = e.target;
    if (st === 'closed' || panel.style.display === 'none') {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (editLinkUnderCursor(ta)) {
          e.preventDefault();
        }
      }
      return;
    }

    var pList = activeCol === 1 ? pList1 : (activeCol === 2 ? pList2 : pList3);
    var lis = pList.querySelectorAll('li[data-idx]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeCol === 1) {
        selIdx1 = findNextSelectable(1, selIdx1, 1);
        applyHL(1);
        updateCol2AndCol3(selIdx1);
      } else if (activeCol === 2) {
        selIdx2 = findNextSelectable(2, selIdx2, 1);
        applyHL(2);
        updateCol3(selIdx2);
      } else {
        selIdx3 = findNextSelectable(3, selIdx3, 1);
        applyHL(3);
      }
      updateTextareaFromSelection();

    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeCol === 1) {
        selIdx1 = findNextSelectable(1, selIdx1, -1);
        applyHL(1);
        updateCol2AndCol3(selIdx1);
      } else if (activeCol === 2) {
        selIdx2 = findNextSelectable(2, selIdx2, -1);
        applyHL(2);
        updateCol3(selIdx2);
      } else {
        selIdx3 = findNextSelectable(3, selIdx3, -1);
        applyHL(3);
      }
      updateTextareaFromSelection();

    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (activeCol === 1) {
        handleTab1();
      } else if (activeCol === 2) {
        handleTab2();
      } else {
        handleTab3();
      }

    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handleGoLeft();

    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        handleGoLeft();
      } else {
        if (activeCol === 1) {
          handleTab1();
        } else if (activeCol === 2) {
          handleTab2();
        } else {
          handleTab3();
        }
      }

    } else if (e.key === 'Enter') {
      if (lis.length > 0) {
        e.preventDefault();
        if (activeCol === 1) {
          handleEnter1();
        } else if (activeCol === 2) {
          handleEnter2();
        } else {
          handleEnter3();
        }
      }

    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleBackAction();
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Textareas anbinden
   * ════════════════════════════════════════════════════════════════════════ */
  function bindTa(ta) {
    if (ta._slBound) return;
    ta._slBound = true;
    ta.addEventListener('input',   onTaInput);
    ta.addEventListener('keydown', onTaKeydown);
    ta.addEventListener('scroll',  function () { if (st !== 'closed') posPanel(this); });
    ta.addEventListener('blur', function () {
      setTimeout(function () {
        if (st === 'closed') return;
        if (panel && panel.contains(document.activeElement)) return;
        cancel();
      }, 150);
    });
  }

  function bindAll(root) {
    var sel = 'textarea.wiki-edit, textarea[id$="_notes"], textarea[id="notes"], textarea[name="notes"]';
    if (root.querySelectorAll) root.querySelectorAll(sel).forEach(bindTa);
    if (root.matches && root.matches(sel)) bindTa(root);
  }

  /* ── AJAX ── */
  function loadJSON(url, ok, err) {
    fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(ok).catch(err || function () {});
  }

  function isMarkdownEditor() {
    if (window.REDMINE_FORMATTING) {
      return window.REDMINE_FORMATTING.indexOf('markdown') !== -1 || 
             window.REDMINE_FORMATTING.indexOf('common_mark') !== -1;
    }
    return document.querySelector('a[href*="wiki_syntax_markdown"]') !== null || 
           document.querySelector('.wiki-edit-markdown, .markdown-editor') !== null ||
           document.querySelector('script[src*="jstoolbar/markdown"]') !== null ||
           document.querySelector('link[href*="jstoolbar/markdown"]') !== null;
  }

  function formatLink(title, path) {
    var fullPath = path;
    if (path.indexOf('/') === 0) {
      fullPath = location.origin + path;
    }
    if (isMarkdownEditor()) {
      return '[' + title + '](' + fullPath + ')';
    } else {
      return '"' + title + '":' + fullPath;
    }
  }

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function h(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function enc(s){ return encodeURIComponent(s); }

  /* ── Wireframe Icon Helpers ────────────────────────────────────────────────── */
  function getIconHtml(iconName) {
    var svgContent = '';
    if (iconName === 'folder') {
      svgContent = '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z"></path>';
    } else if (iconName === 'user') {
      svgContent = '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"></path>';
    } else if (iconName === 'group') {
      svgContent = '<path d="M9 7a4 4 0 1 0 0 -8 4 4 0 0 0 0 8z"></path><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"></path>';
    } else if (iconName === 'issue') {
      svgContent = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';
    } else if (iconName === 'wiki-page') {
      svgContent = '<path d="M12 4.5V20m0 -15.5C11 3.5 8 3 5.5 3S3.5 3.5 3.5 5.5v12c0 2 2.5 2 5 2s4 -1 4.5 -2.5m0 -11.5c1 -1 4 -1.5 6.5 -1.5s2 .5 2 2.5v12c0 2 -2.5 2 -5 2s-4 -1 -4.5 -2.5"></path>';
    } else if (iconName === 'attachment') {
      svgContent = '<path d="M6 12l10-10a5.5 5.5 0 1 1 7.778 7.778l-10 10a3.5 3.5 0 1 1 -4.95 -4.95l10-10a1.5 1.5 0 1 1 2.122 2.122l-8 8"></path>';
    } else if (iconName === 'file' || iconName === 'document' || iconName === 'image-png') {
      svgContent = '<path d="M14 3v4a1 1 0 0 0 1 1h4"></path><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"></path>';
    } else if (iconName === 'comments') {
      svgContent = '<path d="M21 15a2 2 0 0 1 -2 2h-2l-4 4v-4h-2a2 2 0 0 1 -2 -2v-3a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v3z"></path><path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>';
    } else if (iconName === 'package') {
      svgContent = '<path d="M12 3l8 4.5v9l-8 4.5l-8 -4.5v-9l8 -4.5"></path><path d="M12 12l8 -4.5"></path><path d="M12 12v9"></path><path d="M12 12l-8 -4.5"></path><path d="M16 5.25l-8 4.5"></path>';
    } else if (iconName === 'time') {
      svgContent = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
    } else if (iconName === 'stats') {
      svgContent = '<path d="M3 3v18h18"></path><path d="M7 6h8"></path><path d="M10 11h9"></path><path d="M6 16h6"></path>';
    } else if (iconName === 'checked') {
      svgContent = '<circle cx="12" cy="12" r="10"></circle><path d="M9 12l2 2l4 -4"></path>';
    } else if (iconName === 'history') {
      svgContent = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline><path d="M12 2a10 10 0 1 0 10 10"></path>';
    } else {
      svgContent = '<circle cx="12" cy="12" r="10"></circle>';
    }

    return '<span class="sl-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">' + svgContent + '</svg></span>';
  }

  function findFirstSelectable(items, colNum) {
    if (!items || !items.length) return -1;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || item.section || item.disabled) continue;
      if (colNum === 1 && item.project && item.project.isMatch === false) continue;
      return i;
    }
    return -1;
  }

  function findNextSelectable(colNum, currentIdx, direction) {
    var items = colNum === 1 ? col1Items : (colNum === 2 ? col2Items : col3Items);
    if (!items || !items.length) return -1;
    
    var idx = currentIdx;
    while (true) {
      idx += direction;
      if (idx < 0 || idx >= items.length) break;
      var item = items[idx];
      if (item && !item.section && !item.disabled) {
        if (colNum === 1 && item.project && item.project.isMatch === false) {
          continue;
        }
        return idx;
      }
    }
    return currentIdx;
  }

  var subpageLookup = {};
  function translateSubpages() {
    // Fill default lookups
    ALL_SUBPAGES.forEach(function (sp) {
      subpageLookup[sp.name.toLowerCase()] = sp.name;
      subpageLookup[sp.label.toLowerCase()] = sp.name;
    });

    if (window.REDMINE_SUBPAGE_TRANSLATIONS) {
      ALL_SUBPAGES.forEach(function (sp) {
        var translated = window.REDMINE_SUBPAGE_TRANSLATIONS[sp.name];
        if (translated) {
          sp.label = translated;
          subpageLookup[translated.toLowerCase().trim()] = sp.name;
          if (sp.link_pattern) {
            var m = sp.link_pattern.match(/^"([^"]+)":/);
            if (m) {
              sp.link_pattern = '"' + sp.label + '":' + sp.link_pattern.substring(m[0].length);
            }
          }
        }
      });
    }

    // Distinguish 'attachments' from 'files' if they resolve to the same label (e.g., both "Dateien" in German)
    var filesSp = ALL_SUBPAGES.filter(function (sp) { return sp.name === 'files'; })[0];
    var attachSp = ALL_SUBPAGES.filter(function (sp) { return sp.name === 'attachments'; })[0];
    if (filesSp && attachSp && filesSp.label.toLowerCase().trim() === attachSp.label.toLowerCase().trim()) {
      if (filesSp.label.toLowerCase().trim() === 'dateien') {
        attachSp.label = 'Anhänge';
        subpageLookup['anhänge'] = 'attachments';
        subpageLookup['anhange'] = 'attachments';
      } else {
        attachSp.label = attachSp.label + ' (' + (urlSubpageKey || 'Local') + ')';
        subpageLookup[attachSp.label.toLowerCase().trim()] = 'attachments';
      }
    }

    if (urlSubpageKey) {
      var foundSp = ALL_SUBPAGES.filter(function (sp) { return sp.name === urlSubpageKey; })[0];
      if (foundSp) {
        urlSubpage = foundSp.label;
      }
    }
  }

  /* ── Init ── */
  function init() {
    translateSubpages();
    buildPanel();
    bindAll(document);

    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    setTimeout(function () {
      if (!cache.projects) {
        loadJSON('/projects.json?limit=100', function (d) { cache.projects = d.projects || []; });
      }
    }, 1500);

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
