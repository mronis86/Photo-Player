import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from project root (where you run npm run dev)
  const envDir = process.cwd();
  const env = loadEnv(mode, envDir, '');
  return {
    root: __dirname,
    envDir,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(String(env.VITE_SUPABASE_URL ?? '').trim()),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()),
    },
    server: {
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
          playout: 'playout.html',
        },
      },
    },
  };
});
