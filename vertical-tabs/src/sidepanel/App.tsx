import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ExtendedTab } from '@/types';
import { sendMessage, onMessage } from '@/lib/messages';
import Tab from './Tab';
import ContextMenu from './ContextMenu';

export default function App() {
  const [tabs, setTabs] = useState<ExtendedTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tab: ExtendedTab;
  } | null>(null);

  // Load initial state and subscribe to updates - SINGLE request instead of 3
  useEffect(() => {
    let mounted = true;
    
    async function initialize() {
      try {
        // Get current window ID first
        const [activeTab] = await chrome.tabs.query({ 
          active: true, 
          currentWindow: true 
        });
        
        if (!mounted) return;
        
        const windowId = activeTab?.windowId ?? null;
        setCurrentWindowId(windowId);
        
        if (activeTab?.id) {
          setActiveTabId(activeTab.id);
        }
        
        // Single request - GET_TABS returns enriched tabs for current window
        const tabList = await sendMessage<ExtendedTab[]>({ 
          type: 'GET_TABS', 
          windowId: windowId ?? undefined 
        });
        
        if (!mounted) return;
        setTabs(tabList);
        
      } catch (error) {
        console.error('[SidePanel] Failed to initialize:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    
    initialize();
    
    return () => { mounted = false; };
  }, []);

  // Listen for updates from service worker
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'STATE_SYNC': {
          // Full state sync - filter tabs for current window
          const windowTabs = currentWindowId !== null
            ? message.state.tabs.filter(t => t.windowId === currentWindowId)
            : message.state.tabs;
          setTabs(windowTabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
          setActiveTabId(message.state.activeTabId);
          break;
        }
        
        case 'TAB_CREATED': {
          // Only add tab if it's from current window
          if (currentWindowId === null || message.windowId === currentWindowId) {
            setTabs(prev => {
              // Check if tab already exists
              if (prev.some(t => t.id === message.tab.id)) {
                return prev;
              }
              // Add and sort by index
              return [...prev, message.tab].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
            });
          }
          break;
        }
        
        case 'TAB_REMOVED': {
          // Remove from our list (windowId check not needed - just remove if present)
          setTabs(prev => prev.filter(t => t.id !== message.tabId));
          break;
        }
        
        case 'TAB_UPDATED': {
          // Only update if tab is from current window
          if (currentWindowId === null || message.tab.windowId === currentWindowId) {
            setTabs(prev => 
              prev.map(t => t.id === message.tab.id ? message.tab : t)
            );
          }
          break;
        }
        
        case 'TAB_MOVED': {
          // Reorder tabs
          if (currentWindowId === null || message.windowId === currentWindowId) {
            setTabs(prev => {
              const updated = [...prev];
              const tabIndex = updated.findIndex(t => t.id === message.tabId);
              if (tabIndex !== -1) {
                const [tab] = updated.splice(tabIndex, 1);
                tab.index = message.toIndex;
                updated.splice(message.toIndex, 0, tab);
                // Update indices for all tabs
                return updated.map((t, i) => ({ ...t, index: i }));
              }
              return prev;
            });
          }
          break;
        }
        
        case 'TAB_ACTIVATED': {
          setActiveTabId(message.tabId);
          break;
        }
        
        case 'WINDOW_FOCUSED': {
          // If a different window is focused, we might want to refresh
          // For now, just log it
          console.log('[SidePanel] Window focused:', message.windowId);
          break;
        }
        
        case 'SPACES_UPDATED': {
          // TODO: Handle spaces when feature is implemented
          break;
        }

        case 'SIDE_PANEL_CLOSING': {
          // Play a closing animation when the background script
          // is about to toggle the side panel off
          setIsClosing(true);
          break;
        }
      }
    });

    return unsubscribe;
  }, [currentWindowId]);

  // Tab action handlers
  const handleTabClick = useCallback((tab: ExtendedTab) => {
    if (tab.id && tab.windowId) {
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: tab.windowId });
    }
  }, []);

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    sendMessage({ type: 'CLOSE_TAB', tabId });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: ExtendedTab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab,
    });
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!contextMenu?.tab.url) return;
    try {
      await navigator.clipboard.writeText(contextMenu.tab.url);
      setContextMenu(null);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  }, [contextMenu]);

  const handleReload = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    sendMessage({ type: 'RELOAD_TAB', tabId: contextMenu.tab.id });
    setContextMenu(null);
  }, [contextMenu]);

  const handleMute = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    const isMuted = contextMenu.tab.mutedInfo?.muted ?? false;
    sendMessage({ type: 'MUTE_TAB', tabId: contextMenu.tab.id, muted: !isMuted });
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuClose = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    sendMessage({ type: 'CLOSE_TAB', tabId: contextMenu.tab.id });
    setContextMenu(null);
  }, [contextMenu]);

  // Memoize filtered and separated tabs - only recompute when deps change
  const { pinnedTabs, regularTabs, filteredCount } = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = searchQuery 
      ? tabs.filter(tab => 
          tab.title?.toLowerCase().includes(query) ||
          tab.url?.toLowerCase().includes(query)
        )
      : tabs;
    
    const pinned: ExtendedTab[] = [];
    const regular: ExtendedTab[] = [];
    
    // Single pass instead of two filter calls
    for (const tab of filtered) {
      if (tab.pinned) {
        pinned.push(tab);
      } else {
        regular.push(tab);
      }
    }
    
    return { pinnedTabs: pinned, regularTabs: regular, filteredCount: filtered.length };
  }, [tabs, searchQuery]);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        color: '#888'
      }}>
        Loading tabs...
      </div>
    );
  }

  return (
    <div
      className={`sidepanel-root${isClosing ? ' sidepanel-root--closing' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Search */}
      <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
        <input
          type="text"
          placeholder="Search tabs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            backgroundColor: '#2a2a2a',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#e5e5e5',
            border: 'none',
            outline: 'none',
          }}
        />
      </div>

      {/* Tab list - scrollable */}
      <div 
        style={{ 
          flex: 1, 
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        }}
      >
        <div style={{ padding: '8px' }}>
          {/* Pinned tabs */}
          {pinnedTabs.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ 
                fontSize: '11px', 
                color: '#888', 
                textTransform: 'uppercase', 
                letterSpacing: '0.05em',
                padding: '0 8px',
                marginBottom: '8px'
              }}>
                Pinned
              </div>
              {pinnedTabs.map((tab) => (
                <Tab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onClick={() => handleTabClick(tab)}
                  onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab)}
                />
              ))}
            </div>
          )}

          {/* Regular tabs */}
          <div>
            {pinnedTabs.length > 0 && regularTabs.length > 0 && (
              <div style={{ 
                fontSize: '11px', 
                color: '#888', 
                textTransform: 'uppercase', 
                letterSpacing: '0.05em',
                padding: '0 8px',
                marginBottom: '8px'
              }}>
                Tabs ({regularTabs.length})
              </div>
            )}
            {regularTabs.map((tab) => (
              <Tab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClick={() => handleTabClick(tab)}
                onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
              />
            ))}
          </div>

          {filteredCount === 0 && (
            <div style={{ textAlign: 'center', color: '#888', padding: '32px 0' }}>
              {searchQuery ? 'No matching tabs' : 'No tabs open'}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: '1px solid #333' }}>
        <div style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} open
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopyLink={handleCopyLink}
          onReload={handleReload}
          onCloseTab={handleContextMenuClose}
          onMute={handleMute}
          isMuted={contextMenu.tab.mutedInfo?.muted ?? false}
        />
      )}
    </div>
  );
}
