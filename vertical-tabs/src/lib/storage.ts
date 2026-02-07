import type { Space, UserSettings, PersistedState } from '@/types';

// ============================================
// Storage Keys
// ============================================
const STORAGE_KEYS = {
  PERSISTED_STATE: 'persisted_state',
  SCHEMA_VERSION: 'schema_version',
  SETTINGS: 'user_settings',
  SPACES: 'spaces',
  TAB_METADATA: 'tab_metadata',
} as const;

const CURRENT_SCHEMA_VERSION = 2;
const DEFAULT_SPACE_ID = 'default';

// ============================================
// Default Values
// ============================================
const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accentColor: '#4a9eff',
  compactMode: false,
  autoAssignSpaces: true,
  staleTabThresholdDays: 7,
};

const DEFAULT_SPACE: Space = {
  id: DEFAULT_SPACE_ID,
  name: 'Default',
  color: '#4a9eff',
  tabIds: [],
  rules: [],
  createdAt: Date.now(),
  lastAccessedAt: Date.now(),
};

function normalizeSpaces(spaces?: Space[]): Space[] {
  const now = Date.now();
  const normalized = (spaces ?? []).map((space, index) => ({
    id: space.id || `space_${now}_${index}`,
    name: space.name || `Space ${index + 1}`,
    color: space.color || DEFAULT_SPACE.color,
    icon: space.icon,
    tabIds: Array.isArray(space.tabIds) ? space.tabIds : [],
    rules: Array.isArray(space.rules) ? space.rules : [],
    createdAt: typeof space.createdAt === 'number' ? space.createdAt : now,
    lastAccessedAt:
      typeof space.lastAccessedAt === 'number'
        ? space.lastAccessedAt
        : (typeof space.createdAt === 'number' ? space.createdAt : now),
  }));

  const hasDefault = normalized.some(space => space.id === DEFAULT_SPACE_ID);
  if (!hasDefault) {
    normalized.unshift({ ...DEFAULT_SPACE, createdAt: now, lastAccessedAt: now });
  }

  return normalized;
}

async function getSchemaVersion(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SCHEMA_VERSION);
  const stored = result[STORAGE_KEYS.SCHEMA_VERSION];
  return typeof stored === 'number' ? stored : 1;
}

async function setSchemaVersion(version: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SCHEMA_VERSION]: version });
}

async function migrateStorageIfNeeded(): Promise<void> {
  const currentVersion = await getSchemaVersion();
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  let nextVersion = currentVersion;

  if (nextVersion < 2) {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SPACES);
    const spaces = normalizeSpaces(result[STORAGE_KEYS.SPACES] as Space[] | undefined);
    await chrome.storage.local.set({ [STORAGE_KEYS.SPACES]: spaces });
    nextVersion = 2;
  }

  await setSchemaVersion(nextVersion);
}

// ============================================
// Settings
// ============================================
export async function loadSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

// ============================================
// Spaces
// ============================================
export async function loadSpaces(): Promise<Space[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SPACES);
  const spaces = result[STORAGE_KEYS.SPACES] as Space[] | undefined;
  const normalized = normalizeSpaces(spaces);
  if (!Array.isArray(spaces) || !spaces.some(space => space.id === DEFAULT_SPACE_ID)) {
    await saveSpaces(normalized);
  }
  return normalized.length ? normalized : [DEFAULT_SPACE];
}

export async function saveSpaces(spaces: Space[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SPACES]: spaces });
}

// ============================================
// Tab Metadata (persists across sessions)
// ============================================
export type TabMetadata = Record<number, { spaceId?: string; lastActiveAt?: number }>;

export async function loadTabMetadata(): Promise<TabMetadata> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TAB_METADATA);
  return result[STORAGE_KEYS.TAB_METADATA] || {};
}

export async function saveTabMetadata(metadata: TabMetadata): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.TAB_METADATA]: metadata });
}

export async function updateTabMetadata(
  tabId: number,
  data: { spaceId?: string; lastActiveAt?: number }
): Promise<void> {
  const metadata = await loadTabMetadata();
  metadata[tabId] = { ...metadata[tabId], ...data };
  await saveTabMetadata(metadata);
}

export async function removeTabMetadata(tabId: number): Promise<void> {
  const metadata = await loadTabMetadata();
  delete metadata[tabId];
  await saveTabMetadata(metadata);
}

