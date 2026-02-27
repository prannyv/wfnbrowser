import { getTabEngine } from '@/lib/tab-engine';
import { getStateManager } from '@/lib/storage';
import { broadcastMessage, type UIMessage } from '@/lib/messages';
import type { ExtendedTab } from '@/types';

console.log('[ServiceWorker] Loading...');

const DEFAULT_SPACE_ID = 'default';

// ============================================
// Initialize Core Systems
// ============================================
const tabEngine = getTabEngine();
const stateManager = getStateManager();
let hasRegisteredSpaceListeners = false;
let uiActiveSpaceId: string = DEFAULT_SPACE_ID;

// ============================================
// Tab Inactivity Tracking
// ============================================

function enrichTabWithMetadata(tab: ExtendedTab): ExtendedTab {
  const metadata = stateManager.getTabMetadata();
  const tabId = tab.id;
  const metadataEntry = tabId ? metadata[tabId] : undefined;

  return {
    ...tab,
    spaceId: metadataEntry?.spaceId ?? tab.spaceId,
    lastActiveAt: metadataEntry?.lastActiveAt ?? tab.lastActiveAt ?? tab.lastAccessed,
  };
}

function updateLastActive(tabId: number): void {
  const now = Date.now();

  stateManager.setTabMetadata(tabId, { lastActiveAt: now });

  tabEngine.updateTabMetadata(tabId, { lastActiveAt: now });

  const allTabs = tabEngine.getAllTabs();
  const found = allTabs.find(t => t.id === tabId);
  if (found) {
    broadcastMessage({
      type: 'TAB_UPDATED',
      tab: enrichTabWithMetadata(found),
    });
  }
}

async function initialize(): Promise<void> {
  console.log('[ServiceWorker] Initializing...');

  // Initialize state manager first (loads persisted state)
  await stateManager.initialize();

  // Initialize tab engine (syncs with Chrome)
  await tabEngine.initialize();

  // Seed lastActiveAt for the currently active tab on init
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      updateLastActive(activeTab.id);
    }
  } catch (e) {
    console.warn('[ServiceWorker] Could not seed lastActiveAt:', e);
  }
  
  // Apply persisted metadata to tabs
  const metadata = stateManager.getTabMetadata();
  for (const [tabIdStr, data] of Object.entries(metadata)) {
    const tabId = parseInt(tabIdStr, 10);
    if (data.spaceId || data.lastActiveAt) {
      tabEngine.updateTabMetadata(tabId, data);
    }
  }

  // Clean up metadata when tabs are removed (regardless of how they were closed)
  chrome.tabs.onRemoved.addListener((tabId) => {
    stateManager.removeTabMetadata(tabId);
  });

    // Update lastActiveAt whenever user activates a tab
  chrome.tabs.onActivated.addListener((activeInfo) => {
    updateLastActive(activeInfo.tabId);

    broadcastMessage({
      type: 'TAB_ACTIVATED',
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
    });
  });

  // When a window gains focus, mark its active tab as active "now"
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      if (activeTab?.id) {
        updateLastActive(activeTab.id);
      }
    } catch (e) {
      console.warn('[ServiceWorker] Failed to update lastActiveAt on window focus:', e);
    }
  });
  
  // Subscribe to state manager changes to broadcast to UI
  stateManager.subscribe(() => {
    broadcastMessage({
      type: 'SPACES_UPDATED',
      spaces: stateManager.getSpaces(),
    });
  });

  if (!hasRegisteredSpaceListeners) {
    chrome.tabs.onCreated.addListener((tab) => {
      if (tab.id === undefined) return;
      const metadata = stateManager.getTabMetadata();
      if (metadata[tab.id]?.spaceId) return;

      const targetSpaceId = uiActiveSpaceId === 'all' ? DEFAULT_SPACE_ID : uiActiveSpaceId;
      const assignedSpaceId = stateManager.assignTabToSpace(tab.id, targetSpaceId);
      tabEngine.updateTabMetadata(tab.id, { spaceId: assignedSpaceId });
      const updatedTab = tabEngine.getTab(tab.id);
      if (updatedTab) {
        broadcastMessage({
          type: 'TAB_UPDATED',
          tab: { ...updatedTab, spaceId: assignedSpaceId },
        });
      }
    });
    hasRegisteredSpaceListeners = true;
  }

  console.log('[ServiceWorker] Initialized');
}

