export type ModuleGroup = 'system' | 'method' | 'analysis' | 'view';

/** The tabs of the module panel, in order. */
export const GROUPS: readonly { id: ModuleGroup; title: string }[] = [
  { id: 'system', title: 'System' },
  { id: 'method', title: 'Method' },
  { id: 'analysis', title: 'Analysis' },
  { id: 'view', title: 'View' },
];
