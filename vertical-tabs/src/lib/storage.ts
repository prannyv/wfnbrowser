import type { AppState, UserSettings, Space } from '@/types';

const STORAGE_KEYS = {
  STATE: 'app_state',
  SETTINGS: 'user_settings',
  SPACES: 'spaces',
} as const;

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accentColor: '#4a9eff',
  compactMode: false,
  autoAssignSpaces: true,
  staleTabThresholdDays: 7,
};

const DEFAULT_SPACE: Space = {
  id: 'default',
  name: 'All Tabs',
  color: '#4a9eff',
  tabIds: [],
  createdAt: Date.now(),
};

export async function loadSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function loadSpaces(): Promise<Space[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SPACES);
  const spaces = result[STORAGE_KEYS.SPACES] as Space[] | undefined;
  return spaces?.length ? spaces : [DEFAULT_SPACE];
}

export async function saveSpaces(spaces: Space[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SPACES]: spaces });
}