// Track initialization state
let isInitialized = false;

// Initialize on load
initialize().then(() => { isInitialized = true; }).catch(console.error);

// ============================================
// Side Panel Toggle
// ============================================
const sidePanelToggleState = new Map<number, boolean>();

async function toggleSidePanel(windowId: number): Promise<void> {
  const currentState = sidePanelToggleState.get(windowId) || false;
  const newState = !currentState;
  sidePanelToggleState.set(windowId, newState);

  if (newState) {
    await chrome.sidePanel.open({ windowId });
  } else {
    try {
      // Notify UI so it can play a closing animation before the panel disappears
      broadcastMessage({
        type: 'SIDE_PANEL_CLOSING',
        windowId,
      });

      // Wait for the close animation to finish (must stay in sync with CSS)
      const CLOSE_ANIMATION_DURATION_MS = 140;
      await new Promise(resolve => setTimeout(resolve, CLOSE_ANIMATION_DURATION_MS));

      // Chrome doesn't support programmatic closing of side panels
      // Best we can do is toggle enabled state which may close it
      await chrome.sidePanel.setOptions({ enabled: false });
      setTimeout(async () => {
        await chrome.sidePanel.setOptions({ enabled: true });
      }, 100);
    } catch (error) {
      console.log('[ServiceWorker] Could not disable side panel:', error);
      await chrome.sidePanel.open({ windowId });
      sidePanelToggleState.set(windowId, true);
    }
  }
}

// Toggle side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await toggleSidePanel(tab.windowId);
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === '_execute_action') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await toggleSidePanel(tab.windowId);
    }
  }
});

// ============================================
// Message Handler
// ============================================
chrome.runtime.onMessage.addListener(
  (message: UIMessage, _sender, sendResponse) => {
    console.log('[ServiceWorker] Message received:', message.type);

    handleMessage(message, sendResponse);

    // Return true to keep channel open for async responses
    return true;
  }
);

