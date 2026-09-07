import { defineConfig } from 'vite';

// The game is served on http://localhost:2006 for both `npm run dev` and
// `npm run preview`. strictPort makes Vite fail loudly if 2006 is taken instead
// of silently moving to another port.
export default defineConfig({
  server: { port: 2006, strictPort: true, open: true },
  preview: { port: 2006, strictPort: true },
  build: { target: 'es2020' },
});
