import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Figma needs the UI as a single HTML file: build ui/index.html → dist/ui.html
export default defineConfig({
  root: 'ui',
  plugins: [
    viteSingleFile(),
    {
      name: 'rename-to-ui-html',
      enforce: 'post',
      generateBundle(_, bundle) {
        const html = bundle['index.html'];
        if (html) html.fileName = 'ui.html';
      },
    },
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