async function handleMessage(
  message: UIMessage,
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    switch (message.type) {
      // ========== State Queries ==========
      case 'GET_STATE': {
        const state = tabEngine.getSerializedState();
        const spaces = stateManager.getSpaces();
        sendResponse({ state, spaces });
        break;
      }

      case 'GET_TABS': {
        const windowId = message.windowId;
        let tabs: ExtendedTab[];

        if (windowId !== undefined) {
          tabs = tabEngine.getTabsForWindow(windowId);
        } else {
          // Get tabs for current window
          const activeWindowId = tabEngine.getActiveWindowId();
          if (activeWindowId !== null) {
            tabs = tabEngine.getTabsForWindow(activeWindowId);
          } else {
            tabs = tabEngine.getAllTabs();
          }
        }

        // Enrich with metadata
        const metadata = stateManager.getTabMetadata();
        tabs = tabs.map(tab => ({
          ...tab,
          spaceId: tab.id ? (metadata[tab.id]?.spaceId ?? tab.spaceId) : tab.spaceId,
          lastActiveAt: tab.id
            ? (metadata[tab.id]?.lastActiveAt ?? tab.lastActiveAt ?? tab.lastAccessed)
            : (tab.lastActiveAt ?? tab.lastAccessed),
        }));

        sendResponse(tabs);
        break;
      }

      case 'SUBSCRIBE': {
        // Send current state immediately
        const state = tabEngine.getSerializedState();
        const spaces = stateManager.getSpaces();
        broadcastMessage({ type: 'STATE_SYNC', state, spaces });
        sendResponse({ success: true });
        break;
      }

      case 'UNSUBSCRIBE': {
        sendResponse({ success: true });
        break;
      }

      // ========== Tab Actions ==========
      case 'SWITCH_TAB': {
        await chrome.tabs.update(message.tabId, { active: true });
        await chrome.windows.update(message.windowId, { focused: true });
        sendResponse({ success: true });
        break;
      }

      case 'CLOSE_TAB': {
        await chrome.tabs.remove(message.tabId);
        stateManager.removeTabMetadata(message.tabId);
        sendResponse({ success: true });
        break;
      }

      case 'CLOSE_TABS': {
        await chrome.tabs.remove(message.tabIds);
        for (const tabId of message.tabIds) {
          stateManager.removeTabMetadata(tabId);
        }
        sendResponse({ success: true });
        break;
      }

      case 'PIN_TAB': {
        // If pinning, check the limit first
        if (message.pinned) {
          const allTabs = await chrome.tabs.query({});
          const pinnedCount = allTabs.filter(t => t.pinned).length;

          if (pinnedCount >= 6) {
            sendResponse({ success: false, error: 'Maximum 6 pinned tabs allowed' });
            break;
          }
        }

        await chrome.tabs.update(message.tabId, { pinned: message.pinned });
        sendResponse({ success: true });
        break;
      }

      case 'CREATE_TAB': {
        const options: chrome.tabs.CreateProperties = {};
        if (message.url) options.url = message.url;
        if (message.windowId) options.windowId = message.windowId;

        const tab = await chrome.tabs.create(options);
        sendResponse({ success: true, tabId: tab.id });
        break;
      }

      case 'MOVE_TAB': {
        const moveOptions: chrome.tabs.MoveProperties = { index: message.index };
        if (message.windowId) moveOptions.windowId = message.windowId;

        await chrome.tabs.move(message.tabId, moveOptions);
        sendResponse({ success: true });
        break;
      }

      case 'RELOAD_TAB': {
        await chrome.tabs.reload(message.tabId);
        sendResponse({ success: true });
        break;
      }

      case 'DUPLICATE_TAB': {
        const newTab = await chrome.tabs.duplicate(message.tabId);
        sendResponse({ success: true, tabId: newTab?.id });
        break;
      }

      case 'MUTE_TAB': {
        await chrome.tabs.update(message.tabId, { muted: message.muted });
        sendResponse({ success: true });
        break;
      }

      // ========== Space Actions ==========
      case 'ASSIGN_TAB_TO_SPACE': {
        const assignedSpaceId = stateManager.assignTabToSpace(message.tabId, message.spaceId);
        tabEngine.updateTabMetadata(message.tabId, { spaceId: assignedSpaceId });
        const updatedTab = tabEngine.getTab(message.tabId);
        if (updatedTab) {
          broadcastMessage({
            type: 'TAB_UPDATED',
            tab: { ...updatedTab, spaceId: assignedSpaceId },
          });
        }
        sendResponse({ success: true });
        break;
      }

      case 'CREATE_SPACE': {
        const space = stateManager.addSpace(message.name, message.color, message.icon);
        sendResponse({ success: true, space });
        break;
      }

      case 'DELETE_SPACE': {
        const movedTabIds = stateManager.removeSpace(message.spaceId);
        for (const tabId of movedTabIds) {
          tabEngine.updateTabMetadata(tabId, { spaceId: DEFAULT_SPACE_ID });
          const updatedTab = tabEngine.getTab(tabId);
          if (updatedTab) {
            broadcastMessage({
              type: 'TAB_UPDATED',
              tab: { ...updatedTab, spaceId: DEFAULT_SPACE_ID },
            });
          }
        }
        sendResponse({ success: true });
        break;
      }

      case 'RENAME_SPACE': {
        stateManager.renameSpace(message.spaceId, message.name);
        sendResponse({ success: true });
        break;
      }

      case 'UPDATE_SPACE': {
        stateManager.updateSpace(message.spaceId, message.updates);
        sendResponse({ success: true });
        break;
      }

      case 'SET_ACTIVE_SPACE': {
        uiActiveSpaceId = message.spaceId;
        sendResponse({ success: true });
        break;
      }

      default: {
        console.warn('[ServiceWorker] Unknown message type:', (message as { type: string }).type);
        sendResponse({ error: 'Unknown message type' });
      }
    }
  } catch (error) {
    console.error('[ServiceWorker] Error handling message:', error);
    sendResponse({ error: String(error) });
  }
}

// ============================================
// Extension Lifecycle
// ============================================
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ServiceWorker] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('[ServiceWorker] First install - welcome!');
  }
});

// Handle service worker activation (restart after idle)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Browser started');
  if (!isInitialized) {
    console.log('[ServiceWorker] Re-initializing...');
    await initialize();
    isInitialized = true;
  }
});

console.log('[ServiceWorker] Loaded');
