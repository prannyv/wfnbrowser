import type { ExtendedTab, SerializedTabState, Space } from '@/types';

// ============================================
// Messages from UI to Service Worker
// ============================================
export type UIMessage =
  // State queries
  | { type: 'GET_STATE' }
  | { type: 'GET_TABS'; windowId?: number }
  | { type: 'SUBSCRIBE' }
  | { type: 'UNSUBSCRIBE' }
  // Tab actions
  | { type: 'SWITCH_TAB'; tabId: number; windowId: number }
  | { type: 'CLOSE_TAB'; tabId: number }
  | { type: 'CLOSE_TABS'; tabIds: number[] }
  | { type: 'PIN_TAB'; tabId: number; pinned: boolean }
  | { type: 'CREATE_TAB'; url?: string; windowId?: number }
  | { type: 'MOVE_TAB'; tabId: number; index: number; windowId?: number }
  | { type: 'RELOAD_TAB'; tabId: number }
  | { type: 'DUPLICATE_TAB'; tabId: number }
  | { type: 'MUTE_TAB'; tabId: number; muted: boolean }
  // Space actions
  | { type: 'ASSIGN_TAB_TO_SPACE'; tabId: number; spaceId: string }
  | { type: 'CREATE_SPACE'; name: string; color: string; icon?: string }
  | { type: 'DELETE_SPACE'; spaceId: string }
  | { type: 'RENAME_SPACE'; spaceId: string; name: string }
  | {
    type: 'UPDATE_SPACE';
    spaceId: string;
    updates: { name?: string; color?: string; icon?: string; rules?: Space['rules']; lastAccessedAt?: number };
  }
  | { type: 'SET_ACTIVE_SPACE'; spaceId: string };

// ============================================
// Messages from Service Worker to UI
// ============================================
export type BackgroundMessage =
  // Full state sync
  | { type: 'STATE_SYNC'; state: SerializedTabState; spaces: Space[] }
  // Incremental updates
  | { type: 'TAB_CREATED'; tab: ExtendedTab; windowId: number }
  | { type: 'TAB_REMOVED'; tabId: number; windowId: number }
  | { type: 'TAB_UPDATED'; tab: ExtendedTab }
  | { type: 'TAB_MOVED'; tabId: number; fromIndex: number; toIndex: number; windowId: number }
  | { type: 'TAB_ACTIVATED'; tabId: number; windowId: number }
  // Window events
  | { type: 'WINDOW_CREATED'; windowId: number }
  | { type: 'WINDOW_REMOVED'; windowId: number }
  | { type: 'WINDOW_FOCUSED'; windowId: number }
  // Space updates
  | { type: 'SPACES_UPDATED'; spaces: Space[] }
  // Side panel UI events
  | { type: 'SIDE_PANEL_CLOSING'; windowId: number };

export type Message = UIMessage | BackgroundMessage;

// ============================================
// Type-safe message utilities
// ============================================

// Send message to service worker and get response
export async function sendMessage<T = void>(message: UIMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

// Subscribe to messages from service worker
export function onMessage(
  callback: (message: BackgroundMessage) => void
): () => void {
  const listener = (message: Message) => {
    // Filter to only background messages
    if ('type' in message && isBackgroundMessage(message)) {
      callback(message);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

// Type guard for background messages
function isBackgroundMessage(message: Message): message is BackgroundMessage {
  const bgTypes = [
    'STATE_SYNC', 'TAB_CREATED', 'TAB_REMOVED', 'TAB_UPDATED',
    'TAB_MOVED', 'TAB_ACTIVATED', 'WINDOW_CREATED', 'WINDOW_REMOVED',
    'WINDOW_FOCUSED', 'SPACES_UPDATED', 'SIDE_PANEL_CLOSING'
  ];
  return bgTypes.includes(message.type);
}

// Broadcast message to all extension contexts
export function broadcastMessage(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No receivers - this is expected when side panel is closed
  });
}
