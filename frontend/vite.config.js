import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forwards /api/* calls to the Express backend during local dev.
      '/api': 'http://localhost:4000',
      // Uploaded insurance photos/invoices are served by the backend too.
      '/uploads': 'http://localhost:4000',
    },
  },
});
