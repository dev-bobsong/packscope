import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'main.js'),
      formats: ['es'],
      fileName: 'vite-example'
    },
    outDir: path.resolve(__dirname, '..'),
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: 'vite-example.mjs' }
    }
  }
});
