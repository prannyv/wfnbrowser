// Tab with our custom metadata
export interface ExtendedTab extends chrome.tabs.Tab {
  lastActiveAt?: number;
  spaceId?: string;
}

// Space/Workspace
export interface Space {
  id: string;
  name: string;
  color: string;
  icon?: string;
  tabIds: number[];
  createdAt: number;
}

// App state
export interface AppState {
  tabs: ExtendedTab[];
  spaces: Space[];
  activeSpaceId: string;
  activeTabId: number | null;
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

