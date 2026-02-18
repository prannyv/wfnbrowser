// Tab with our custom metadata
export interface ExtendedTab extends chrome.tabs.Tab {
  lastActiveAt?: number;
  createdAt?: number;
  spaceId?: string;
}

// Window with metadata
export interface ExtendedWindow {
  id: number;
  focused: boolean;
  tabIds: number[];
}

export interface SpaceRule {
  type: 'domain' | 'keyword' | 'regex';
  pattern: string;
  priority: number;
}

// Space/Workspace
export interface Space {
  id: string;
  name: string;
  color: string;
  icon?: string;
  tabIds: number[];
  rules: SpaceRule[];
  createdAt: number;
  lastAccessedAt: number;
}

// Core state managed by TabEngine
export interface TabState {
  tabs: Map<number, ExtendedTab>;
  windows: Map<number, ExtendedWindow>;
  activeTabId: number | null;
  activeWindowId: number | null;
  lastUpdated: number;
}

// Serializable version for storage/messaging
export interface SerializedTabState {
  tabs: ExtendedTab[];
  windows: ExtendedWindow[];
  activeTabId: number | null;
  activeWindowId: number | null;
  lastUpdated: number;
}

// App state for UI
export interface AppState {
  tabs: ExtendedTab[];
  spaces: Space[];
  activeSpaceId: string;
  activeTabId: number | null;
  activeWindowId: number | null;
  isLoading: boolean;
}

// User settings
export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  compactMode: boolean;
  autoAssignSpaces: boolean;
  staleTabThresholdDays: number;
}

// Persisted state shape
export interface PersistedState {
  spaces: Space[];
  settings: UserSettings;
  tabMetadata: Record<number, { spaceId?: string; lastActiveAt?: number; createdAt?: number; }>;
}
