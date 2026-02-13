import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import type { ExtendedTab, Space } from '@/types';
import { sendMessage, onMessage } from '@/lib/messages';
import Tab from './Tab';
import ContextMenu from './ContextMenu';

const DEFAULT_SPACE_ID = 'default';
const ALL_TABS_ID = 'all';

export default function App() {
  const [tabs, setTabs] = useState<ExtendedTab[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>(ALL_TABS_ID);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [spaceModal, setSpaceModal] = useState<{ mode: 'create' | 'edit'; spaceId?: string } | null>(null);
  const [spaceForm, setSpaceForm] = useState<{ name: string; color: string; icon: string }>({
    name: '',
    color: '#4a9eff',
    icon: '',
  });
  const [errorMessage, setErrorMessage] = useState<{ text: string; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tab: ExtendedTab;
  } | null>(null);
  const [isDragOverPinned, setIsDragOverPinned] = useState(false);
  const [draggedTab, setDraggedTab] = useState<number | null>(null);
  const [isDragOverRegular, setIsDragOverRegular] = useState(false);
  const [dragOverSpaceId, setDragOverSpaceId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Load initial state and subscribe to updates - SUBSCRIBE to get full state immediately.
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

        // Subscribe to full state immediately (gets all tabs from all windows)
        await sendMessage({ type: 'SUBSCRIBE' });

      } catch (error) {
        console.error('[SidePanel] Failed to initialize:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    initialize();

    return () => {
      mounted = false;
      sendMessage({ type: 'UNSUBSCRIBE' }).catch(console.error);
    };
  }, []);

  // Listen for updates from service worker
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'STATE_SYNC': {
          // Full state sync - keep ALL tabs in state
          setTabs(message.state.tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
          setSpaces(message.spaces);
          // Only update active tab if it matches ours? Or just rely on local state?
          // The background sends activeTabId globally, might be for a different window.
          // Better to track active tab via TAB_ACTIVATED event for our window.
          break;
        }

        case 'TAB_CREATED': {
          setTabs(prev => {
            // Check if tab already exists
            if (prev.some(t => t.id === message.tab.id)) {
              return prev;
            }
            return [...prev, message.tab].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          });
          break;
        }

        case 'TAB_REMOVED': {
          // Remove from our list
          setTabs(prev => prev.filter(t => t.id !== message.tabId));
          break;
        }

        case 'TAB_UPDATED': {
          setTabs(prev =>
            prev.map(t => t.id === message.tab.id ? message.tab : t)
          );
          break;
        }

        case 'TAB_MOVED': {
          setTabs(prev => {
            const updated = [...prev];
            const tabIndex = updated.findIndex(t => t.id === message.tabId);
            if (tabIndex !== -1) {
              const [tab] = updated.splice(tabIndex, 1);
              tab.index = message.toIndex;
              // If window changed, we should probably re-sort completely or just update metadata
              // For simplicity, just update and sort
              updated.splice(message.toIndex, 0, tab);
              return updated.map((t, i) => ({ ...t, index: i })); // This re-indexing might be wrong globally?
              // Actually TabEngine sends normalized indices per window, so we might have duplicate indices if we mix windows.
              // BUT, we only care about index for sorting.
            }
            return prev;
          });
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
          setSpaces(message.spaces);
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

  useEffect(() => {
    if (activeSpaceId === ALL_TABS_ID) return;
    if (!spaces.some(space => space.id === activeSpaceId)) {
      setActiveSpaceId(DEFAULT_SPACE_ID);
    }
  }, [spaces, activeSpaceId]);

  // Tab action handlers
  const handleTabClick = useCallback((tab: ExtendedTab) => {
    if (!tab.id) return;

    // If it's a pinned tab from another window, move it here
    if (tab.pinned && currentWindowId !== null && tab.windowId !== currentWindowId) {
      sendMessage({
        type: 'MOVE_TAB',
        tabId: tab.id,
        windowId: currentWindowId,
        index: 0 // Move to start (pinned area)
      });
      // Also activate it
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: currentWindowId });
    } else if (tab.windowId) {
      // Regular behavior
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: tab.windowId });
    }
  }, [currentWindowId]);

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

  const handleTogglePin = useCallback(() => {
    if (!contextMenu?.tab) return;

    const tab = contextMenu.tab;
    const isPinning = !tab.pinned;

    // Check count limit
    const currentPinnedCount = tabs.filter(t => t.pinned).length;

    if (isPinning && currentPinnedCount >= 6) {
      setErrorMessage({
        text: 'Can only pin up to 6 tabs',
        x: contextMenu.x,
        y: contextMenu.y
      });
      setTimeout(() => setErrorMessage(null), 750);
      setContextMenu(null);
      return;
    }

    if (tab.id && tab.id > 0) {
      sendMessage({
        type: 'PIN_TAB',
        tabId: tab.id,
        pinned: isPinning
      });
    }
    setContextMenu(null);
  }, [contextMenu, tabs]);

  const handleDragStart = useCallback((tab: ExtendedTab) => (e: React.DragEvent) => {
    if (!tab.id) return;
    setDraggedTab(tab.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tab.id));

    // Start auto-scroll on drag
    const handleDragMove = (event: DragEvent) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scrollThreshold = 50; // pixels from edge to trigger scroll
      const scrollSpeed = 10; // pixels per interval

      const mouseY = event.clientY;
      const distanceFromTop = mouseY - rect.top;
      const distanceFromBottom = rect.bottom - mouseY;

      // Clear existing interval
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }

      // Scroll up if near top
      if (distanceFromTop < scrollThreshold && distanceFromTop > 0) {
        autoScrollIntervalRef.current = setInterval(() => {
          container.scrollTop -= scrollSpeed;
        }, 16); // ~60fps
      }
      // Scroll down if near bottom
      else if (distanceFromBottom < scrollThreshold && distanceFromBottom > 0) {
        autoScrollIntervalRef.current = setInterval(() => {
          container.scrollTop += scrollSpeed;
        }, 16);
      }
    };

    document.addEventListener('drag', handleDragMove);

    // Cleanup on drag end
    const cleanup = () => {
      document.removeEventListener('drag', handleDragMove);
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }
    };

    document.addEventListener('dragend', cleanup, { once: true });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
    setIsDragOverPinned(false);
    setIsDragOverRegular(false);
    setDragOverSpaceId(null);

    // Clear auto-scroll interval
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const openCreateSpaceModal = useCallback(() => {
    setSpaceForm({ name: '', color: '#4a9eff', icon: '' });
    setSpaceModal({ mode: 'create' });
  }, []);

  const openEditSpaceModal = useCallback((spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    setSpaceForm({ name: space.name, color: space.color, icon: space.icon ?? '' });
    setSpaceModal({ mode: 'edit', spaceId });
  }, [spaces]);

  const handleSpaceSelect = useCallback((spaceId: string) => {
    setActiveSpaceId(spaceId);
    if (spaceId !== ALL_TABS_ID) {
      sendMessage({
        type: 'UPDATE_SPACE',
        spaceId,
        updates: { lastAccessedAt: Date.now() },
      }).catch(console.error);
    }
  }, []);

  const handleSpaceContextMenu = useCallback((spaceId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openEditSpaceModal(spaceId);
  }, [openEditSpaceModal]);

  const handleSpaceSave = useCallback(async () => {
    if (!spaceForm.name.trim()) return;

    if (spaceModal?.mode === 'create') {
      await sendMessage({
        type: 'CREATE_SPACE',
        name: spaceForm.name.trim(),
        color: spaceForm.color,
        icon: spaceForm.icon.trim() || undefined,
      });
    }

    if (spaceModal?.mode === 'edit' && spaceModal.spaceId) {
      await sendMessage({
        type: 'UPDATE_SPACE',
        spaceId: spaceModal.spaceId,
        updates: {
          name: spaceForm.name.trim(),
          color: spaceForm.color,
          icon: spaceForm.icon.trim() || undefined,
        },
      });
    }

    setSpaceModal(null);
  }, [spaceForm, spaceModal]);

  const handleSpaceDelete = useCallback(async () => {
    if (spaceModal?.mode !== 'edit' || !spaceModal.spaceId) return;
    if (spaceModal.spaceId === DEFAULT_SPACE_ID) return;
    await sendMessage({ type: 'DELETE_SPACE', spaceId: spaceModal.spaceId });
    setSpaceModal(null);
    setActiveSpaceId(DEFAULT_SPACE_ID);
  }, [spaceModal]);

  const handleSpaceDragOver = useCallback((spaceId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSpaceId(spaceId);
  }, []);

  const handleSpaceDrop = useCallback((spaceId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSpaceId(null);

    const data = e.dataTransfer.getData('text/plain');
    const tabId = draggedTab ?? (data ? parseInt(data, 10) : null);
    if (!tabId || Number.isNaN(tabId)) return;

    sendMessage({ type: 'ASSIGN_TAB_TO_SPACE', tabId, spaceId }).catch(console.error);
    setDraggedTab(null);
  }, [draggedTab]);

  const handleSpaceDragLeave = useCallback((spaceId: string) => (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverSpaceId === spaceId) {
      setDragOverSpaceId(null);
    }
  }, [dragOverSpaceId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverPinned(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Prevent flickering when dragging over children (tabs)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverPinned(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPinned(false);

    if (!draggedTab) return;

    const currentPinnedCount = tabs.filter(t => t.pinned).length;

    if (currentPinnedCount >= 6) {
      setErrorMessage({
        text: 'Can only pin up to 6 tabs',
        x: e.clientX,
        y: e.clientY
      });
      setTimeout(() => setErrorMessage(null), 750);
      setDraggedTab(null);
      return;
    }

    sendMessage({
      type: 'PIN_TAB',
      tabId: draggedTab,
      pinned: true
    });

    setDraggedTab(null);
  }, [draggedTab, tabs]);

  const handleDragOverRegular = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverRegular(true);
  }, []);

  const handleDragLeaveRegular = useCallback((e: React.DragEvent) => {
    // Prevent flickering when dragging over children (tabs)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverRegular(false);
  }, []);

  const handleDropRegular = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverRegular(false);

    if (!draggedTab) return;

    // Unpin the tab
    sendMessage({
      type: 'PIN_TAB',
      tabId: draggedTab,
      pinned: false
    });

    setDraggedTab(null);
  }, [draggedTab]);


  // Memoize filtered and separated tabs - only recompute when deps change
  const { pinnedTabs, regularTabs, filteredCount, pinnedTabVariant } = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const spaceFiltered = activeSpaceId === ALL_TABS_ID
      ? tabs
      : tabs.filter(tab => (tab.spaceId ?? DEFAULT_SPACE_ID) === activeSpaceId);

    const filtered = searchQuery
      ? spaceFiltered.filter(tab =>
        tab.title?.toLowerCase().includes(query) ||
        tab.url?.toLowerCase().includes(query)
      )
      : spaceFiltered;

    const pinned: ExtendedTab[] = [];
    const regular: ExtendedTab[] = [];

    // Single pass instead of two filter calls
    for (const tab of filtered) {
      if (tab.pinned) {
        pinned.push(tab);
      } else if (tab.windowId === currentWindowId) {
        // Regular tabs: Only show if they belong to THIS window
        regular.push(tab);
      }
    }

    // Determine variant based on count
    let variant = 'single';
    if (pinned.length > 4) {
      // 5-6 tabs: Compact (Rectangles, 96px wide)
      variant = 'compact';
    } else if (pinned.length > 2) {
      // 3-4 tabs: Minimal (Squares, 48px wide)
      variant = 'minimal';
    } else if (pinned.length === 2) {
      // 2 tabs: Elongated
      variant = 'elongated';
    }
    // 1 tab: Single (Default)

    return {
      pinnedTabs: pinned,
      regularTabs: regular,
      filteredCount: filtered.length,
      pinnedTabVariant: variant
    };
  }, [tabs, searchQuery, activeSpaceId]);

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
      {/* Spaces */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <button
            type="button"
            onClick={() => handleSpaceSelect(ALL_TABS_ID)}
            style={{
              padding: '6px 10px',
              borderRadius: '999px',
              border: activeSpaceId === ALL_TABS_ID ? '1px solid white' : '1px solid #333',
              background: activeSpaceId === ALL_TABS_ID ? '#1f2937' : '#111',
              color: '#e5e5e5',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            All Tabs
          </button>

          {spaces.map(space => (
            <div
              key={space.id}
              onContextMenu={handleSpaceContextMenu(space.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleSpaceSelect(space.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSpaceSelect(space.id);
                  }
                }}
                onContextMenu={handleSpaceContextMenu(space.id)}
                onDragOver={handleSpaceDragOver(space.id)}
                onDrop={handleSpaceDrop(space.id)}
                onDragLeave={handleSpaceDragLeave(space.id)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '999px',
                  border: activeSpaceId === space.id ? '1px solid white' : '1px solid transparent',
                  background: dragOverSpaceId === space.id ? 'rgba(59, 130, 246, 0.2)' : space.color,
                  color: '#fff',
                  fontSize: '12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  outline: 'none',
                }}
              >
                {space.icon && <span>{space.icon}</span>}
                <span>{space.name}</span>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={openCreateSpaceModal}
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '999px',
              border: '1px dashed #444',
              background: 'transparent',
              color: '#bbb',
              fontSize: '16px',
              cursor: 'pointer',
            }}
            aria-label="Create new space"
            title="Create space"
          >
            +
          </button>
        </div>
      </div>

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
        ref={scrollContainerRef}
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
        <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
          {/*Pinned tabs*/}
          {pinnedTabs.length > 0 && (
            <div
              style={{ marginBottom: '16px' }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div style={{
                fontSize: '11px',
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '0 8px',
                marginBottom: '8px'
              }}>
                Pinned Tabs
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: '4px',
                padding: '4px 8px',
                justifyContent: 'flex-start',
                alignItems: 'flex-end',
                backgroundColor: isDragOverPinned ? 'rgba(59, 130, 246, 0.1)' : undefined,
                border: isDragOverPinned ? '2px solid rgba(59, 130, 246, 0.5)' : '2px solid transparent',
                borderRadius: '8px',
                transition: 'all 0.2s ease',
                minHeight: '56px',
                width: '100%',
              }}>
                {pinnedTabs.map((tab) => (
                  <Tab
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    variant={pinnedTabVariant as 'default' | 'compact' | 'minimal' | 'elongated' | 'single'}
                    onClick={() => handleTabClick(tab)}
                    onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                    onContextMenu={(e) => handleContextMenu(e, tab)}
                    onDragStart={handleDragStart(tab)}
                    onDragEnd={handleDragEnd}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Regular tabs */}
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
          <div
            style={{
              flex: 1,
              minHeight: '100px',
              backgroundColor: isDragOverRegular ? 'rgba(59, 130, 246, 0.1)' : undefined,
              border: isDragOverRegular ? '2px solid rgba(59, 130, 246, 0.5)' : '2px solid transparent',
              borderRadius: '10px',
              padding: '0 8px 8px',
            }}
            onDragOver={handleDragOverRegular}
            onDragLeave={handleDragLeaveRegular}
            onDrop={handleDropRegular}
          >
            {regularTabs.map((tab) => (
              <Tab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                fullWidth
                onClick={() => handleTabClick(tab)}
                onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
                onDragStart={handleDragStart(tab)}
                onDragEnd={handleDragEnd}
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

      {/* Error Message */}
      {
        errorMessage && (
          <div style={{
            position: 'fixed',
            top: `${errorMessage.y + 10}px`,
            left: `${errorMessage.x}px`,
            backgroundColor: '#333',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 750,
          }}>
            {errorMessage.text}
          </div>
        )
      }

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: '1px solid #333' }}>
        <div style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} open
        </div>
      </div>

      {/* Space Modal */}
      {spaceModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 900,
        }}>
          <div style={{
            width: '320px',
            background: '#111',
            border: '1px solid #333',
            borderRadius: '12px',
            padding: '16px',
            color: '#e5e5e5',
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
              {spaceModal.mode === 'create' ? 'Create Space' : 'Edit Space'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                type="text"
                placeholder="Space name"
                value={spaceForm.name}
                onChange={(e) => setSpaceForm(prev => ({ ...prev, name: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: '#1f1f1f',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#e5e5e5',
                  border: '1px solid #333',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="color"
                  value={spaceForm.color}
                  onChange={(e) => setSpaceForm(prev => ({ ...prev, color: e.target.value }))}
                  style={{ width: '36px', height: '32px', border: 'none', background: 'transparent' }}
                />
                <input
                  type="text"
                  placeholder="Icon (emoji)"
                  value={spaceForm.icon}
                  onChange={(e) => setSpaceForm(prev => ({ ...prev, icon: e.target.value }))}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    backgroundColor: '#1f1f1f',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#e5e5e5',
                    border: '1px solid #333',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '16px',
              gap: '8px',
            }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSpaceModal(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #333',
                    background: '#1a1a1a',
                    color: '#ddd',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSpaceSave}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #2563eb',
                    background: '#2563eb',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
              {spaceModal.mode === 'edit' && spaceModal.spaceId !== DEFAULT_SPACE_ID && (
                <button
                  type="button"
                  onClick={handleSpaceDelete}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #7f1d1d',
                    background: '#7f1d1d',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {
        contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onCopyLink={handleCopyLink}
            onReload={handleReload}
            onCloseTab={handleContextMenuClose}
            onMute={handleMute}
            isMuted={contextMenu.tab.mutedInfo?.muted ?? false}
            onTogglePin={handleTogglePin}
            isPinned={contextMenu.tab.pinned}
          />
        )
      }
    </div >
  );
}
