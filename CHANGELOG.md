# Changelog

All notable changes to this project will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.5.0] - 2026-05-26

### Added
- **Plugin Settings UI**: Dedicated configuration page under Redmine Plugin Administration.
- **Feature Control toggles**: Selectively enable or disable macro autocomplete (`{{`), `@` mentions patching, and the Smart Linker.
- **Customizable Smart Linker Trigger**: Customize the Smart Linker trigger (default `>>`) to `<<` or any custom character sequence directly from the UI.
- **Dynamic Performance optimization**: Assets and event listeners load dynamically and only for active features to save browser resources.

## [0.4.0] - 2026-05-26

### Added
- **Real-Time Wiki Page Anchor Autocomplete**: Seamless autocomplete and real-time filtering for headings and anchors on Wiki pages (`>>project>Wiki>Page#anchor`). Pressing `Tab`/`→` or typing `#` after a Wiki page name moves the UI to the 4th level (`'anchors'`), parsing Textile/Markdown page content dynamically to list headers, with standard Redmine slugified anchors.
- **Dynamic Third-Party Addon Support**: Scrapes the Redmine `#main-menu` at runtime to automatically support any custom tabs (like DMSF, Questions, Checklists, etc.) in the project subpages column without hardcoding, making the Smart Linker fully universal.
- **Project News Autocomplete**: Complete project News articles browsing and linking (`news#ID` in Textile, `[Title](news:ID)` in Markdown), displaying news item subject, comments counts, and localized labels with unique icons.
- **Improved Project Documents Integration**: Crawls project `/projects/{project_id}/documents` HTML dynamically to list, search, and link project-specific documents, overcoming the lack of a Redmine REST API for Documents.
- **Tab-Triggered Link Editing under Cursor**: Seamless round-trip link editing by pressing `Tab` on any existing hyperlink (Markdown, Textile, Double Brackets, attachments, raw issue/project shorthands) when the panel is closed, instantly popping the Smart Linker open at that exact item.
- **Robust Breadcrumbs Project Context Detection**: Implemented recursive project lookup searching browser URL pathname, header breadcrumb navigation (`#header h1 a`), and active menu select elements to determine project identifier even on isolated subpages (like `/issues/17`).
- **Premium Wireframe Outline SVGs**: Integrated delicate monochrome outline SVGs (14px centered in a 20px box) representing all Redmine page categories, matching standard Redmine `/admin` wireframe icons and turning white on hover/focus.
- **Project Files JSON API loader**: Complete files tab loading in Column 3 querying `/projects/{project_id}/files.json` dynamically.
- **Subpage/Attachment Disambiguation**: Intelligently maps German locales to rename duplicate `"Dateien"` labels to `"Anhänge"` (for page attachments) and `"Dateien"` (for project-wide files).
- **Comprehensive Dynamic Localization System**: Migrated all remaining user-facing strings to use dynamic translation hooks powered by Redmine's core Ruby locale files (`de.yml` and `en.yml`), resolving duplicate labels ("Anhänge" / "Dateien") perfectly.

### Changed
- **Standardized Native Markdown Attachment Links**: Automatically formats attachment images and files using native Redmine-compliant syntax (`![](filename.png)` and `attachment:"filename.zip"`) instead of broken prefixes, fully percent-encoding spaces and special characters for pristine rendering.
- **Popover Hover Gating**: Implemented cursor auto-hiding and physical mouse movement tracking (`sl-mouse-inactive`) when the Smart Linker pops open or changes levels, preventing accidental selections when the cursor resides over the menu.
- **Space-free Delimiter Formatting**: Eliminated spaces around the `>` delimiter (e.g. `>>myproject>Tickets>#18`), perfectly matching autocomplete text parsing.
- **Ticket Dropdown Prefix Cleanup**: Removed redundant project identifier prefixes from ticket list labels in Column 3, displaying clean `#18: Subject` strings.
- **Leaf-Level Navigation Skip**: Pressing Tab or ArrowRight on leaf items (in Column 3, or Column 2 pages with no submenu) does nothing to keep the typed query pristine, keeping Enter and mouse clicks as the dedicated link finalizers.
- **Wiki Overview URL Formatting**: Replaced legacy and broken Textile `project:identifier` shorthand links with standard clickable root-relative URLs (`/projects/identifier`).

