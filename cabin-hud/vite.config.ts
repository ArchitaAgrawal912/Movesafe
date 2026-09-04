import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Web Serial needs a secure context; localhost qualifies.
    host: 'localhost',
    port: 5173,
  },
});
