// Typed wrappers around Chrome APIs for cleaner usage

export const tabs = {
  getAll: () => chrome.tabs.query({}),
  
  getCurrent: () => chrome.tabs.query({ active: true, currentWindow: true }),
  
  switchTo: async (tabId: number, windowId: number) => {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  },
  
  close: (tabId: number) => chrome.tabs.remove(tabId),
  
  create: (url?: string) => chrome.tabs.create({ url }),
  
  pin: (tabId: number, pinned: boolean) => 
    chrome.tabs.update(tabId, { pinned }),
  
  move: (tabId: number, index: number) => 
    chrome.tabs.move(tabId, { index }),
};

export const storage = {
  get: <T>(key: string): Promise<T | undefined> =>
    chrome.storage.local.get(key).then((result) => result[key]),
  
  set: <T>(key: string, value: T): Promise<void> =>
    chrome.storage.local.set({ [key]: value }),
  
  remove: (key: string): Promise<void> =>
    chrome.storage.local.remove(key),
};

export const sidePanel = {
  open: (windowId: number) => 
    chrome.sidePanel.open({ windowId }),
  
  setOptions: (options: chrome.sidePanel.PanelOptions) =>
    chrome.sidePanel.setOptions(options),
};

