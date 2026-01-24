import type { ExtendedTab } from '@/types';
import type { UIMessage, BackgroundMessage } from '@/lib/messages';

console.log('Service worker loaded');

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Helper to broadcast messages to UI contexts
function broadcastToUI(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open, that's expected
  });
}

// Tab event listeners
chrome.tabs.onCreated.addListener((tab) => {
  console.log('Tab created:', tab.id);
  broadcastToUI({ 
    type: 'TAB_CREATED', 
    tab: { ...tab, lastActiveAt: Date.now() } as ExtendedTab 
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('Tab removed:', tabId);
  broadcastToUI({ type: 'TAB_REMOVED', tabId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only broadcast on meaningful changes
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl) {
    console.log('Tab updated:', tabId, changeInfo);
    broadcastToUI({ 
      type: 'TAB_UPDATED', 
      tab: { ...tab, lastActiveAt: Date.now() } as ExtendedTab 
    });
  }
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  console.log('Tab activated:', tabId);
  broadcastToUI({ type: 'TAB_ACTIVATED', tabId, windowId });
});

// Handle messages from UI
chrome.runtime.onMessage.addListener(
  (message: UIMessage, _sender, sendResponse) => {
    console.log('Message received:', message.type);

    switch (message.type) {
      case 'GET_ALL_TABS':
        chrome.tabs.query({}).then((tabs) => {
          const extendedTabs: ExtendedTab[] = tabs.map((tab) => ({
            ...tab,
            lastActiveAt: Date.now(),
          }));
          sendResponse(extendedTabs);
        });
        return true; // Keep channel open for async response

      case 'SWITCH_TAB':
        chrome.tabs.update(message.tabId, { active: true });
        chrome.windows.update(message.windowId, { focused: true });
        break;

      case 'CLOSE_TAB':
        chrome.tabs.remove(message.tabId);
        break;

      case 'PIN_TAB':
        chrome.tabs.update(message.tabId, { pinned: message.pinned });
        break;

      case 'CREATE_TAB':
        chrome.tabs.create({ url: message.url });
        break;
    }

    return false;
  }
);

// Log when extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    // First install - could trigger onboarding here
    console.log('First install - welcome!');
  }
});

