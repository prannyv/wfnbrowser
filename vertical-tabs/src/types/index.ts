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

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  savedAt: number;
}

// Space/Workspace
export interface Space {
  id: string;
  name: string;
  color: string;
  icon?: string;
  tabIds: number[];
  rules: SpaceRule[];
  /** When true the auto-assigner will skip this space when scoring new tabs */
  autoAssignDisabled?: boolean;
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
  /** Minimum score [0-1] required to auto-assign a tab. Defaults to 0.45 */
  similarityThreshold: number;
  staleTabThresholdDays: number;
  useNativeReadingList: boolean;
}

// Persisted state shape
export interface PersistedState {
  spaces: Space[];
  settings: UserSettings;
  tabMetadata: Record<number, { spaceId?: string; lastActiveAt?: number; createdAt?: number; domain?: string; subdomains?: string[]; keywords?: string[]; autoAssigned?: boolean; }>;
  savedItems: SavedItem[];
}