## [0.3.0] - 2026-05-24

### Added
- **Dynamic Redmine Core Localization**: Replaced all hardcoded German subpage titles and pre-fill logic with dynamic lookups mapped directly from Redmine's Ruby locale dictionary (`window.REDMINE_SUBPAGE_TRANSLATIONS`). Full native support for English, German, French, Spanish, Japanese, and all other languages.
- **macOS Finder Column-Style Cascading Dropdown**: Completely updated the dropdown layout to dynamically render active navigation columns in a compact, elegant 280px wide floating window following the cursor.
- **Real-Time Textarea-Scroll Sync**: As users navigate menu options with ArrowUp/ArrowDown, the textarea's active selection content updates instantly in real time without collapsing or refiltering options lists.
- **Selective Skipping**: ArrowUp/ArrowDown automatically bypass non-selectable list sections and disabled message placeholders.
- **Unified 3-Way Next Level Transitions**: Highlighted intermediate items can now be expanded to the next menu level via Tab, Enter, or the Right Arrow key (`→`).
- **Robust Multi-Level Backtracking**: Unified Left Arrow (`←`) and Shift+Tab key actions to step backwards one level at a time without losing parent highlighted context or bouncing back to deeper columns.
- **Automatic Current-Location Context Pre-Filling**: Intelligently parses active project identifier and page module (Issues, Wiki, Activity, etc.) directly from browser address, pre-populating path upon typing `>>` to expose local sub-items with zero typing.

## [0.2.0] - 2026-05-24

### Added
- **Smart Linker (`>>`)**: multi-level link builder triggered by `>>` after a space or at line start
  - General links: E-Mail (`mailto:`), Weblink (auto-prefixes `https://`), Attachments (auto-detected from current issue/wiki page)
  - Project-specific links: Issues, Members, Wiki pages — with correct cross-project Textile syntax
  - Project list is prefetched 2 s after page load for instant panel opening
  - Keyboard navigation throughout (Arrow keys, Enter, Escape to go back)
- **`@`-mention improvement**: dropdown now opens immediately after `@` (no minimum character required); results capped at 10 for performance
- Smart Linker panel (`sl-*`) styles as a separate CSS file

### Changed
- Plugin renamed from `redmine_subcomplete` to `redmine_subtrigger`
  - Plugin identifier: `:redmine_subcomplete` → `:redmine_subtrigger`
  - Hook class: `MacroAutocompleteHook` → `SubtriggerHook`
  - CSS classes: `.subcomplete-*` → `.subtrigger-*`
  - Internal JS properties: `_subcomplete*` → `_subtrigger*`
  - CSS file: `subcomplete.css` → `subtrigger.css`
- Hook now injects multiple CSS/JS files cleanly via `read_asset` helper
- Version bumped to `0.2.0`

### Fixed
- Macro dropdown is now `position: fixed` with `z-index: 99999` — no longer clipped by `overflow: hidden` ancestors
- Macro list height limited to ~4 visible items; detail panel shows full text without scroll limit
- Autocomplete now works in all wiki text areas (issues, notes, journals, news, forums) via extended selector and MutationObserver

## [0.1.0] - 2026-05-21

### Added
- Initial release: `{{` macro autocomplete for all Redmine wiki text areas
- Dropdown reuses Redmine's `.tribute-container` styles for visual consistency
- Detail panel shows full macro description for the selected entry
- Implicit macros `toc` and `child_pages` always included
- MutationObserver watches for dynamically added text areas
