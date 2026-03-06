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
  companion_code?: string;
}

/** Generate a 6-char code for Companion (same charset as controller). */
export function generateCompanionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function listProjects(): Promise<ProjectRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at, companion_code')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export interface LoadedProject extends ProjectPayload {
  companionCode: string;
}

export async function loadProject(id: string): Promise<LoadedProject> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('projects')
    .select('payload, companion_code')
    .eq('id', id)
    .single();
  if (error) throw error;
  const payload = data?.payload as ProjectPayload | null;
  const companionCode = (data?.companion_code as string) ?? '';
  if (!payload) throw new Error('Project not found');
  const cues = payload.cues ?? [];
  const sections = payload.sections ?? [];
  const groups = payload.groups ?? [];
  const cueItems = payload.cueItems ?? [];
  let resultSections = sections;
  if (sections.length === 0 && (groups.length > 0 || cueItems.length > 0)) {
    resultSections = migrateGroupsToSections(groups, cueItems as LegacyCueItem[]);
  } else if (!resultSections.length) {
    resultSections = [{ id: `sec-${Date.now()}`, name: 'Main', cueIds: [] }];
  }
  return { cues, sections: resultSections, companionCode: companionCode ?? '' };
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
): Promise<{ id: string; companionCode?: string }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const updated_at = new Date().toISOString();
  let row: Record<string, unknown>;

  if (projectId) {
    // Update: must include companion_code (NOT NULL). Fetch existing so we don't overwrite it.
    const { data: existing } = await supabase
      .from('projects')
      .select('companion_code')
      .eq('id', projectId)
      .single();
    const companion_code = (existing?.companion_code as string) ?? '';
    row = { id: projectId, user_id: user.id, name: name || 'Untitled', payload, updated_at, companion_code };
  } else {
    row = { user_id: user.id, name: name || 'Untitled', payload, updated_at, companion_code: generateCompanionCode() };
  }

  const { data, error } = await supabase
    .from('projects')
    .upsert(row, { onConflict: 'id' })
    .select('id, companion_code')
    .single();
  if (error) throw error;
  const id = (data?.id as string) ?? projectId ?? '';
  const companionCode = data?.companion_code as string | undefined;
  return { id, companionCode: companionCode ?? undefined };
}

export async function deleteProject(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
