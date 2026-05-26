# Redmine Subtrigger Plugin

![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)
![Redmine](https://img.shields.io/badge/Redmine-5.0%20%7C%206.0-red.svg?logo=redmine)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A Redmine plugin that brings smart autocomplete and linking to every wiki text area — macros, mentions, and a powerful multi-level column-style link builder.

> Built for teams who write a lot of Redmine text and want fast, discoverable links without remembering syntax.

## Features

- **`>>` — Smart Linker**: A cascading popover to build links to any internal objects without knowing the syntax:
  - **Hierarchical Project Navigation**: Indented subproject tree sorting with parent context retention
  - **Multi-Level Drill-Down Navigation**: Seamlessly drill down from Project $\rightarrow$ Section (Issues, Wiki, Members, Files, News, Documents, etc.) $\rightarrow$ Target Item $\rightarrow$ Sub-item / Wiki Anchor.
  - **Wiki, News, Documents & Files Integration**: Browse, search, and link wiki headings/anchors, news articles, documents, and project files with automatic, native Redmine/Markdown syntax formatting.
  - **Tab-Triggered Link Editing**: Place caret cursor on any link (Markdown, Textile, Double Brackets, raw attachments/issues) and press `Tab` to instantly reopen the Smart Linker cascaded at that exact item!
  - **Third-Party Addon Support**: Automatically scrapes active Redmine `#main-menu` links on load to dynamically register and link third-party tabs (like DMSF, Questions, Checklists, etc.) in the subpages menu.
- **`{{` — Macro Autocomplete**: Type `{{` to get a dropdown of all available Redmine macros with descriptions and a full detail preview panel.
- **`@` — Instant Mention Dropdown**: Shows up immediately after `@` (no minimum character required) for extremely fast user tagging.

All features work in **every wiki text area**: wiki pages, issue descriptions, issue notes, journal edits, news comments, forum messages, and project/document descriptions.

## Requirements

- Redmine 5.0 or higher

## Installation

> [!IMPORTANT]
> The plugin directory **MUST** be named `redmine_subtrigger` for the hook to load correctly.

1. **Clone** into your plugins directory:

   ```bash
   cd /path/to/redmine/plugins
   git clone https://github.com/subversive-tools/redmine_subtrigger.git redmine_subtrigger
   ```

2. **Restart Redmine** (no migrations required).

## Usage

### `{{` — Macro Autocomplete

Type `{{` anywhere in a wiki text area. A dropdown appears listing all available macros with a short description. Use arrow keys to navigate, `Tab` or `Enter` to insert.

The detail panel below the list shows the full macro description for the currently selected entry.

### `@` — Instant Mention

Type `@` at the start of a word. The member dropdown opens immediately (unlike Redmine's default which requires at least one character). Type to filter; only the first 10 members are shown.

### `>>` — Smart Linker

Type `>>` after a space or at the start of a line. An ultra-compact multi-column panel opens, showing one active navigation column at a time (width 280px) and following your cursor.

#### Intermediate Level Navigation

- **ArrowUp / ArrowDown**: Navigate through list items in the active column.
- **Tab / Enter / ArrowRight (`→`)**: Expand the highlighted intermediate item (project or subpage branch), appending a `>` delimiter (e.g. `>>myproject>Tickets>`) and cascading to the next adjacent column.
- **Escape (`Esc`) / ArrowLeft (`←`) / Shift+Tab**: Backtrack one column level to the left, safely reverting the path and restoring the highlighted parent selection without closing the panel.

#### Wiki Page Anchor Autocomplete (Level 4)

Typing `#` after a Wiki page name (e.g., `>>project>Wiki>Page#`) or highlighting a page in Column 3 and pressing `Tab` / `ArrowRight` (`→`) triggers **Wiki Anchor Autocomplete**:

1. It queries the raw content of the Wiki page on the fly.
2. It parses the page's headings (supports both Textile and Markdown syntax).
3. It slugifies the headings to match standard Redmine anchors and renders them in Column 4 (displacing previous columns in a cascading fashion).
4. Selecting an anchor and pressing **Enter** inserts a fully formatted Wiki page link with the anchor suffix (e.g., `[[Page#My-Heading]]` or `[Page Title](WikiPageName#My-Heading)`).

#### News, Documents & Project Files

- **News**: Link project news directly. Auto-completes from `/projects/{project_id}/news.json`, showing comment counts, and inserting clean native links (`news#ID` in Textile, `[Title](news:ID)` in Markdown).
- **Documents**: Parses project documents dynamically from `/projects/{project_id}/documents` HTML, enabling instant autocomplete lookup.
- **Files**: Integrates project files via JSON API, inserting native links (`attachment:"filename.ext"` or `![](filename.ext)` for images) and percent-encoding spaces correctly.

#### Dynamic Third-Party Addons

The Smart Linker dynamically crawls the `#main-menu` navigation on load. Any third-party Redmine addon tab (e.g., DMSF, Questions, Checklists, etc.) will automatically appear as an option in the subpage list and can be searched and linked directly.

#### Leaf Level Finalization

- **ArrowRight (`→`) / Tab**: On leaf items (Column 3 items, anchor items, or subpages in Column 2 that have no submenu like Overview, Calendar, Gantt, etc.), `Tab` and `ArrowRight` do nothing, keeping your typed query pristine.
- **Enter / Return** (or mouse click): Instantly converts the query to the clean, finalized Textile/Markdown link and inserts it directly at the cursor, closing the panel.

#### Round-trip Link Editing

If the caret is inside any Markdown link, Textile link, double-bracket wiki link (`[[Page]]`), attachment shorthand (`attachment:file.ext`), or issue shorthand (`#123` or `project#123`), pressing `Tab` while the panel is closed will automatically:

1. Scan and detect the link under the cursor.
2. Replace it with the corresponding `>>` path query.
3. Automatically look up project context (using the page URL, active menu items, or header breadcrumbs like `#header h1 a`).
4. Re-open the Smart Linker right at that item's column with the search term pre-loaded!

## How It Works

The plugin injects a single `<style>` and `<script>` block into every Redmine page via a `ViewListener` hook. No external dependencies or bloated JavaScript frameworks. All assets are read from disk on each request, making browser reload sufficient after updating plugin files.

The project list is prefetched 2 seconds after page load so the Smart Linker panel opens instantly.

## Contributing

Contributions are welcome — please fork the repository and open a Pull Request.

1. Fork it
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

[MIT License](LICENSE) — Copyright (c) 2026 Stefan Mischke
