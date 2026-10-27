# Changelog

## 0.1.0

- Give every expanded sidebar pane an explicit-height scroll viewport with native wheel scrolling, overflow-only themed scrollbars, fixed headings, and isolated scroll boundaries.
- Add real VS Code Webview input acceptance for wheel, scrollbar drag, viewport resizing, and .vul/.uh/.utb scrolling.

- Fit initial INTERFACE pane height to its contents, capped at 35% of sidebar height only when no prior sizing data exists; preserve unrestricted manual resizing.

- Unify ordered sidebar panes in a reusable renderer; promote INTERFACE and VERSION, hide USE_VERSION entries, and label unversioned module contents Default Version.
- Support multiple expanded panes, adjacent-pane resizing across collapsed headings, stable version state, and migration of previous sidebar preferences.

- Distinguish expanded top-level sidebar sections with indented contents and a full-height theme-colored vertical guide.

- Split the sidebar only while both sections are expanded; let a single open section fill the available height and collapse global declarations by default for .vul files.

- Always show the optional TICK_IMPL name in API parameters, leaving its value blank when omitted.

- Separate global declarations and file contents into independently scrolling panes with a draggable, keyboard-accessible divider and a persisted 30%/70% initial split.

- Open .uh, .vul and .utb files in the visual editor by default; keep Source View available for text editing.

- Extend visual/source switching to .uh Headers and .utb testbenches, with file-specific parsing, section titles, and deduplicated Header diagnostics.

- Fix migrated test fixture variable, include .uh parser coverage, isolate SDK examples from legacy files, and assert simulation outputs.

- Switch global Header discovery to header.uh and recursive header/**/*.uh; use install/example for example builds, parser fixtures and extension-host workspaces.

- Add project-wide Header declaration browsing with independent Global Declarations and Module Contents sections.
- Discover projects from vulTools.projectRoot, module PROJECT metadata, or nearest ancestor Headers; support recursive per-file Header groups.
- Share Header parsing across modules, read unsaved buffers, publish declaration diagnostics, and refresh on filesystem changes with stale-result protection.

- Add VUL module (`.vul`) and testbench (`.utb`) language support.
- Check declaration syntax without checking embedded C++ bodies.
- Add read-only component visualization, API parameter inspection and original code blocks.
- Show combined ALIAS / REGISTER types and provide temporary code editing without source writeback.
- Display parameter defaults inline and use VS Code C++ TextMate grammars and theme colors in temporary code editors.
- Format transaction signatures and typed component names in bold; show only explicit parameters in list summaries.
- Include migrated runnable querydemo, prodcon and array1d examples.
