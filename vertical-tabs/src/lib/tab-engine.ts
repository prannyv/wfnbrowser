import type { ExtendedTab, TabState, SerializedTabState } from '@/types';
import { broadcastMessage } from '@/lib/messages';
import { getStateManager } from '@/lib/storage';

type StateChangeCallback = (state: SerializedTabState) => void;

class TabEngine {
  private state: TabState;
  private initialized = false;
  private subscribers: Set<StateChangeCallback> = new Set();
  private serializedStateCache: SerializedTabState | null = null;
  private cacheLastUpdated = 0;
  private updateDebounceTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_MS = 50;

  constructor() {
    this.state = {
      tabs: new Map(),
      windows: new Map(),
      activeTabId: null,
      activeWindowId: null,
      lastUpdated: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[TabEngine] Initializing...');

    await this.syncWithChrome();
    this.attachTabListeners();
    this.attachWindowListeners();

    this.initialized = true;
    console.log('[TabEngine] Initialized with', this.state.tabs.size, 'tabs');
  }

  private async syncWithChrome(): Promise<void> {
    const windows = await chrome.windows.getAll({ populate: true });

    this.state.tabs.clear();
    this.state.windows.clear();

    const focusedWindow = windows.find(w => w.focused);
    this.state.activeWindowId = focusedWindow?.id ?? null;

    for (const window of windows) {
      if (window.id === undefined) continue;

      const tabIds: number[] = [];

      if (window.tabs) {
        for (const tab of window.tabs) {
          if (tab.id === undefined) continue;

          const extendedTab: ExtendedTab = {
            ...tab,
            lastActiveAt: tab.active ? Date.now() : undefined,
          };

          this.state.tabs.set(tab.id, extendedTab);
          tabIds.push(tab.id);

          if (tab.active && window.focused) {
            this.state.activeTabId = tab.id;
          }
        }
      }

      this.state.windows.set(window.id, {
        id: window.id,
        focused: window.focused ?? false,
        tabIds,
      });
    }

    this.state.lastUpdated = Date.now();
    this.notifySubscribers();
  }

  private attachTabListeners(): void {
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id === undefined) return;

      const extendedTab: ExtendedTab = {
        ...tab,
        lastActiveAt: Date.now(),
      };

      this.state.tabs.set(tab.id, extendedTab);

      if (tab.windowId !== undefined) {
        const window = this.state.windows.get(tab.windowId);
        if (window) {
          window.tabIds.push(tab.id);
        }
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'TAB_CREATED',
        tab: extendedTab,
        windowId: tab.windowId ?? -1,
      });
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      const pendingTimer = this.updateDebounceTimers.get(tabId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.updateDebounceTimers.delete(tabId);
      }

      this.state.tabs.delete(tabId);

      const window = this.state.windows.get(removeInfo.windowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }

