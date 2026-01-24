import { useEffect, useState } from 'react';
import type { ExtendedTab } from '@/types';
import { sendMessage, onMessage } from '@/lib/messages';
import clsx from 'clsx';

export default function App() {
  const [tabs, setTabs] = useState<ExtendedTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Load initial tabs
  useEffect(() => {
    async function loadTabs() {
      try {
        const allTabs = await sendMessage<ExtendedTab[]>({ type: 'GET_ALL_TABS' });
        setTabs(allTabs);
        
        // Get currently active tab
        const [activeTab] = await chrome.tabs.query({ 
          active: true, 
          currentWindow: true 
        });
        if (activeTab?.id) {
          setActiveTabId(activeTab.id);
        }
      } catch (error) {
        console.error('Failed to load tabs:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadTabs();
  }, []);

  // Listen for tab updates from service worker
  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'TAB_CREATED':
          setTabs((prev) => [...prev, message.tab]);
          break;
        case 'TAB_REMOVED':
          setTabs((prev) => prev.filter((t) => t.id !== message.tabId));
          break;
        case 'TAB_UPDATED':
          setTabs((prev) =>
            prev.map((t) => (t.id === message.tab.id ? message.tab : t))
          );
          break;
        case 'TAB_ACTIVATED':
          setActiveTabId(message.tabId);
          break;
      }
    });

    return unsubscribe;
  }, []);

  const handleTabClick = (tab: ExtendedTab) => {
    if (tab.id && tab.windowId) {
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: tab.windowId });
    }
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    sendMessage({ type: 'CLOSE_TAB', tabId });
  };

  // Filter tabs by search query
  const filteredTabs = tabs.filter((tab) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      tab.title?.toLowerCase().includes(query) ||
      tab.url?.toLowerCase().includes(query)
    );
  });

  // Separate pinned and regular tabs
  const pinnedTabs = filteredTabs.filter((t) => t.pinned);
  const regularTabs = filteredTabs.filter((t) => !t.pinned);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading tabs...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-sidebar-border">
        <input
          type="text"
          placeholder="Search tabs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 bg-sidebar-hover rounded-lg text-sm 
                     text-gray-200 placeholder-gray-500 outline-none
                     focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Pinned tabs */}
        {pinnedTabs.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide px-2 mb-2">
              Pinned
            </div>
            {pinnedTabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onClick={() => handleTabClick(tab)}
                onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
              />
            ))}
          </div>
        )}

        {/* Regular tabs */}
        <div>
          {pinnedTabs.length > 0 && regularTabs.length > 0 && (
            <div className="text-xs text-gray-500 uppercase tracking-wide px-2 mb-2">
              Tabs ({regularTabs.length})
            </div>
          )}
          {regularTabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onClick={() => handleTabClick(tab)}
              onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
            />
          ))}
        </div>

        {filteredTabs.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            {searchQuery ? 'No matching tabs' : 'No tabs open'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border">
        <div className="text-xs text-gray-500 text-center">
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} open
        </div>
      </div>
    </div>
  );
}

// Tab item component
interface TabItemProps {
  tab: ExtendedTab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function TabItem({ tab, isActive, onClick, onClose }: TabItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer',
        'transition-colors duration-150 group',
        isActive 
          ? 'bg-sidebar-active border-l-2 border-accent' 
          : 'hover:bg-sidebar-hover'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={tab.title}
    >
      {/* Favicon */}
      <img
        src={tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }
        alt=""
        className="w-4 h-4 rounded flex-shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).src = 
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
        }}
      />

      {/* Title */}
      <span className="flex-1 truncate text-sm">
        {tab.title || 'New Tab'}
      </span>

      {/* Close button */}
      <button
        onClick={onClose}
        className={clsx(
          'p-1 rounded hover:bg-red-500/20 hover:text-red-400',
          'transition-opacity duration-150',
          isHovered ? 'opacity-100' : 'opacity-0'
        )}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

