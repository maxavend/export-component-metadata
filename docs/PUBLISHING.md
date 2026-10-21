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

Figma Community needs a **128 × 128 px icon** and a **1920 × 1080 px cover**. Build the cover from screenshots of the real UI (`docs/screenshot-dark.png`, `docs/screenshot-light.png`) so it matches what users get.
