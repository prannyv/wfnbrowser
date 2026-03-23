import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ExtendedTab } from '@/types';
import { sendMessage, onMessage } from '@/lib/messages';
import ContextMenu from './ContextMenu';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  useDroppable,
  MeasuringStrategy,
  rectIntersection,
  CollisionDetection
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { SortableTab } from './SortableTab';
import Tab from './Tab';

// Removed global customCollisionDetection.
// It is now defined inside the App component to access pinnedTabs.

interface PinnedTabsZoneProps {
  pinnedTabs: ExtendedTab[];
  activeDragId: number | null;
  activeTabId: number | null;
  pinnedTabVariant: string;
  handleTabClick: (tab: ExtendedTab) => void;
  handleCloseTab: (e: React.MouseEvent, tabId: number) => void;
  handleContextMenu: (e: React.MouseEvent, tab: ExtendedTab) => void;
}

function PinnedTabsZone({
  pinnedTabs,
  activeDragId,
  activeTabId,
  pinnedTabVariant,
  handleTabClick,
  handleCloseTab,
  handleContextMenu
}: PinnedTabsZoneProps) {
  const { setNodeRef: setPinnedDroppableRef, isOver: isOverPinnedContainer } = useDroppable({
    id: 'pinned-tabs-container',
  });

  return (
    <div
      className="pinned-tabs-zone"
      ref={setPinnedDroppableRef}
      style={{
        marginBottom: (pinnedTabs.length > 0 || activeDragId) ? '16px' : '0px',
        minHeight: (pinnedTabs.length === 0 && activeDragId) ? '60px' : undefined,
        height: (pinnedTabs.length === 0 && !activeDragId) ? '0px' : undefined,
        opacity: (pinnedTabs.length === 0 && !activeDragId) ? 0 : 1,
        overflow: 'hidden',
        transition: 'all 0.2s ease-in-out',
        backgroundColor: isOverPinnedContainer ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
        borderColor: isOverPinnedContainer ? 'rgba(59, 130, 246, 0.5)' : 'transparent',
        borderWidth: (pinnedTabs.length > 0 || activeDragId) ? '1px' : '0px',
        borderStyle: 'solid',
        borderRadius: '8px',
        position: 'relative',
        zIndex: 1
      }}
    >
      {pinnedTabs.length > 0 && (
        <div style={{
          fontSize: '11px',
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          padding: '6px 8px 4px',
          marginBottom: '4px'
        }}>
          Pinned Tabs
        </div>
      )}

      {pinnedTabs.length === 0 && activeDragId && (
        <div style={{
          fontSize: '11px',
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          padding: '12px',
          textAlign: 'center',
          border: '1px dashed #444',
          borderRadius: '8px',
          margin: '4px',
          pointerEvents: 'none'
        }}>
          Drop to Pin
        </div>
      )}

      <SortableContext
        items={pinnedTabs.map(t => t.id ?? -1)}
        strategy={rectSortingStrategy}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: '4px',
          padding: pinnedTabs.length > 0 ? '4px 12px' : '0px',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          minHeight: pinnedTabs.length > 0 ? '56px' : '0px',
          width: '100%',
        }}>
          {pinnedTabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              variant={pinnedTabVariant as any}
              onClick={() => handleTabClick(tab)}
              onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export default function App() {
  const [tabs, setTabs] = useState<ExtendedTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<{ text: string; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tab: ExtendedTab;
  } | null>(null);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);



  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load initial state
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
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

  // Subscribe to updates
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'STATE_SYNC': {
          setTabs(message.state.tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
          break;
        }
        case 'TAB_CREATED': {
          setTabs(prev => {
            if (prev.some(t => t.id === message.tab.id)) return prev;
            return [...prev, message.tab].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          });
          break;
        }
        case 'TAB_REMOVED': {
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
              updated.splice(message.toIndex, 0, tab);
              return updated.map((t, i) => ({ ...t, index: i }));
            }
            return prev;
          });
          break;
        }
        case 'TAB_ACTIVATED': {
          setActiveTabId(message.tabId);
          break;
        }
        case 'SIDE_PANEL_CLOSING': {
          setIsClosing(true);
          break;
        }
      }
    });

    return unsubscribe;
  }, [currentWindowId]);

  const handleTabClick = useCallback((tab: ExtendedTab) => {
    if (!tab.id) return;
    if (tab.pinned && currentWindowId !== null && tab.windowId !== currentWindowId) {
      sendMessage({
        type: 'MOVE_TAB',
        tabId: tab.id,
        windowId: currentWindowId,
        index: 0
      });
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: currentWindowId });
    } else if (tab.windowId) {
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

  const { pinnedTabs, regularTabs, filteredCount, pinnedTabVariant } = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = searchQuery
      ? tabs.filter(tab =>
        tab.title?.toLowerCase().includes(query) ||
        tab.url?.toLowerCase().includes(query)
      )
      : tabs;

    const pinned: ExtendedTab[] = [];
    const regular: ExtendedTab[] = [];

    for (const tab of filtered) {
      if (tab.pinned) {
        pinned.push(tab);
      } else if (tab.windowId === currentWindowId) {
        regular.push(tab);
      }
    }

    let variant = 'single';
    if (pinned.length > 4) variant = 'compact';
    else if (pinned.length > 2) variant = 'minimal';
    else if (pinned.length === 2) variant = 'elongated';

    return {
      pinnedTabs: pinned,
      regularTabs: regular,
      filteredCount: filtered.length,
      pinnedTabVariant: variant
    };
  }, [tabs, searchQuery, currentWindowId]);

  const customCollisionDetection = useCallback<CollisionDetection>((args) => {
    if (args.pointerCoordinates) {
      try {
        // Find exactly what is under the mouse pointer
        const element = document.elementFromPoint(
          args.pointerCoordinates.x,
          args.pointerCoordinates.y
        );

        if (element) {
          // If the element is anywhere inside the designated "pinned tabs" DOM zone
          const pinnedZone = element.closest('.pinned-tabs-zone');
          if (pinnedZone) {
            // First check if the user is hovering exactly over an existing Pinned Tab
            const tabNode = element.closest('[data-tab-id]');
            if (tabNode) {
              const tabId = Number(tabNode.getAttribute('data-tab-id'));
              if (pinnedTabs.some(pt => pt.id === tabId)) {
                const container = args.droppableContainers.find(c => c.id === tabId);
                if (container) return [{ id: tabId, data: { droppableContainer: container, value: 0 } }];
              }
            }

            // Otherwise, they dropped perfectly into the "Drop to Pin" background container
            const pinnedContainer = args.droppableContainers.find(c => c.id === 'pinned-tabs-container');
            if (pinnedContainer) {
              return [{ id: 'pinned-tabs-container', data: { droppableContainer: pinnedContainer, value: 0 } }];
            }
          }
        }
      } catch (err) {
        // gracefully fall back
        console.warn('customCollisionDetection error:', err);
      }
    }

    // 2. FALLBACK for empty state: rectIntersection
    // If elementFromPoint failed (e.g., dragged item overlay blocking the exact pixel), 
    // mathematically check if the dragged item literally overlaps the physical "Drop to Pin" bounding box.
    if (pinnedTabs.length === 0) {
      const intersections = rectIntersection(args);
      const pinnedContainerCollision = intersections[0]?.id === 'pinned-tabs-container' ? intersections[0] : null;

      // If the dragged rect mostly overlaps the empty container box, force it to drop there.
      if (pinnedContainerCollision) {
        return [pinnedContainerCollision];
      }
    }

    // Standard fallback behavior outside the pinned zone
    return closestCenter(args);
  }, [pinnedTabs]);

  const handleDragStart = (event: any) => {
    setActiveDragId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const activeId = Number(active.id);
    const overId = over.id === 'pinned-tabs-container' ? 'pinned-tabs-container' : Number(over.id);

    const isActivePinned = pinnedTabs.some(t => t.id === activeId);
    const isOverPinned = overId === 'pinned-tabs-container' || pinnedTabs.some(t => t.id === overId);
    const isOverRegular = regularTabs.some(t => t.id === overId);

    // 1. Reorder Pinned Tabs
    if (isActivePinned && isOverPinned && overId !== 'pinned-tabs-container' && activeId !== overId) {
      const targetTab = pinnedTabs.find(t => t.id === overId);
      if (targetTab && targetTab.index !== undefined) {
        chrome.tabs.move(activeId, { index: targetTab.index });
      }
      return;
    }

    // 2. Reorder Regular Tabs
    if (!isActivePinned && isOverRegular && activeId !== overId) {
      const targetTab = regularTabs.find(t => t.id === overId);
      if (targetTab && targetTab.index !== undefined) {
        chrome.tabs.move(activeId, { index: targetTab.index });
      }
      return;
    }

    // 3. Auto-Pin (Regular -> Pinned)
    if (!isActivePinned && isOverPinned) {
      if (pinnedTabs.length >= 6) {
        setErrorMessage({
          text: 'Can only pin up to 6 tabs',
          x: event.active.rect.current.translated?.left ?? 0,
          y: event.active.rect.current.translated?.top ?? 0
        });
        setTimeout(() => setErrorMessage(null), 1500);
        return;
      }
      sendMessage({
        type: 'PIN_TAB',
        tabId: activeId,
        pinned: true
      });
      return;
    }

    // 4. Auto-Unpin (Pinned -> Regular)
    if (isActivePinned && isOverRegular) {
      sendMessage({
        type: 'PIN_TAB',
        tabId: activeId,
        pinned: false
      });
      return;
    }
  };

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

  const activeDragTab = tabs.find(t => t.id === activeDragId);

  return (
    <div
      className={`sidepanel-root${isClosing ? ' sidepanel-root--closing' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
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

      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          }
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            userSelect: 'none',
          }}
        >
          <div style={{ padding: '8px', minHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>

            {/*Pinned tabs*/}
            <PinnedTabsZone
              pinnedTabs={pinnedTabs}
              activeDragId={activeDragId}
              activeTabId={activeTabId}
              pinnedTabVariant={pinnedTabVariant}
              handleTabClick={handleTabClick}
              handleCloseTab={handleCloseTab}
              handleContextMenu={handleContextMenu}
            />

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

            <SortableContext
              items={regularTabs.map(t => t.id ?? -1)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ flex: 1, minHeight: '100px' }}>
                {regularTabs.map((tab) => (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onClick={() => handleTabClick(tab)}
                    onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                    onContextMenu={(e) => handleContextMenu(e, tab)}
                  />
                ))}
              </div>
            </SortableContext>

            {filteredCount === 0 && (
              <div style={{ textAlign: 'center', color: '#888', padding: '32px 0' }}>
                {searchQuery ? 'No matching tabs' : 'No tabs open'}
              </div>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeDragTab ? (
            <div style={{ opacity: 0.8, pointerEvents: 'none' }}>
              <Tab
                tab={activeDragTab}
                isActive={activeDragTab.id === activeTabId}
                variant={(activeDragTab.pinned ? pinnedTabVariant : 'default') as any}
                onClick={() => { }}
                onClose={() => { }}
                onContextMenu={() => { }}
              />
            </div>
          ) : null}
        </DragOverlay>

      </DndContext>

      {errorMessage && (
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
      )}

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: '1px solid #333' }}>
        <div style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} open
        </div>
      </div>

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
          onTogglePin={handleTogglePin}
          isPinned={contextMenu.tab.pinned}
        />
      )}
    </div >
  );
}
