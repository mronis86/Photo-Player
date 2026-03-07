import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from project root (where you run npm run dev)
  const envDir = process.cwd();
  const env = loadEnv(mode, envDir, '');
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim();
  const isDev = mode === 'development';
  // In dev, point the app at the proxy so browser requests are same-origin (avoids CORS with Supabase).
  const supabaseUrlInjected = isDev && supabaseUrl ? '/supabase-api' : supabaseUrl;
  return {
    root: __dirname,
    envDir,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrlInjected),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(String(env.VITE_SUPABASE_ANON_KEY ?? '').trim()),
    },
    server: {
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
        ...(isDev && supabaseUrl
          ? {
              '/supabase-api': {
                target: supabaseUrl,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/supabase-api/, ''),
                secure: true,
              },
            }
          : {}),
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
