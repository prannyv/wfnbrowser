import type { ExtendedTab, ExtendedWindow, SerializedTabState } from '@/types';
import { broadcastMessage } from '@/lib/messages';
import { getStateManager } from '@/lib/storage';

class TabEngine {
  private tabs: Map<number, ExtendedTab> = new Map();
  private windows: Map<number, ExtendedWindow> = new Map();
  private activeTabId: number | null = null;
  private activeWindowId: number | null = null;
  private lastUpdated = Date.now();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const chromeWindows = await chrome.windows.getAll({ populate: true });

    for (const win of chromeWindows) {
      if (win.id === undefined) continue;
      const tabIds: number[] = [];
      for (const tab of win.tabs ?? []) {
        if (tab.id === undefined) continue;
        this.tabs.set(tab.id, { ...tab });
        tabIds.push(tab.id);
        if (tab.active) {
          this.activeTabId = tab.id;
          this.activeWindowId = win.id;
        }
      }
      this.windows.set(win.id, {
        id: win.id,
        focused: Boolean(win.focused),
        tabIds,
      });
    }

    if (this.activeWindowId === null) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab?.id !== undefined && activeTab.windowId !== undefined) {
        this.activeTabId = activeTab.id;
        this.activeWindowId = activeTab.windowId;
      }
    }

    this.registerListeners();
    this.initialized = true;
  }

  getSerializedState(): SerializedTabState {
    return {
      tabs: Array.from(this.tabs.values()),
      windows: Array.from(this.windows.values()),
      activeTabId: this.activeTabId,
      activeWindowId: this.activeWindowId,
      lastUpdated: this.lastUpdated,
    };
  }

  getTabsForWindow(windowId: number): ExtendedTab[] {
    return Array.from(this.tabs.values()).filter(tab => tab.windowId === windowId);
  }

  getAllTabs(): ExtendedTab[] {
    return Array.from(this.tabs.values());
  }

  getActiveWindowId(): number | null {
    return this.activeWindowId;
  }

  getTab(tabId: number): ExtendedTab | undefined {
    return this.tabs.get(tabId);
  }

  updateTabMetadata(tabId: number, data: { spaceId?: string; lastActiveAt?: number }): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.tabs.set(tabId, { ...tab, ...data });
    this.bumpLastUpdated();
  }

  private registerListeners(): void {
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id === undefined || tab.windowId === undefined) return;
      this.tabs.set(tab.id, { ...tab });
      this.ensureWindow(tab.windowId).tabIds.push(tab.id);
      this.bumpLastUpdated();
      broadcastMessage({ type: 'TAB_CREATED', tab: { ...tab }, windowId: tab.windowId });
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.tabs.delete(tabId);
      const window = this.windows.get(removeInfo.windowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }
      if (this.activeTabId === tabId) {
        this.activeTabId = null;
      }
      this.bumpLastUpdated();
      broadcastMessage({ type: 'TAB_REMOVED', tabId, windowId: removeInfo.windowId });
    });

    chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      if (tab.windowId === undefined) return;
      const existing = this.tabs.get(tabId) ?? { ...tab };
      this.tabs.set(tabId, { ...existing, ...tab });
      this.bumpLastUpdated();
      broadcastMessage({ type: 'TAB_UPDATED', tab: { ...this.tabs.get(tabId)! } });
    });

    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
      const window = this.windows.get(moveInfo.windowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
        window.tabIds.splice(moveInfo.toIndex, 0, tabId);
      }
      const tab = this.tabs.get(tabId);
      if (tab) {
        this.tabs.set(tabId, { ...tab, index: moveInfo.toIndex, windowId: moveInfo.windowId });
      }
      this.bumpLastUpdated();
      broadcastMessage({
        type: 'TAB_MOVED',
        tabId,
        fromIndex: moveInfo.fromIndex,
        toIndex: moveInfo.toIndex,
        windowId: moveInfo.windowId,
      });
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.activeTabId = activeInfo.tabId;
      this.activeWindowId = activeInfo.windowId;

      const timestamp = Date.now();
      const tab = this.tabs.get(activeInfo.tabId);
      if (tab) {
        this.tabs.set(activeInfo.tabId, { ...tab, lastActiveAt: timestamp });
      }
      getStateManager().setTabMetadata(activeInfo.tabId, { lastActiveAt: timestamp });

      this.bumpLastUpdated();
      broadcastMessage({
        type: 'TAB_ACTIVATED',
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
      });
    });

    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
      const window = this.ensureWindow(attachInfo.newWindowId);
      window.tabIds.splice(attachInfo.newPosition, 0, tabId);

      const tab = this.tabs.get(tabId);
      if (tab) {
        this.tabs.set(tabId, { ...tab, windowId: attachInfo.newWindowId, index: attachInfo.newPosition });
      }
      this.bumpLastUpdated();
    });

    chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
      const window = this.windows.get(detachInfo.oldWindowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }
      this.bumpLastUpdated();
    });

    chrome.windows.onCreated.addListener((window) => {
      if (window.id === undefined) return;
      this.windows.set(window.id, {
        id: window.id,
        focused: Boolean(window.focused),
        tabIds: (window.tabs ?? []).map(tab => tab.id).filter((id): id is number => id !== undefined),
      });
      this.bumpLastUpdated();
      broadcastMessage({ type: 'WINDOW_CREATED', windowId: window.id });
    });

    chrome.windows.onRemoved.addListener((windowId) => {
      this.windows.delete(windowId);
      if (this.activeWindowId === windowId) {
        this.activeWindowId = null;
      }
      this.bumpLastUpdated();
      broadcastMessage({ type: 'WINDOW_REMOVED', windowId });
    });

    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      this.activeWindowId = windowId;
      const window = this.windows.get(windowId);
      if (window) {
        window.focused = true;
      }
      this.bumpLastUpdated();
      broadcastMessage({ type: 'WINDOW_FOCUSED', windowId });
    });
  }

  private ensureWindow(windowId: number): ExtendedWindow {
    const existing = this.windows.get(windowId);
    if (existing) return existing;
    const created = { id: windowId, focused: false, tabIds: [] };
    this.windows.set(windowId, created);
    return created;
  }

  private bumpLastUpdated(): void {
    this.lastUpdated = Date.now();
  }
}

let tabEngineInstance: TabEngine | null = null;

export function getTabEngine(): TabEngine {
  if (!tabEngineInstance) {
    tabEngineInstance = new TabEngine();
  }
  return tabEngineInstance;
}
