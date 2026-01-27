import type { ExtendedTab, ExtendedWindow, TabState, SerializedTabState } from '@/types';
import { broadcastMessage } from './messages';

type StateChangeCallback = (state: SerializedTabState) => void;

/**
 * TabEngine - Core engine that keeps extension state in sync with Chrome's actual tabs.
 * 
 * Responsibilities:
 * - Listen to all tab events (onCreated, onRemoved, onUpdated, onActivated, onMoved)
 * - Listen to window events (onCreated, onRemoved, onFocusChanged)
 * - Maintain internal tab list that mirrors Chrome's state
 * - Handle edge cases (tabs created before extension loads, multiple windows)
 * - Debounce rapid updates (e.g., page loading triggers many onUpdated)
 */
export class TabEngine {
  private state: TabState;
  private subscribers: Set<StateChangeCallback> = new Set();
  private updateDebounceTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_MS = 100;
  private initialized = false;
  
  // Cache for serialized state to avoid recreating arrays on every read
  private serializedStateCache: SerializedTabState | null = null;
  private cacheLastUpdated: number = 0;

  constructor() {
    this.state = {
      tabs: new Map(),
      windows: new Map(),
      activeTabId: null,
      activeWindowId: null,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Initialize the engine - load current Chrome state and attach listeners
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('[TabEngine] Initializing...');
    
    // Load current state from Chrome
    await this.syncWithChrome();
    
    // Attach event listeners
    this.attachTabListeners();
    this.attachWindowListeners();
    
    this.initialized = true;
    console.log('[TabEngine] Initialized with', this.state.tabs.size, 'tabs');
  }

  /**
   * Sync internal state with Chrome's actual state
   * Handles edge case: tabs created before extension loads
   */
  async syncWithChrome(): Promise<void> {
    // Get all windows
    const windows = await chrome.windows.getAll({ populate: true });
    
    // Clear current state
    this.state.tabs.clear();
    this.state.windows.clear();
    
    // Get focused window
    const focusedWindow = windows.find(w => w.focused);
    this.state.activeWindowId = focusedWindow?.id ?? null;
    
    // Process each window and its tabs
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
          
          // Track active tab
          if (tab.active && window.focused) {
            this.state.activeTabId = tab.id;
          }
        }
      }
      
      const extendedWindow: ExtendedWindow = {
        id: window.id,
        focused: window.focused ?? false,
        tabIds,
      };
      
