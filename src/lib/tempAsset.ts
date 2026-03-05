/**
 * Temp asset API: upload a local cue image (data URL or blob URL) to the server
 * so playout on the same network can load it via a normal URL.
 */

/** True if cue src is local (data URL or blob URL) and needs temp-asset resolution for cross-browser playout. */
export function isLocalCueSrc(src: string): boolean {
  const t = (src || '').trim();
  return t.startsWith('data:') || t.startsWith('blob:');
}

/** Convert blob URL to data URL. */
function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  return fetch(blobUrl)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read blob'));
          reader.readAsDataURL(blob);
        })
    );
}

/**
 * Upload local image (data URL or blob URL) to the server; returns a path the playout
 * can use. We return a relative path (/api/temp-asset/:id) so the playout resolves it
 * against its own origin — works when playout is in another browser or on another device
 * on the same network (same app host).
 */
export async function uploadTempAsset(src: string): Promise<string> {
  if (typeof window === 'undefined') throw new Error('uploadTempAsset is only available in the browser');
  let dataUrl: string;
  if (src.trim().startsWith('blob:')) {
    dataUrl = await blobUrlToDataUrl(src);
  } else if (src.trim().startsWith('data:')) {
    dataUrl = src;
  } else {
    throw new Error('Expected data URL or blob URL');
  }
  const origin = window.location.origin;
  const res = await fetch(`${origin}/api/temp-asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Temp asset upload failed');
  }
  const { id } = (await res.json()) as { id: string };
  return `/api/temp-asset/${id}`;
}
