import type { Cue, Group, CueItem } from './types';
import { supabase } from './supabase';

export interface ProjectPayload {
  cues: Cue[];
  groups: Group[];
  cueItems: CueItem[];
}

export interface ProjectRow {
  id: string;
  name: string;
  updated_at: string;
}

export async function listProjects(): Promise<ProjectRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function loadProject(id: string): Promise<ProjectPayload> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('projects')
    .select('payload')
    .eq('id', id)
    .single();
  if (error) throw error;
  const payload = data?.payload as ProjectPayload | null;
  if (!payload) throw new Error('Project not found');
  return {
    cues: payload.cues ?? [],
    groups: payload.groups ?? [],
    cueItems: payload.cueItems ?? [],
  };
}

export async function saveProject(
  projectId: string | null,
  name: string,
  payload: ProjectPayload
): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const updated_at = new Date().toISOString();
  const row = projectId
    ? { id: projectId, user_id: user.id, name: name || 'Untitled', payload, updated_at }
    : { user_id: user.id, name: name || 'Untitled', payload, updated_at };

  const { data, error } = await supabase
    .from('projects')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single();
  if (error) throw error;
  return (data?.id as string) ?? projectId ?? '';
}
