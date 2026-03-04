import { useState, useEffect, useRef } from 'react';
import { isStoragePath, getSignedUrl } from '../lib/storage';

const CACHE_TTL_MS = 50 * 60 * 1000; // 50 min (signed URLs typically 1h)
const cache = new Map<string, { url: string; at: number }>();

function getCached(userId: string, path: string): string | null {
  const key = `${userId}:${path}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.url;
}

function setCached(userId: string, path: string, url: string): void {
  cache.set(`${userId}:${path}`, { url, at: Date.now() });
}

/**
 * Resolve cue.src to a display URL. For data URLs and http(s) returns as-is.
 * For storage paths (cloud), fetches a signed URL (cached).
 */
export function useMediaUrl(src: string, userId: string | null): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(() => {
    if (!src) return null;
    if (!isStoragePath(src)) return src;
    if (!userId) return null;
    return getCached(userId, src) ?? null;
  });
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!src) {
      setUrl(null);
      setLoading(false);
      return;
    }
    if (!isStoragePath(src)) {
      setUrl(src);
      setLoading(false);
      return;
    }
    if (!userId) {
      setUrl(null);
      setLoading(false);
      return;
    }
    const cached = getCached(userId, src);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    getSignedUrl(userId, src)
      .then((signed) => {
        if (mounted.current) {
          setCached(userId, src, signed);
          setUrl(signed);
        }
      })
      .catch(() => {
        if (mounted.current) setUrl(null);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => { mounted.current = false; };
  }, [src, userId]);

  return { url: url ?? null, loading };
}
