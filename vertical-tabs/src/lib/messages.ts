import type { ExtendedTab, Space, AppState } from '@/types';

// Messages from UI to Service Worker
export type UIMessage =
  | { type: 'GET_STATE' }
  | { type: 'GET_ALL_TABS' }
  | { type: 'SWITCH_TAB'; tabId: number; windowId: number }
  | { type: 'CLOSE_TAB'; tabId: number }
  | { type: 'PIN_TAB'; tabId: number; pinned: boolean }
  | { type: 'CREATE_TAB'; url?: string }
  | { type: 'MOVE_TAB'; tabId: number; spaceId: string };

// Messages from Service Worker to UI
export type BackgroundMessage =
  | { type: 'STATE_UPDATE'; state: Partial<AppState> }
  | { type: 'TAB_CREATED'; tab: ExtendedTab }
  | { type: 'TAB_REMOVED'; tabId: number }
  | { type: 'TAB_UPDATED'; tab: ExtendedTab }
  | { type: 'TAB_ACTIVATED'; tabId: number; windowId: number };

export type Message = UIMessage | BackgroundMessage;

// Type-safe message sender
export async function sendMessage<T = void>(message: UIMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

// Type-safe message listener
export function onMessage(
  callback: (message: BackgroundMessage) => void
): () => void {
  const listener = (message: Message) => {
    callback(message as BackgroundMessage);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

