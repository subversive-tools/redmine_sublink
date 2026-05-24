(function () {
  'use strict';

  var MACROS = [];
  var dropdown, macList, macDetail;
  var selectedIndex = -1;
  var activeTextarea = null;

  // ── Create DOM ──────────────────────────────────────────────────────────────

  function createDropdown() {
    var d = document.createElement('div');
    // Reuse Redmine's existing .tribute-container styles (tribute-5.1.3.css + application.css)
    d.className = 'tribute-container sublink-container';
    d.style.display  = 'none';
    // fixed: viewport-relative, immune to overflow:hidden on any ancestor
    d.style.position = 'fixed';
    d.style.zIndex   = '99999';
    d.setAttribute('role', 'listbox');

    macList = document.createElement('ul');
    d.appendChild(macList);

    macDetail = document.createElement('div');
    macDetail.className = 'sublink-detail';
    macDetail.style.display = 'none';
    d.appendChild(macDetail);

    document.body.appendChild(d);
    return d;
  }

  // ── Attach to textarea ───────────────────────────────────────────────────────

  function attach(textarea) {
    if (textarea._sublinkBound) return;
    textarea._sublinkBound = true;

    textarea.addEventListener('input', function () { onInput(this); });
    textarea.addEventListener('keydown', onKeydown.bind(textarea));
    textarea.addEventListener('blur', function () {
      setTimeout(hide, 150);
    });
  }

  // Attach to all matching textareas in a given root element
  function attachAll(root) {
    var selector = 'textarea.wiki-edit, textarea[id$="_notes"], textarea[id="notes"], textarea[name="notes"]';
    var textareas = root.querySelectorAll ? root.querySelectorAll(selector) : [];
    textareas.forEach(attach);

    // Also handle the root itself if it matches
    if (root.matches && root.matches(selector)) {
      attach(root);
    }
  }

  function onInput(textarea) {
    activeTextarea = textarea;
    var val    = textarea.value;
    var pos    = textarea.selectionStart;
    var before = val.substring(0, pos);
    var m      = before.match(/\{\{(\w*)$/);
    if (!m) { hide(); return; }
    render(m[1], textarea);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function render(query, textarea) {
    var filtered = MACROS.filter(function (m) {
      return m.name.indexOf(query) === 0;
    });

    if (filtered.length === 0) { hide(); return; }

    macList.innerHTML = filtered.map(function (m, i) {
      return '<li data-index="' + i + '"' +
               ' data-macro="' + esc(m.name) + '"' +
               ' data-detail="' + esc(m.detail || m.desc || '') + '"' +
               ' role="option">' +
               '<span>{{' + esc(m.name) + '}}</span>' +
               (m.desc ? ' <em>' + esc(truncate(m.desc, 72)) + '</em>' : '') +
             '</li>';
    }).join('');

    macList.querySelectorAll('li').forEach(function (item) {
      item.addEventListener('mouseenter', function () {
        selectedIndex = parseInt(this.dataset.index);
        updateHighlight(macList.querySelectorAll('li'));
      });

      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        insertMacro(activeTextarea, this.dataset.macro);
        hide();
        activeTextarea.focus();
      });
    });

    macDetail.style.display = 'none';
    macDetail.textContent   = '';
    selectedIndex = -1;

    // Auto-select when query matches exactly one macro
    if (filtered.length === 1 && filtered[0].name === query) {
      selectedIndex = 0;
    }

    position(textarea);
    dropdown.style.display = 'block';

    if (selectedIndex >= 0) {
      updateHighlight(macList.querySelectorAll('li'));
    }
  }

  // ── Keyboard handling ────────────────────────────────────────────────────────

  function onKeydown(e) {
    if (dropdown.style.display === 'none') return;

    var items = macList.querySelectorAll('li');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      updateHighlight(items);

    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateHighlight(items);

    } else if (e.key === 'Tab' || e.key === 'Enter') {
      var target = selectedIndex >= 0 ? items[selectedIndex]
                 : items.length === 1  ? items[0]
                 : null;
      if (target) {
        e.preventDefault();
        insertMacro(this, target.dataset.macro);
        hide();
      }

    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  }

  function updateHighlight(items) {
    items.forEach(function (item, i) {
      var selected = i === selectedIndex;
      item.classList.toggle('highlight', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });

    var activeItem = items[selectedIndex];
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
      showDetail(activeItem.dataset.detail || '');
    } else {
      hideDetail();
    }
  }

  // ── Detail panel ─────────────────────────────────────────────────────────────

  function showDetail(text) {
    if (!text) { hideDetail(); return; }
    macDetail.textContent   = text;
    macDetail.style.display = 'block';
  }

  function hideDetail() {
    macDetail.style.display = 'none';
    macDetail.textContent   = '';
  }

  // ── Macro insertion ──────────────────────────────────────────────────────────

  function insertMacro(textarea, name) {
    var val    = textarea.value;
    var pos    = textarea.selectionStart;
    var before = val.substring(0, pos);
    var after  = val.substring(pos);

    var m = before.match(/\{\{(\w*)$/);
    if (!m) return;

    var start   = pos - m[0].length;
    var snippet = '{{' + name + '}}';
    textarea.value = before.substring(0, start) + snippet + after;

    var newPos = start + snippet.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Positioning (mirror-div technique) ───────────────────────────────────────
  // Uses viewport coordinates (no scroll offset) because the dropdown is position:fixed.

  function position(textarea) {
    var cursorPos = measureCursorOffset(textarea);
    var taRect    = textarea.getBoundingClientRect();

    // Viewport-relative coordinates for position:fixed
    var left = taRect.left + cursorPos.left;
    var top  = taRect.top  + cursorPos.top + cursorPos.lineHeight + 2;

    // Clamp so the dropdown never runs off the right edge
    var maxLeft = window.innerWidth - 382;
    left = Math.max(4, Math.min(left, maxLeft));

    // Flip upward if the dropdown would extend below the viewport
    var dropH = dropdown.offsetHeight || 240;
    if (top + dropH > window.innerHeight - 8) {
      top = taRect.top + cursorPos.top - dropH - 4;
    }

    dropdown.style.left = left + 'px';
    dropdown.style.top  = top  + 'px';
  }

  function measureCursorOffset(textarea) {
    var style = window.getComputedStyle(textarea);
    var props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
                 'letterSpacing', 'lineHeight', 'textTransform',
                 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
                 'boxSizing', 'wordWrap', 'overflowWrap', 'whiteSpace'];

    var mirror = document.createElement('div');
    props.forEach(function (p) { mirror.style[p] = style[p]; });
    mirror.style.position   = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.top        = '-9999px';
    mirror.style.left       = '-9999px';
    mirror.style.width      = textarea.clientWidth + 'px';
    mirror.style.height     = 'auto';
    mirror.style.overflow   = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.textContent      = textarea.value.substring(0, textarea.selectionStart);

    var cursor = document.createElement('span');
    cursor.textContent = '\u200b'; // zero-width space
    mirror.appendChild(cursor);
    document.body.appendChild(mirror);

    var lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) + 4;
    var result = {
      left:       cursor.offsetLeft - textarea.scrollLeft,
      top:        cursor.offsetTop  - textarea.scrollTop,
      lineHeight: lineHeight
    };
    document.body.removeChild(mirror);
    return result;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function hide() {
    dropdown.style.display = 'none';
    hideDetail();
    selectedIndex = -1;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '…' : str;
  }

  // ── Patch Redmine's Tribute @-mention ────────────────────────────────────────
  // • Shows the dropdown immediately when @ is typed at a word boundary,
  //   instead of Redmine's default of requiring ≥ 1 character first.
  // • Caps every result set to MAX_MENTION_RESULTS so large installs stay fast.

  var MAX_MENTION_RESULTS = 10;

  function patchTributeOnElement(el) {
    if (el._sublinkTributePatchDone) return;
    // Tribute 5.x attaches the instance as element.tribute (fallbacks for other versions)
    var tribute = el.tribute || el._tribute || el._tributeInstance;
    if (!tribute || !tribute.collection) return;

    tribute.collection.forEach(function (col) {
      if (col.trigger !== '@') return;

      // 0 chars needed after @ → dropdown opens immediately
      col.menuShowMinLength = 0;

      // Wrap values() to cap results at MAX_MENTION_RESULTS
      if (!col._sublinkLimited) {
        var orig = col.values;
        col.values = function (text, cb) {
          orig.call(col, text, function (results) {
            cb((results || []).slice(0, MAX_MENTION_RESULTS));
          });
        };
        col._sublinkLimited = true;
      }
    });

    el._sublinkTributePatchDone = true;
  }

  function patchAllTribute() {
    var sel = 'textarea.wiki-edit, textarea[id$="_notes"], ' +
              'textarea[id="notes"], textarea[name="notes"]';
    document.querySelectorAll(sel).forEach(patchTributeOnElement);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    MACROS = (window.REDMINE_MACROS || []);
    if (MACROS.length === 0) return;

    dropdown = createDropdown();

    // Attach to all wiki-edit textareas present at load time
    // Covers: wiki pages, issue descriptions, issue notes, journal edits,
    //         news comments, forum messages, project/document descriptions etc.
    attachAll(document);

    // Watch for dynamically added textareas (e.g. AJAX-loaded forms,
    // inline edit panels, comment edit links, issue update forms)
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          attachAll(node);
          // Also patch Tribute instances that Redmine may attach to the new node
          setTimeout(function () { patchAllTribute(); }, 200);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback: re-scan every second for a few seconds after load.
    // Covers both macro textareas and Tribute @-mention patching because
    // Tribute is initialised by Redmine's own JS after our script runs.
    var scanCount = 0;
    var scanTimer = setInterval(function () {
      attachAll(document);
      patchAllTribute();
      scanCount++;
      if (scanCount >= 5) clearInterval(scanTimer);
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
