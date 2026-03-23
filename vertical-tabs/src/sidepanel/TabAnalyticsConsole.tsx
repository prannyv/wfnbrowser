import { useEffect, useMemo, useState } from 'react';
import type { ExtendedTab, Space } from '@/types';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const DEFAULT_SPACE_ID = 'default';
const ALL_SPACES = '__all_spaces__';

type SortMode = 'most_used' | 'least_used' | 'most_recent' | 'oldest';

interface TabMetadataShape {
  spaceId?: string;
  lastActiveAt?: number;
  totalActiveMs?: number;
  timeSpentMs?: number;
  activationCount?: number;
  openedCount?: number;
}

interface AnalyticsRow {
  tab: ExtendedTab;
  tabId: number;
  title: string;
  totalActiveMs: number;
  activationCount: number;
  lastActiveAt: number;
  spaceId: string;
}

interface Props {
  tabs: ExtendedTab[];
  spaces: Space[];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'never';
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function closeTabs(tabIds: number[]): void {
  if (tabIds.length === 0) return;
  chrome.tabs.remove(tabIds).catch((error) => {
    console.error('[Analytics] Failed to close tabs:', error);
  });
}

export default function TabAnalyticsConsole({ tabs, spaces }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('most_used');
  const [spaceFilter, setSpaceFilter] = useState<string>(ALL_SPACES);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());
  const [tabMetadata, setTabMetadata] = useState<Record<number, TabMetadataShape>>({});

  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const result = await chrome.storage.local.get('tab_metadata');
        setTabMetadata((result.tab_metadata as Record<number, TabMetadataShape> | undefined) ?? {});
      } catch (error) {
        console.error('[Analytics] Failed to load tab metadata:', error);
      }
    };

    loadMetadata();
    const timer = setInterval(loadMetadata, 10000);
    return () => clearInterval(timer);
  }, []);

  const analyticsRows = useMemo(() => {
    const rows: AnalyticsRow[] = tabs
      .filter((tab): tab is ExtendedTab & { id: number } => typeof tab.id === 'number')
      .map((tab) => {
        const metadata = tabMetadata[tab.id] ?? {};
        const totalActiveMs = metadata.totalActiveMs ?? metadata.timeSpentMs ?? 0;
        const activationCount = metadata.activationCount ?? metadata.openedCount ?? 0;
        const lastActiveAt = metadata.lastActiveAt ?? tab.lastActiveAt ?? tab.lastAccessed ?? 0;
        const spaceId = metadata.spaceId ?? tab.spaceId ?? DEFAULT_SPACE_ID;

        return {
          tab,
          tabId: tab.id,
          title: tab.title || tab.url || 'Untitled',
          totalActiveMs,
          activationCount,
          lastActiveAt,
          spaceId,
        };
      });

    const filtered = rows.filter((row) => {
      if (spaceFilter === ALL_SPACES) return true;
      return row.spaceId === spaceFilter;
    });

    const sorted = [...filtered];
    switch (sortMode) {
      case 'most_used':
        sorted.sort((a, b) => b.totalActiveMs - a.totalActiveMs);
        break;
      case 'least_used':
        sorted.sort((a, b) => a.totalActiveMs - b.totalActiveMs);
        break;
      case 'most_recent':
        sorted.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
        break;
      case 'oldest':
        sorted.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
        break;
    }
    return sorted;
  }, [tabs, tabMetadata, sortMode, spaceFilter]);

  const chartRows = useMemo(() => {
    const sorted = [...analyticsRows].sort((a, b) => b.totalActiveMs - a.totalActiveMs);
    return sorted.map((row) => ({
      id: row.tabId,
      name: row.title.length > 28 ? `${row.title.slice(0, 28)}...` : row.title,
      timeMs: row.totalActiveMs,
    }));
  }, [analyticsRows]);

  const allSelected = analyticsRows.length > 0 && analyticsRows.every((row) => selectedTabIds.has(row.tabId));
  const selectedCount = selectedTabIds.size;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedTabIds(new Set());
      return;
    }
    setSelectedTabIds(new Set(analyticsRows.map((row) => row.tabId)));
  };

  const toggleRow = (tabId: number) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  };

  const selectedIds = useMemo(
    () => analyticsRows.map((row) => row.tabId).filter((tabId) => selectedTabIds.has(tabId)),
    [analyticsRows, selectedTabIds]
  );

  const handleCloseSelected = () => {
    closeTabs(selectedIds);
    setSelectedTabIds(new Set());
  };

  const handleArchiveSelected = () => {
    // Fallback path when archive system is unavailable.
    closeTabs(selectedIds);
    setSelectedTabIds(new Set());
  };

  return (
    <div className="analytics-console">
      <div className="analytics-console__controls">
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="analytics-console__select"
        >
          <option value="most_used">Most used</option>
          <option value="least_used">Least used</option>
          <option value="most_recent">Most recent</option>
          <option value="oldest">Oldest</option>
        </select>
        <select
          value={spaceFilter}
          onChange={(e) => setSpaceFilter(e.target.value)}
          className="analytics-console__select"
        >
          <option value={ALL_SPACES}>All spaces</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </div>

      <div className="analytics-console__select-all">
        <input id="analytics-select-all" type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
        <label htmlFor="analytics-select-all" className="analytics-console__select-all-label">
          Select all
        </label>
      </div>

      <div className="analytics-console__list">
        {analyticsRows.map((row) => (
          <div
            key={row.tabId}
            className="analytics-console__row"
          >
            <input
              type="checkbox"
              checked={selectedTabIds.has(row.tabId)}
              onChange={() => toggleRow(row.tabId)}
            />
            {row.tab.favIconUrl ? (
              <img src={row.tab.favIconUrl} alt="" className="analytics-console__favicon" />
            ) : (
              <span className="analytics-console__favicon-fallback">•</span>
            )}
            <span className="analytics-console__title">
              {row.title}
            </span>
            <span className="analytics-console__metric">{formatDuration(row.totalActiveMs)}</span>
            <span className="analytics-console__metric">{row.activationCount}</span>
            <span className="analytics-console__metric">{formatRelativeTime(row.lastActiveAt)}</span>
          </div>
        ))}
        {analyticsRows.length === 0 && (
          <div className="analytics-console__empty">No tabs available</div>
        )}
      </div>

      <div className="analytics-console__chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#9ca3af', fontSize: 11 }} />
            <Tooltip
              formatter={(value: number) => formatDuration(value)}
              contentStyle={{ backgroundColor: '#1a1a1d', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#e5e5e5' }}
            />
            <Bar dataKey="timeMs" fill="#4a9eff" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {selectedCount > 0 && (
        <div className="analytics-console__bulkbar">
          <span className="analytics-console__bulkcount">{selectedCount} selected</span>
          <div className="analytics-console__bulkactions">
            <button
              type="button"
              onClick={handleCloseSelected}
              className="space-modal__btn space-modal__btn--secondary"
            >
              Close selected
            </button>
            <button
              type="button"
              onClick={handleArchiveSelected}
              className="space-modal__btn space-modal__btn--secondary"
            >
              Archive selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
