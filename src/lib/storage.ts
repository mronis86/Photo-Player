/**
 * Supabase Storage helpers for the "media" bucket.
 * Path convention: {user_id}/cues/{filename}
 * Cue.src for cloud-stored images is stored as "cues/{filename}" (no user_id in payload).
 *
 * PER-USER ISOLATION (you cannot see other people's photos):
 * - Every path is under the logged-in user's id: fullPath(userId, relativePath) => "{userId}/cues/..."
 * - listCueImages(userId) lists only folder "{userId}/cues" — no other user's folder is ever requested.
 * - getSignedUrl(userId, ...), deleteCueImage(userId, ...), uploadCueImage(..., userId, ...) all use the current user's id.
 * - Supabase Storage RLS (see migrations 003_storage.sql, 004_storage_rls_fix.sql) enforces that authenticated
 *   users can only SELECT/INSERT/UPDATE/DELETE objects whose path equals or starts with (auth.jwt()->>'sub') (their own id).
 * So each user only ever accesses their own folder; RLS blocks any attempt to read or write another user's paths.
 */

import { supabase } from './supabase';

const BUCKET = 'media';
const CUES_PREFIX = 'cues';

function isBucketNotFound(error: { message?: string }): boolean {
  const msg = (error?.message ?? '').toLowerCase();
  return msg.includes('bucket') && (msg.includes('not found') || msg.includes('not exist'));
}

/** Create the media bucket if it doesn't exist. Fails silently if no permission (use Dashboard then). */
async function ensureBucket(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 52428800, // 50 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  });
  // Ignore "already exists" / conflict
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    throw new Error(
      `Could not create storage bucket. Create it in Supabase Dashboard: Storage → New bucket → name "${BUCKET}", set to private. (${error.message})`
    );
  }
}

/** Whether this src is a cloud storage path (not a data URL or http URL). */
export function isStoragePath(src: string): boolean {
  const t = src.trim();
  return t.length > 0 && !t.startsWith('data:') && !t.startsWith('http://') && !t.startsWith('https://');
}

/** Whether this cue src is from our cloud storage (e.g. "cues/..." from Supabase). Use for showing cloud marker in UI. */
export function isCloudStoredCue(src: string): boolean {
  const t = src.trim();
  return t.startsWith('cues/') || t.startsWith('./cues/');
}

/** Full storage path for a cue image: {user_id}/cues/{filename} */
function fullPath(userId: string, relativePath: string): string {
  return `${userId}/${relativePath}`;
}

/**
 * Upload a file to the user's cues folder. Returns the relative path to store in cue.src (e.g. "cues/abc.jpg").
 * The object in the bucket is stored with a unique name (cueId.ext) to avoid collisions. The caller should
 * store the original file name (e.g. file.name) on the cue as cue.name so the cue list shows it.
 */
export async function uploadCueImage(file: File, userId: string, cueId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const ext = file.name.replace(/^.*\./, '') || 'jpg';
  const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'jpg';
  const filename = `${cueId}.${safeExt}`;
  const path = `${CUES_PREFIX}/${filename}`;
  const full = fullPath(userId, path);

  let { error } = await supabase.storage.from(BUCKET).upload(full, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (error && isBucketNotFound(error)) {
    await ensureBucket();
    const retry = await supabase.storage.from(BUCKET).upload(full, file, {
      cacheControl: '3600',
      upsert: true,
    });
    error = retry.error;
  }
  if (error) throw error;

  const originalName = file.name?.trim() || path.replace(/^.*\//, '').replace(/\.[^.]+$/, '') || 'image';
  const { error: metaError } = await supabase.from('storage_file_meta').upsert(
    { user_id: userId, path, original_name: originalName },
    { onConflict: 'user_id,path' }
  );
  if (metaError) {
    // RLS may block upsert (e.g. missing UPDATE policy). Image is already in bucket; save can still use path.
    console.warn('[storage] storage_file_meta upsert failed (run migration 009 for UPDATE policy):', metaError.message);
  }

  return path;
}

/** Convert local cue src (data URL or blob URL) to a File for upload. */
async function localSrcToFile(src: string, cueId: string): Promise<File> {
  const res = await fetch(src);
  const blob = await res.blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `${cueId}.${ext}`, { type: blob.type });
}

/**
 * Upload a local cue image (data URL or blob URL) to the user's cloud cues folder.
 * Returns the relative path to store in cue.src (e.g. "cues/abc.jpg"). Use when saving a project so the table stores paths, not huge data URLs.
 */
export async function uploadCueImageFromLocalSrc(src: string, userId: string, cueId: string): Promise<string> {
  const file = await localSrcToFile(src, cueId);
  return uploadCueImage(file, userId, cueId);
}

/**
 * Get a signed URL for reading a stored cue image. Use for private bucket.
 * relativePath is what we store in cue.src (e.g. "cues/xyz.jpg").
 */
export async function getSignedUrl(userId: string, relativePath: string, expiresInSeconds = 3600): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const path = fullPath(userId, relativePath);
  let result = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (result.error && isBucketNotFound(result.error)) {
    await ensureBucket();
    result = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  }
  const { data, error } = result;
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('No signed URL returned');
  return data.signedUrl;
}

/**
 * Delete a stored cue image by relative path. Use when removing a cue that was cloud-stored.
 */
export async function deleteCueImage(userId: string, relativePath: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const path = fullPath(userId, relativePath);
  await supabase.storage.from(BUCKET).remove([path]);
  await supabase.from('storage_file_meta').delete().eq('user_id', userId).eq('path', relativePath);
}

export interface CloudCueFile {
  path: string;
  name: string;
}

/**
 * List cue images in the user's cloud folder. Returns relative paths (cues/filename) for adding as cues.
 * Uses storage_file_meta to show original file names when available.
 */
export async function listCueImages(userId: string): Promise<CloudCueFile[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const folder = `${userId}/${CUES_PREFIX}`;
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 200 });
  if (error) throw error;
  const files = (data ?? []).filter((f) => f.name && f.id != null);
  const paths = files.map((f) => `${CUES_PREFIX}/${f.name}`);

  let metaMap: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: metaRows } = await supabase
      .from('storage_file_meta')
      .select('path, original_name')
      .eq('user_id', userId)
      .in('path', paths);
    if (metaRows) {
      for (const row of metaRows) {
        const name = (row.original_name ?? '').trim();
        if (name) metaMap[row.path] = name.replace(/\.[^.]+$/, '') || name;
      }
    }
  }

  return files.map((f) => {
    const path = `${CUES_PREFIX}/${f.name}`;
    const name = metaMap[path] ?? (f.name.replace(/\.[^.]+$/, '') || f.name);
    return { path, name };
  });
}
