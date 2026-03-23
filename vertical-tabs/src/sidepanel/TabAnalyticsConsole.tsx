import { useEffect, useMemo, useState } from 'react';
import type { ExtendedTab, Space } from '@/types';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { sendMessage } from '@/lib/messages';

const DEFAULT_SPACE_ID = 'default';
const ALL_SPACES_ID = 'all';

type SortMode = 'most_used' | 'least_used' | 'most_recent' | 'oldest';

interface ArchivedTabRecord {
  id?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  spaceId?: string;
  totalTimeMs?: number;
  openCount?: number;
  lastOpenedAt?: number;
  lastActiveAt?: number;
  archivedAt?: number;
}

interface AnalyticsRow {
  id: string;
  tabId?: number;
  title: string;
  url?: string;
  domain: string;
  favicon?: string;
  spaceId: string;
  totalTimeMs: number;
  openCount: number;
  lastOpenedAt: number;
  source: 'open' | 'archived';
}

interface Props {
  tabs: ExtendedTab[];
  spaces: Space[];
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const mins = Math.floor(safe / 60000);
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs > 0) return `${hrs}h ${rem}m`;
  return `${rem}m`;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getDomain(url?: string): string {
  if (!url) return 'local';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'local';
  }
}

export default function TabAnalyticsConsole({ tabs, spaces }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('most_used');
  const [spaceFilter, setSpaceFilter] = useState<string>(ALL_SPACES_ID);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showChart, setShowChart] = useState(true);
  const [archived, setArchived] = useState<ArchivedTabRecord[]>([]);

  useEffect(() => {
    const loadArchived = async () => {
      const data = await chrome.storage.local.get(['archived_tabs', 'archivedTabs']);
      const archivedTabs = (data.archived_tabs ?? data.archivedTabs ?? []) as ArchivedTabRecord[];
      setArchived(Array.isArray(archivedTabs) ? archivedTabs : []);
    };
    void loadArchived();
  }, []);

  const rows = useMemo(() => {
    const openRows: AnalyticsRow[] = tabs
      .filter((tab): tab is ExtendedTab & { id: number } => typeof tab.id === 'number')
      .map((tab) => ({
        id: `open:${tab.id}`,
        tabId: tab.id,
        title: tab.title || tab.url || 'Untitled',
        url: tab.url,
        domain: getDomain(tab.url),
        favicon: tab.favIconUrl,
        spaceId: tab.spaceId ?? DEFAULT_SPACE_ID,
        totalTimeMs: tab.totalTimeMs ?? 0,
        openCount: tab.openCount ?? 0,
        lastOpenedAt: tab.lastOpenedAt ?? tab.lastActiveAt ?? tab.lastAccessed ?? 0,
        source: 'open',
      }));

    const archivedRows: AnalyticsRow[] = archived.map((tab, index) => ({
      id: `archived:${tab.id ?? index}`,
      tabId: tab.id,
      title: tab.title || tab.url || 'Archived tab',
      url: tab.url,
      domain: getDomain(tab.url),
      favicon: tab.favIconUrl,
      spaceId: tab.spaceId ?? DEFAULT_SPACE_ID,
      totalTimeMs: tab.totalTimeMs ?? 0,
      openCount: tab.openCount ?? 0,
      lastOpenedAt: tab.lastOpenedAt ?? tab.lastActiveAt ?? tab.archivedAt ?? 0,
      source: 'archived',
    }));

    const merged = [...openRows, ...archivedRows];
    const filtered = merged.filter((row) => spaceFilter === ALL_SPACES_ID || row.spaceId === spaceFilter);

    const sorted = [...filtered];
    switch (sortMode) {
      case 'most_used':
        sorted.sort((a, b) => b.totalTimeMs - a.totalTimeMs);
        break;
      case 'least_used':
        sorted.sort((a, b) => a.totalTimeMs - b.totalTimeMs);
        break;
      case 'most_recent':
        sorted.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
        break;
      case 'oldest':
        sorted.sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
        break;
    }
    return sorted;
  }, [tabs, archived, sortMode, spaceFilter]);

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  const selectedCount = selectedIds.size;

  const chartData = useMemo(() => {
    const byTime = [...rows].sort((a, b) => b.totalTimeMs - a.totalTimeMs);
    return byTime.map((row) => ({
      name: row.title.length > 30 ? `${row.title.slice(0, 30)}...` : row.title,
      value: row.totalTimeMs,
    }));
  }, [rows]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map((row) => row.id)));
  };

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));

  const handleBulkClose = () => {
    const openTabIds = selectedRows
      .filter((row) => row.source === 'open' && typeof row.tabId === 'number')
      .map((row) => row.tabId as number);
    if (openTabIds.length > 0) {
      void sendMessage({ type: 'CLOSE_TABS', tabIds: openTabIds });
    }
    setSelectedIds(new Set());
  };

  const handleBulkArchive = () => {
    // Archive system fallback: close selected open tabs.
    handleBulkClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#1a1a1a' }}>
      <div style={{ padding: '8px', borderBottom: '1px solid #333', display: 'flex', gap: '8px' }}>
        <button
          type="button"
          className="space-pill-add"
          title={showChart ? 'Hide chart' : 'Show chart'}
          aria-label={showChart ? 'Hide chart' : 'Show chart'}
          onClick={() => setShowChart((v) => !v)}
        >
          📈
        </button>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          style={{ flex: 1, background: '#2a2a2a', color: '#e5e5e5', border: '1px solid #333', borderRadius: '8px', padding: '8px' }}
        >
          <option value="most_used">Most used</option>
          <option value="least_used">Least used</option>
          <option value="most_recent">Most recent</option>
          <option value="oldest">Oldest</option>
        </select>
        <select
          value={spaceFilter}
          onChange={(e) => setSpaceFilter(e.target.value)}
          style={{ flex: 1, background: '#2a2a2a', color: '#e5e5e5', border: '1px solid #333', borderRadius: '8px', padding: '8px' }}
        >
          <option value={ALL_SPACES_ID}>All spaces</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>{space.name}</option>
          ))}
        </select>
      </div>

      {showChart && (
        <div style={{ height: '180px', borderBottom: '1px solid #333', padding: '8px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                formatter={(value: number) => formatDuration(value)}
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5' }}
              />
              <Bar dataKey="value" fill="#4a9eff" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ padding: '8px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input id="analytics-select-all" type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
        <label htmlFor="analytics-select-all" style={{ color: '#e5e5e5', fontSize: '13px' }}>
          Select all
        </label>
      </div>

      <div className="tab-list-container" style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: '#1a1a1a' }}>
        {rows.map((row) => (
          <div
            key={row.id}
            style={{
              margin: '8px',
              display: 'grid',
              gridTemplateColumns: '20px 20px minmax(0,1fr) auto auto auto',
              gap: '10px',
              alignItems: 'start',
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: 'transparent',
              borderLeft: '2px solid transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(55, 65, 81, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} />
            {row.favicon ? (
              <img src={row.favicon} alt="" style={{ width: '16px', height: '16px' }} />
            ) : (
              <div className="tab-icon-fallback" style={{ width: '16px', height: '16px', fontSize: '9px' }}>
                {(row.title || '•').charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#e5e5e5',
                  display: 'block',
                  width: '100%',
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  lineHeight: 1.3,
                }}
              >
                {row.title}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.domain}</div>
            </div>
            <div style={{ color: '#e5e5e5', fontSize: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatDuration(row.totalTimeMs)}</div>
            <div style={{ color: '#e5e5e5', fontSize: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{row.openCount}</div>
            <div style={{ color: '#9ca3af', fontSize: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatRelativeTime(row.lastOpenedAt)}</div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', padding: '24px' }}>No tabs found</div>
        )}
      </div>

      {selectedCount > 0 && (
        <div style={{ borderTop: '1px solid #333', padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#9ca3af', fontSize: '12px' }}>{selectedCount} selected</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="space-modal__btn space-modal__btn--secondary" onClick={handleBulkClose}>
              Close selected
            </button>
            <button type="button" className="space-modal__btn space-modal__btn--secondary" onClick={handleBulkArchive}>
              Archive selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
