# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-21

### Changed

- The UI was rebuilt with [FigUI3](https://github.com/rogie/figui3) web components to match Figma's UI3: section headers, a Markdown/JSON segmented control and a fixed footer with Export, Copy and Generate.
- The UI follows Figma's light and dark themes (`themeColors: true`) and uses Figma's color tokens only.
- The plugin window is now 320 × 560 px (was 820 × 900).
- The selected component is shown with its name and a component icon instead of a read-only text field.
- **Build:** the UI source moved to `ui/` and is bundled with Vite into a single `dist/ui.html`. `npm run build` now builds both the plugin code and the UI, and `manifest.json` points to `dist/ui.html`. Run `npm run build` after pulling.
- Generate sends a single `ui-generate` message; the plugin answers with both formats.

### Added

- Generate shows a loading state and is always re-enabled, also when generation fails.
- Keyboard support for every control, with visible focus and labelled outputs.

### Removed

- The Google Fonts stylesheet, which the manifest's `networkAccess: none` was blocking anyway.
- The old single-file `ui.html`.

## [1.1.0] - 2026-10-21

### Fixed

- **Export** now saves the JSON file. The UI ignored the plugin's `download` message, so nothing was downloaded.
- **Preferred instances** of instance swap properties are listed by name. They were looked up by node id, but Figma stores them as component keys, so only the count was shown.
- **Copy** works inside Figma's plugin iframe, where the Clipboard API is blocked.
- Removed a fallback that read property definitions from variants, which Figma doesn't allow and which would throw.
- Lint errors (`any` types and unused variables).

### Changed

- `Has X` booleans are kept next to `X` regardless of the order in which they were defined.
- Variant properties include their default value.
- Markdown property lines end with two spaces so they render as separate lines.
- Exported files are named after the exported component, with characters that aren't valid in file names replaced (`Buttons/Primary` → `Buttons-Primary.json`).
- Component sets with errors show a clear message instead of failing silently.
- Copy is enabled based on the output that is visible.

## [1.0.0] - 2025-11-04

### Added

- First release: Markdown and JSON metadata for Component Sets and single Components, with variant, boolean, text and instance swap properties.

[2.0.0]: https://github.com/maxavend/export-component-metadata/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/maxavend/export-component-metadata/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/maxavend/export-component-metadata/releases/tag/v1.0.0