      if (this.state.activeTabId === tabId) {
        this.state.activeTabId = null;
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'TAB_REMOVED',
        tabId,
        windowId: removeInfo.windowId,
      });
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const existingTimer = this.updateDebounceTimers.get(tabId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.handleTabUpdated(tabId, changeInfo, tab);
        this.updateDebounceTimers.delete(tabId);
      }, this.DEBOUNCE_MS);

      this.updateDebounceTimers.set(tabId, timer);
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      const timestamp = Date.now();
      const tab = this.state.tabs.get(activeInfo.tabId);
      if (tab) {
        tab.lastActiveAt = timestamp;
        this.state.tabs.set(activeInfo.tabId, tab);
      }
      getStateManager().setTabMetadata(activeInfo.tabId, { lastActiveAt: timestamp });

      this.state.activeTabId = activeInfo.tabId;
      this.state.activeWindowId = activeInfo.windowId;
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'TAB_ACTIVATED',
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
      });
    });

    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
      const window = this.state.windows.get(moveInfo.windowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
        window.tabIds.splice(moveInfo.toIndex, 0, tabId);
      }

      const tab = this.state.tabs.get(tabId);
      if (tab) {
        tab.index = moveInfo.toIndex;
        tab.windowId = moveInfo.windowId;
        this.state.tabs.set(tabId, tab);
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'TAB_MOVED',
        tabId,
        fromIndex: moveInfo.fromIndex,
        toIndex: moveInfo.toIndex,
        windowId: moveInfo.windowId,
      });
    });

    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
      const tab = this.state.tabs.get(tabId);
      if (tab) {
        tab.windowId = attachInfo.newWindowId;
        tab.index = attachInfo.newPosition;
        this.state.tabs.set(tabId, tab);
      }

      const window = this.state.windows.get(attachInfo.newWindowId);
      if (window) {
        window.tabIds.splice(attachInfo.newPosition, 0, tabId);
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
    });

    chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
      const window = this.state.windows.get(detachInfo.oldWindowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
    });
  }

  private handleTabUpdated(tabId: number, changeInfo: object, tab: chrome.tabs.Tab): void {
    const meaningfulChanges = ['status', 'title', 'url', 'favIconUrl', 'pinned', 'audible', 'mutedInfo'];
    const hasMeaningfulChange = meaningfulChanges.some(key => key in changeInfo);

    if (!hasMeaningfulChange) return;

    const existingTab = this.state.tabs.get(tabId);
    const extendedTab: ExtendedTab = {
      ...tab,
      lastActiveAt: existingTab?.lastActiveAt,
      spaceId: existingTab?.spaceId,
    };

    this.state.tabs.set(tabId, extendedTab);
    this.state.lastUpdated = Date.now();
    this.notifySubscribers();

    broadcastMessage({
      type: 'TAB_UPDATED',
      tab: extendedTab,
    });
  }

  private attachWindowListeners(): void {
    chrome.windows.onCreated.addListener((window) => {
      if (window.id === undefined) return;

      this.state.windows.set(window.id, {
        id: window.id,
        focused: window.focused ?? false,
        tabIds: [],
      });

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'WINDOW_CREATED',
        windowId: window.id,
      });
    });

    chrome.windows.onRemoved.addListener((windowId) => {
      const window = this.state.windows.get(windowId);
      if (window) {
        for (const tabId of window.tabIds) {
          this.state.tabs.delete(tabId);
        }
      }

      this.state.windows.delete(windowId);

      if (this.state.activeWindowId === windowId) {
        this.state.activeWindowId = null;
        this.state.activeTabId = null;
      }

      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'WINDOW_REMOVED',
        windowId,
      });
    });

    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      if (this.state.activeWindowId === windowId) return;

      const prevWindowId = this.state.activeWindowId;
      if (prevWindowId !== null) {
        const prevWindow = this.state.windows.get(prevWindowId);
        if (prevWindow) {
          prevWindow.focused = false;
        }
      }

      const newWindow = this.state.windows.get(windowId);
      if (newWindow) {
        newWindow.focused = true;
      }

      this.state.activeWindowId = windowId;
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();

      broadcastMessage({
        type: 'WINDOW_FOCUSED',
        windowId,
      });
    });
  }

  private notifySubscribers(): void {
    this.invalidateCache();
    const state = this.getSerializedState();
    for (const callback of this.subscribers) {
      callback(state);
    }
  }

  private invalidateCache(): void {
    this.serializedStateCache = null;
  }

  getSerializedState(): SerializedTabState {
    if (this.serializedStateCache && this.cacheLastUpdated === this.state.lastUpdated) {
      return this.serializedStateCache;
    }

    this.serializedStateCache = {
      tabs: Array.from(this.state.tabs.values()),
      windows: Array.from(this.state.windows.values()),
      activeTabId: this.state.activeTabId,
      activeWindowId: this.state.activeWindowId,
      lastUpdated: this.state.lastUpdated,
    };
    this.cacheLastUpdated = this.state.lastUpdated;

    return this.serializedStateCache;
  }

  getTabsForWindow(windowId: number): ExtendedTab[] {
    const window = this.state.windows.get(windowId);
    if (!window) return [];

    return window.tabIds
      .map(id => this.state.tabs.get(id))
      .filter((tab): tab is ExtendedTab => tab !== undefined)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  getAllTabs(): ExtendedTab[] {
    return Array.from(this.state.tabs.values());
  }

  getTab(tabId: number): ExtendedTab | undefined {
    return this.state.tabs.get(tabId);
  }

  updateTabMetadata(tabId: number, metadata: Partial<Pick<ExtendedTab, 'spaceId' | 'lastActiveAt'>>): void {
    const tab = this.state.tabs.get(tabId);
    if (tab) {
      Object.assign(tab, metadata);
      this.state.tabs.set(tabId, tab);
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
    }
  }

  getActiveTabId(): number | null {
    return this.state.activeTabId;
  }

  getActiveWindowId(): number | null {
    return this.state.activeWindowId;
  }

  subscribe(callback: StateChangeCallback): () => void {
    this.subscribers.add(callback);
    callback(this.getSerializedState());
    return () => this.subscribers.delete(callback);
  }
}

let tabEngineInstance: TabEngine | null = null;

export function getTabEngine(): TabEngine {
  if (!tabEngineInstance) {
    tabEngineInstance = new TabEngine();
  }
  return tabEngineInstance;
}
