import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://bao.beyondaiwork.com',
        changeOrigin: true,
        secure: true
      }
    }
  }
});
