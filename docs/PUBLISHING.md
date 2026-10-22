# Publishing to Figma Community

The plugin is live at [figma.com/community/plugin/1568592066328136279](https://www.figma.com/community/plugin/1568592066328136279/export-component-metadata). Publishing from this repo releases a **new version of that listing**; `manifest.json` must keep the id `1568592066328136279`.

## Checklist

1. **Build from a clean checkout of `main`**
   ```bash
   npm ci
   npm run build
   npm run lint
   ```
   Figma uploads the files the manifest points to (`code.js` and `dist/ui.html`) from your disk, so build right before publishing.
2. **Smoke test in the Figma desktop app** (Plugins → Development → Import plugin from manifest…, or run the existing development entry):
   - Select a Component Set, a variant, a single Component and an Instance: the Selection section shows the right name and counts.
   - Generate → check the Markdown and JSON tabs, Copy, and Export (a `.json` file is saved).
   - A component with instance swap preferred values: names are listed (local and library components).
   - Export all .md and Export all .json, with and without **Include hidden components**.
   - Switch Figma between light and dark themes: the UI follows.
3. **Publish**: in the Figma desktop app, open **Plugins → Development → Manage plugins in development**, find *Export Component Metadata* and choose **Publish new version**. Paste the version notes below.
4. **Listing**: update the icon, cover and description if they changed (see below). The data security answers stay the same: the plugin has no network access and sends no data anywhere.
5. **After publishing**: tag the commit you published if it isn't tagged yet (`git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`).

## Version notes — 2.1.0

> A redesigned, native-looking UI and a round of fixes.
>
> • New UI that matches Figma (UI3) and follows light and dark themes.
> • Export all components in the file to one Markdown or JSON file, with an option to include hidden components.
> • Instance swap preferred instances are now listed by name.
> • Export saves the JSON file, and Copy works inside Figma.
> • Variant defaults, clearer ordering of "Has X" / "X" properties and cleaner Markdown line breaks.

## Listing copy

**Name:** Export Component Metadata

**Tagline:** Document component properties as Markdown or JSON, one component or the whole file.

**Description:**

> Export Component Metadata turns your components into documentation. Select a Component, Component Set or Instance and get its properties as readable Markdown or structured JSON — or export every component in the file at once.
>
> Each export includes variant counts, property types (variant, boolean, text, instance swap), default values and preferred instances, ready for Zeroheight, Supernova, Storybook, token pipelines or developer handoff.
>
> • One component or the whole file (.md or .json)
> • Variants with their values and default
> • Instance swap defaults and preferred instances, by name
> • Copy to clipboard or save as a file
> • Native Figma look, light and dark themes
> • No network access: nothing leaves your file

**Tags** (up to 12): documentation, design system, components, properties, variants, metadata, markdown, json, handoff, developer handoff, storybook, export

**Category:** currently *Design tools → File organization*.

**Support contact:** keep the one on the listing.

## Images

| Asset | Size | File |
|---|---|---|
| Icon | 128 × 128 px | [`docs/publishing/icon-128.png`](publishing/icon-128.png) |
| Cover | 1920 × 1080 px | [`docs/publishing/cover.png`](publishing/cover.png) |
| Gallery 1 — *Select a component. Get its documentation.* | 1920 × 1080 px | [`docs/publishing/gallery-1-select.png`](publishing/gallery-1-select.png) |
| Gallery 2 — *Readable Markdown. Structured JSON.* | 1920 × 1080 px | [`docs/publishing/gallery-2-formats.png`](publishing/gallery-2-formats.png) |
| Gallery 3 — *Every property type.* | 1920 × 1080 px | [`docs/publishing/gallery-3-properties.png`](publishing/gallery-3-properties.png) |
| Gallery 4 — *Start from any selection.* | 1920 × 1080 px | [`docs/publishing/gallery-4-any-selection.png`](publishing/gallery-4-any-selection.png) |
| Gallery 5 — *Copy it. Paste it. Done.* | 1920 × 1080 px | [`docs/publishing/gallery-5-paste.png`](publishing/gallery-5-paste.png) |
| Gallery 6 — *One component, or the whole file.* | 1920 × 1080 px | [`docs/publishing/gallery-6-export-all.png`](publishing/gallery-6-export-all.png) |
| Gallery 7 — *Feels like Figma.* | 1920 × 1080 px | [`docs/publishing/gallery-7-native.png`](publishing/gallery-7-native.png) |

The cover and the seven gallery images make an eight-slide carousel (Figma allows up to ten); upload them in this order. Keep important content inside the central 1800 × 1080 px safe area. The icon is the default appearance of the app icon in the [brand kit](brand/README.md) (`docs/brand/png/` has it up to 1024 px).

The plugin windows in the cover and gallery are the real `dist/ui.html`, loaded and driven with sample data, so they always match what users get. The sources are in [`docs/publishing/src`](publishing/src); if the UI or the brand changes, rebuild and render them again:

```bash
npm run build
docs/publishing/src/render.sh
```

`render.sh` needs Google Chrome. The Inter font files in `src/` are under the SIL Open Font License ([`Inter-OFL.txt`](publishing/src/Inter-OFL.txt)).
