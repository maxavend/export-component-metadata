# Export Component Metadata

**Export Component Metadata** is a professional-grade Figma plugin that allows designers, developers, and documentation teams to extract and visualize structured metadata from any **Component** or **Component Set**.  
It generates clear, well-organized documentation in **Markdown** and **JSON**, suitable for integration with documentation platforms like **Zeroheight**, **Supernova**, or **Storybook**.

---

## Overview

This plugin simplifies the process of documenting **Component Properties** (Variants, Booleans, Text, String, Instance Swap, etc.) directly from Figma — ensuring consistent and standardized component documentation across teams.

You can select either:
- A **Component Set** (to include all variants)
- A **single Component** (even if it doesn’t belong to a set)

Then the plugin automatically extracts all available **properties**, orders them intelligently (using a stable heuristic similar to Figma’s UI order), and generates a clean Markdown summary or JSON export.

---

## Features

- **Markdown or JSON Export** — auto‑generate readable or structured metadata documentation.
- **Full Property Support** — detects and lists:
  - `VARIANT` groups
  - `BOOLEAN` toggles
  - `TEXT` and `STRING` inputs
  - `INSTANCE_SWAP` with preferred instances
- **Component‑Level Detection** — works with both **Component Sets** and **single Components**.
- **Heuristic Ordering** — preserves an order similar to Figma’s property panel (e.g., “Has Left Icon” before “Left Icon”).
- **Inline Status Feedback** — see real‑time messages in the plugin UI.
- **One‑Click Export** — export metadata in `.json` format for reuse or automation pipelines.

---

## Why This Plugin?

Figma doesn’t expose the UI order of properties via the Plugin API.  
**Export Component Metadata** solves this by implementing a **heuristic ordering logic** that intelligently groups and pairs related properties, making the output predictable and human-readable — without clutter.

This allows:
- Design systems teams to generate accurate component documentation in seconds.
- Developers to import property definitions for code token mapping.
- Product designers to share structured specs directly from Figma.

---

## Technical Architecture

### Core API Used
| Area | API / Method | Purpose |
|------|---------------|---------|
| Node Resolution | `figma.currentPage.selection` + `getMainComponentAsync()` | To detect the selected node and resolve it to a Component or Component Set |
| Metadata Extraction | `componentPropertyDefinitions` | To retrieve property names, types, and default values |
| Async Access | `figma.getNodeByIdAsync()` | Modern async API to safely fetch nodes |
| Communication | `figma.ui.postMessage()` / `figma.ui.onmessage` | Bidirectional data flow between plugin backend and UI |
| Export | `figma.ui.postMessage({ format: "json" })` | Export clean structured data |

---

## How It Works

1. **Select** a Component or Component Set in Figma.
2. **Open the Plugin** → "Export Component Metadata".
3. Click **Generate** to produce Markdown and JSON documentation.
4. Copy or Export results with one click.

If a Component is selected (not a set), the plugin still outputs all its **Component Properties** (booleans, text, instance swaps, etc.) even if there are no variants.

---

## Installation (Development)

1. Clone or download this repository.
2. Run:
   ```bash
   npm install
   ```
3. Compile the plugin with:
   ```bash
   npm run build
   ```
4. In Figma, go to **Plugins → Development → New Plugin...**
   and select the `manifest.json` file from this project.
5. Launch the plugin via **Plugins → Development → Export Component Metadata**.

---

## Technology Stack

- **Language:** TypeScript
- **UI:** Vanilla HTML + CSS (using a custom Figma UI Kit)
- **Figma APIs:** Plugin API (v1.0+)
- **Build Tool:** TypeScript Compiler (tsc)
- **Export Format:** Markdown + JSON

---

## Example Output

```markdown
# Button

## Overview
- Variants: 105
- Component Properties: 8

## Component Props
[BOOLEAN] **Has Left Icon**  
Values: True / False  
Default: true  

[INSTANCE SWAP] **Left Icon**  
Default: dashboard_customize  
Preferred Instances (3): `icon/chevron-left`, `icon/back`, `icon/menu`

[TEXT] **Text**  
Default: Body text  

[VARIANT] **Size**  
Values: L, M, S  

[VARIANT] **Variant**  
Values: Primary, Secondary, Tertiary, Tonal, Danger/Text, Overlay
```

---

## Developer Notes

- Built using **official Figma Plugin API**:  
  [https://www.figma.com/plugin-docs/api/](https://www.figma.com/plugin-docs/api/)
- The plugin avoids deprecated sync methods like `getNodeById` and fully supports async operations.
- The code structure follows a clear separation:
  - `code.ts` → plugin logic (Figma side)
  - `ui.html` → user interface (browser side)

---

## Author
**Maximiliano Avendaño Rincón**  
Design Systems Engineer / Plugin Developer  
📍 SCL 
GitHub: [@maxavend](https://github.com/maxavend)

---

## License

MIT License — use, modify, and distribute freely with attribution.