      this.state.windows.set(window.id, extendedWindow);
    }
    
    this.state.lastUpdated = Date.now();
    this.notifySubscribers();
  }

  /**
   * Attach tab event listeners
   */
  private attachTabListeners(): void {
    // Tab created
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id === undefined) return;
      console.log('[TabEngine] Tab created:', tab.id);
      
      const extendedTab: ExtendedTab = {
        ...tab,
        lastActiveAt: Date.now(),
      };
      
      this.state.tabs.set(tab.id, extendedTab);
      
      // Update window's tab list
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

    // Tab removed
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      console.log('[TabEngine] Tab removed:', tabId);
      
      // Clear any pending debounce timer for this tab
      const pendingTimer = this.updateDebounceTimers.get(tabId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.updateDebounceTimers.delete(tabId);
      }
      
      this.state.tabs.delete(tabId);
      
      // Update window's tab list
      const window = this.state.windows.get(removeInfo.windowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }
      
      // Clear active tab if it was removed
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

    // Tab updated (debounced - page loads trigger many updates)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Debounce rapid updates
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

    // Tab activated
    chrome.tabs.onActivated.addListener((activeInfo) => {
      console.log('[TabEngine] Tab activated:', activeInfo.tabId);
      
      // Update lastActiveAt on the newly active tab
      const tab = this.state.tabs.get(activeInfo.tabId);
      if (tab) {
        tab.lastActiveAt = Date.now();
        this.state.tabs.set(activeInfo.tabId, tab);
      }
      
      this.state.activeTabId = activeInfo.tabId;
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
      
      broadcastMessage({
        type: 'TAB_ACTIVATED',
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
      });
    });

    // Tab moved
    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
      console.log('[TabEngine] Tab moved:', tabId, moveInfo);
      
      // Update window's tab list order
      const window = this.state.windows.get(moveInfo.windowId);
      if (window) {
        // Remove from old position and insert at new position
        window.tabIds = window.tabIds.filter(id => id !== tabId);
        window.tabIds.splice(moveInfo.toIndex, 0, tabId);
      }
      
      // Update tab's index
      const tab = this.state.tabs.get(tabId);
      if (tab) {
        tab.index = moveInfo.toIndex;
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

    // Tab attached (moved to different window)
    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
      console.log('[TabEngine] Tab attached:', tabId, attachInfo);
      
      const tab = this.state.tabs.get(tabId);
      if (tab) {
        // Update tab's window
        tab.windowId = attachInfo.newWindowId;
        tab.index = attachInfo.newPosition;
        this.state.tabs.set(tabId, tab);
      }
      
      // Add to new window's tab list
      const window = this.state.windows.get(attachInfo.newWindowId);
      if (window) {
        window.tabIds.splice(attachInfo.newPosition, 0, tabId);
      }
      
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
    });

    // Tab detached (being moved to different window)
    chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
      console.log('[TabEngine] Tab detached:', tabId, detachInfo);
      
      // Remove from old window's tab list
      const window = this.state.windows.get(detachInfo.oldWindowId);
      if (window) {
        window.tabIds = window.tabIds.filter(id => id !== tabId);
      }
      
      this.state.lastUpdated = Date.now();
    });
  }

  /**
   * Handle debounced tab update
   */
  private handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void {
    // Only process meaningful changes
    const meaningfulChanges = ['status', 'title', 'url', 'favIconUrl', 'pinned', 'audible', 'mutedInfo'];
    const hasMeaningfulChange = meaningfulChanges.some(key => key in changeInfo);
    
    if (!hasMeaningfulChange) return;
    
    console.log('[TabEngine] Tab updated:', tabId, Object.keys(changeInfo));
    
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

  /**
   * Attach window event listeners
   */
  private attachWindowListeners(): void {
    // Window created
    chrome.windows.onCreated.addListener(async (window) => {
      if (window.id === undefined) return;
      console.log('[TabEngine] Window created:', window.id);
      
      const extendedWindow: ExtendedWindow = {
        id: window.id,
        focused: window.focused ?? false,
        tabIds: [],
      };
      
      this.state.windows.set(window.id, extendedWindow);
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
      
      broadcastMessage({
        type: 'WINDOW_CREATED',
        windowId: window.id,
      });
    });

    // Window removed
    chrome.windows.onRemoved.addListener((windowId) => {
      console.log('[TabEngine] Window removed:', windowId);
      
      // Remove all tabs belonging to this window
      const window = this.state.windows.get(windowId);
      if (window) {
        for (const tabId of window.tabIds) {
          this.state.tabs.delete(tabId);
        }
      }
      
      this.state.windows.delete(windowId);
      
      // Clear active window if it was removed
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

    // Window focus changed
    chrome.windows.onFocusChanged.addListener((windowId) => {
      // windowId is -1 when Chrome loses focus
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      
      // Skip if already focused on this window
      if (this.state.activeWindowId === windowId) return;
      
      console.log('[TabEngine] Window focused:', windowId);
      
      // Only update the previously focused and newly focused windows (not all)
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

  /**
   * Get serialized state for storage/messaging (cached)
   */
  getSerializedState(): SerializedTabState {
    // Return cached version if state hasn't changed
    if (this.serializedStateCache && this.cacheLastUpdated === this.state.lastUpdated) {
      return this.serializedStateCache;
    }
    
    // Rebuild cache
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
  
  /**
   * Invalidate the serialized state cache (called when state changes)
   */
  private invalidateCache(): void {
    this.serializedStateCache = null;
  }

  /**
   * Get tabs for a specific window
   */
  getTabsForWindow(windowId: number): ExtendedTab[] {
    const window = this.state.windows.get(windowId);
    if (!window) return [];
    
    return window.tabIds
      .map(id => this.state.tabs.get(id))
      .filter((tab): tab is ExtendedTab => tab !== undefined)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  /**
   * Get all tabs
   */
  getAllTabs(): ExtendedTab[] {
    return Array.from(this.state.tabs.values());
  }

  /**
   * Get a specific tab
   */
  getTab(tabId: number): ExtendedTab | undefined {
    return this.state.tabs.get(tabId);
  }

  /**
   * Update tab metadata (spaceId, etc.)
   */
  updateTabMetadata(tabId: number, metadata: Partial<Pick<ExtendedTab, 'spaceId' | 'lastActiveAt'>>): void {
    const tab = this.state.tabs.get(tabId);
    if (tab) {
      Object.assign(tab, metadata);
      this.state.tabs.set(tabId, tab);
      this.state.lastUpdated = Date.now();
      this.notifySubscribers();
    }
  }

  /**
   * Get active tab ID
   */
  getActiveTabId(): number | null {
    return this.state.activeTabId;
  }

  /**
   * Get active window ID
   */
  getActiveWindowId(): number | null {
    return this.state.activeWindowId;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateChangeCallback): () => void {
    this.subscribers.add(callback);
    // Immediately call with current state
    callback(this.getSerializedState());
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(): void {
    const state = this.getSerializedState();
    for (const callback of this.subscribers) {
      callback(state);
    }
  }

  /**
   * Cleanup - remove all listeners
   */
  destroy(): void {
    // Clear debounce timers
    for (const timer of this.updateDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();
    this.subscribers.clear();
    // Note: Chrome doesn't provide a way to remove anonymous listeners
    // In practice, service workers are replaced on update anyway
  }
}

// Singleton instance
let engineInstance: TabEngine | null = null;

export function getTabEngine(): TabEngine {
  if (!engineInstance) {
    engineInstance = new TabEngine();
  }
  return engineInstance;
}

