import type { Space, UserSettings, PersistedState, SerializedTabState } from '@/types';

// ============================================
// Storage Keys
// ============================================
const STORAGE_KEYS = {
  PERSISTED_STATE: 'persisted_state',
  SETTINGS: 'user_settings',
  SPACES: 'spaces',
  TAB_METADATA: 'tab_metadata',
} as const;

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
  id: 'default',
  name: 'All Tabs',
  color: '#4a9eff',
  tabIds: [],
  createdAt: Date.now(),
};

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
  return spaces?.length ? spaces : [DEFAULT_SPACE];
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
    this.spaces = spaces;
    this.scheduleSave();
    this.notifyListeners();
  }

  /**
   * Update settings
   */
  setSettings(settings: UserSettings): void {
    this.settings = settings;
    this.scheduleSave();
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
   * Remove metadata for a tab (when tab is closed)
   */
  removeTabMetadata(tabId: number): void {
    delete this.tabMetadata[tabId];
    this.scheduleSave();
  }

  /**
   * Add space
   */
  addSpace(name: string, color: string): Space {
    const space: Space = {
      id: `space_${Date.now()}`,
      name,
      color,
      tabIds: [],
      createdAt: Date.now(),
    };
    this.spaces.push(space);
    this.scheduleSave();
    this.notifyListeners();
    return space;
  }

  /**
   * Remove space
   */
  removeSpace(spaceId: string): void {
    // Don't remove the default space
    if (spaceId === 'default') return;
    
    this.spaces = this.spaces.filter(s => s.id !== spaceId);
    
    // Move tabs from deleted space to default
    for (const tabId in this.tabMetadata) {
      if (this.tabMetadata[tabId]?.spaceId === spaceId) {
        this.tabMetadata[tabId].spaceId = 'default';
      }
    }
    
    this.scheduleSave();
    this.notifyListeners();
  }

  /**
   * Rename space
   */
  renameSpace(spaceId: string, name: string): void {
    const space = this.spaces.find(s => s.id === spaceId);
    if (space) {
      space.name = name;
      this.scheduleSave();
      this.notifyListeners();
    }
  }

  /**
   * Assign tab to space
   */
  assignTabToSpace(tabId: number, spaceId: string): void {
    this.tabMetadata[tabId] = { ...this.tabMetadata[tabId], spaceId };
    this.scheduleSave();
    this.notifyListeners();
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

  /**
   * Schedule a debounced save to storage
   */
  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
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
