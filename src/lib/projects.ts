import type { Cue, Group, CueItem, Section } from './types';
import { supabase } from './supabase';

export interface ProjectPayload {
  cues: Cue[];
  sections: Section[];
  /** Legacy: for loading old projects only; not written. */
  groups?: Group[];
  cueItems?: CueItem[];
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
  const cues = payload.cues ?? [];
  const sections = payload.sections ?? [];
  const groups = payload.groups ?? [];
  const cueItems = payload.cueItems ?? [];
  if (sections.length === 0 && (groups.length > 0 || cueItems.length > 0)) {
    const migrated = migrateGroupsToSections(groups, cueItems as LegacyCueItem[]);
    return { cues, sections: migrated };
  }
  return { cues, sections: sections.length ? sections : [{ id: `sec-${Date.now()}`, name: 'Main', cueIds: [] }] };
}

type LegacyCueItem = { type: 'single'; id: string } | { type: 'group'; id: string };

function migrateGroupsToSections(groups: Group[], cueItems: LegacyCueItem[]): Section[] {
  const result: Section[] = [];
  const defaultSection: Section = { id: `sec-${Date.now()}`, name: 'Main', cueIds: [] };
  for (const item of cueItems) {
    if (item.type === 'group') {
      const g = groups.find((x) => x.id === item.id);
      if (g?.cueIds?.length) {
        result.push({ id: g.id, name: g.name, collapsed: g.collapsed, cueIds: [...g.cueIds] });
      }
    } else {
      defaultSection.cueIds.push(item.id);
    }
  }
  if (defaultSection.cueIds.length > 0 || result.length === 0) result.unshift(defaultSection);
  return result;
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

export async function deleteProject(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