// ============================================
// Full Persisted State
// ============================================
export async function loadPersistedState(): Promise<PersistedState> {
  await migrateStorageIfNeeded();
  const [settings, spaces, tabMetadata] = await Promise.all([
    loadSettings(),
    loadSpaces(),
    loadTabMetadata(),
  ]);

  return { settings, spaces, tabMetadata };
}

export async function savePersistedState(state: Partial<PersistedState>): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (state.settings) {
    updates[STORAGE_KEYS.SETTINGS] = state.settings;
  }
  if (state.spaces) {
    updates[STORAGE_KEYS.SPACES] = state.spaces;
  }
  if (state.tabMetadata) {
    updates[STORAGE_KEYS.TAB_METADATA] = state.tabMetadata;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// ============================================
// State Manager (coordinates persistence with debouncing)
// ============================================
export class StateManager {
  private spaces: Space[] = [DEFAULT_SPACE];
  private settings: UserSettings = DEFAULT_SETTINGS;
  private tabMetadata: TabMetadata = {};
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500;
  private initialized = false;
  private changeListeners: Set<() => void> = new Set();

  /**
   * Initialize state manager - load persisted state
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[StateManager] Loading persisted state...');
    const persisted = await loadPersistedState();

    this.spaces = persisted.spaces;
    this.settings = persisted.settings;
    this.tabMetadata = persisted.tabMetadata;
    this.rebuildSpaceTabIds();
    this.initialized = true;

    console.log('[StateManager] Loaded', this.spaces.length, 'spaces');
  }

  /**
   * Get current spaces
   */
  getSpaces(): Space[] {
    return this.spaces;
  }

  /**
   * Get current settings
   */
  getSettings(): UserSettings {
    return this.settings;
  }

  /**
   * Get tab metadata
   */
  getTabMetadata(): TabMetadata {
    return this.tabMetadata;
  }

  /**
   * Update spaces
   */
  setSpaces(spaces: Space[]): void {
    this.spaces = normalizeSpaces(spaces);
    this.scheduleSave({ immediate: true });
    this.notifyListeners();
  }

  /**
   * Update settings
   */
  setSettings(settings: UserSettings): void {
    this.settings = settings;
    this.scheduleSave({ immediate: true });
    this.notifyListeners();
  }

  /**
   * Update metadata for a specific tab
   */
  setTabMetadata(tabId: number, data: { spaceId?: string; lastActiveAt?: number }): void {
    this.tabMetadata[tabId] = { ...this.tabMetadata[tabId], ...data };
    this.scheduleSave();
  }

  /**
   * Add space
   */
  addSpace(name: string, color: string, icon?: string): Space {
    const space: Space = {
      id: `space_${Date.now()}`,
      name,
      color,
      icon,
      tabIds: [],
      rules: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    this.spaces.push(space);
    this.scheduleSave({ immediate: true });
    this.notifyListeners();
    return space;
  }

  /**
   * Remove space
   */
  removeSpace(spaceId: string): number[] {
    // Don't remove the default space
    if (spaceId === DEFAULT_SPACE_ID) return [];

    const defaultSpace = this.spaces.find(space => space.id === DEFAULT_SPACE_ID);
    const spaceToRemove = this.spaces.find(space => space.id === spaceId);
    if (!spaceToRemove || !defaultSpace) return [];

    const movedTabIds = new Set<number>();

    this.spaces = this.spaces.filter(s => s.id !== spaceId);

    // Move tabs from deleted space to default
    for (const tabId of spaceToRemove.tabIds) {
      if (!defaultSpace.tabIds.includes(tabId)) {
        defaultSpace.tabIds.push(tabId);
      }
      this.tabMetadata[tabId] = { ...this.tabMetadata[tabId], spaceId: DEFAULT_SPACE_ID };
      movedTabIds.add(tabId);
    }

    // Also migrate any metadata that referenced the deleted space
    for (const tabId in this.tabMetadata) {
      if (this.tabMetadata[tabId]?.spaceId === spaceId) {
        this.tabMetadata[tabId].spaceId = DEFAULT_SPACE_ID;
        const parsed = parseInt(tabId, 10);
        if (!defaultSpace.tabIds.includes(parsed)) {
          defaultSpace.tabIds.push(parsed);
        }
        if (!Number.isNaN(parsed)) {
          movedTabIds.add(parsed);
        }
      }
    }

    this.scheduleSave({ immediate: true });
    this.notifyListeners();
    return Array.from(movedTabIds);
  }

  /**
   * Rename space
   */
  renameSpace(spaceId: string, name: string): void {
    this.updateSpace(spaceId, { name });
  }

  /**
   * Update space properties
   */
  updateSpace(
    spaceId: string,
    updates: Partial<Pick<Space, 'name' | 'color' | 'icon' | 'rules' | 'lastAccessedAt'>>
  ): void {
    const space = this.spaces.find(s => s.id === spaceId);
    if (space) {
      Object.assign(space, updates);
      this.scheduleSave({ immediate: true });
      this.notifyListeners();
    }
  }

  /**
   * Assign tab to space
   */
  assignTabToSpace(tabId: number, spaceId: string): string {
    const previousSpaceId = this.tabMetadata[tabId]?.spaceId || DEFAULT_SPACE_ID;
    if (previousSpaceId === spaceId) return previousSpaceId;

    // Remove from previous space list
    const previousSpace = this.spaces.find(s => s.id === previousSpaceId);
    if (previousSpace) {
      previousSpace.tabIds = previousSpace.tabIds.filter(id => id !== tabId);
    }

    // Add to new space list
    const nextSpace =
      this.spaces.find(s => s.id === spaceId) || this.spaces.find(s => s.id === DEFAULT_SPACE_ID);
    const targetSpaceId = nextSpace?.id ?? DEFAULT_SPACE_ID;
    if (nextSpace && !nextSpace.tabIds.includes(tabId)) {
      nextSpace.tabIds.push(tabId);
    }

    this.tabMetadata[tabId] = { ...this.tabMetadata[tabId], spaceId: targetSpaceId };
    this.scheduleSave({ immediate: true });
    this.notifyListeners();
    return targetSpaceId;
  }

  /**
   * Remove metadata for a tab (when tab is closed)
   */
  removeTabMetadata(tabId: number): void {
    delete this.tabMetadata[tabId];
    for (const space of this.spaces) {
      space.tabIds = space.tabIds.filter(id => id !== tabId);
    }
    this.scheduleSave();
  }

  /**
   * Subscribe to changes
   */
  subscribe(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  /**
   * Notify listeners of changes
   */
  private notifyListeners(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private rebuildSpaceTabIds(): void {
    const spaceMap = new Map(this.spaces.map(space => [space.id, space]));
    for (const space of this.spaces) {
      space.tabIds = [];
    }

    let updatedMetadata = false;
    for (const [tabIdStr, metadata] of Object.entries(this.tabMetadata)) {
      const tabId = parseInt(tabIdStr, 10);
      if (Number.isNaN(tabId)) continue;

      const targetSpaceId = metadata.spaceId || DEFAULT_SPACE_ID;
      const space = spaceMap.get(targetSpaceId) || spaceMap.get(DEFAULT_SPACE_ID);
      if (!space) continue;

      if (!space.tabIds.includes(tabId)) {
        space.tabIds.push(tabId);
      }

      if (metadata.spaceId !== space.id) {
        this.tabMetadata[tabId] = { ...metadata, spaceId: space.id };
        updatedMetadata = true;
      }
    }

    if (updatedMetadata) {
      this.scheduleSave();
    }
  }

  /**
   * Schedule a debounced save to storage
   */
  private scheduleSave(options: { immediate?: boolean } = {}): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    if (options.immediate) {
      void savePersistedState({
        spaces: this.spaces,
        settings: this.settings,
        tabMetadata: this.tabMetadata,
      });
      return;
    }

    this.saveDebounceTimer = setTimeout(async () => {
      console.log('[StateManager] Persisting state...');
      await savePersistedState({
        spaces: this.spaces,
        settings: this.settings,
        tabMetadata: this.tabMetadata,
      });
      console.log('[StateManager] State persisted');
    }, this.SAVE_DEBOUNCE_MS);
  }
}

// Singleton instance
let stateManagerInstance: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!stateManagerInstance) {
    stateManagerInstance = new StateManager();
  }
  return stateManagerInstance;
}
