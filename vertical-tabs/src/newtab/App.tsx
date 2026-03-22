import { useState, useEffect, useCallback, useRef } from 'react';

type ResultType = 'tab' | 'bookmark' | 'history';
type TopSitesMode = 'frequent' | 'recent' | 'manual';

interface TopSiteItem {
  url: string;
  title: string;
}

interface TopSitesConfig {
  mode: TopSitesMode;
  count: number;
}

const TOP_SITES_STORAGE_KEY = 'newtab-topsites-config';
const REMOVED_URLS_STORAGE_KEY = 'newtab-topsites-removed';
const MANUAL_SITES_STORAGE_KEY = 'newtab-topsites-manual';
const DEFAULT_TOP_SITES_COUNT = 8;
const MAX_TOP_SITES_COUNT = 16;

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  url: string;
  favIconUrl?: string;
}

interface DownloadItem {
  id: number;
  filename: string;
  url: string;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
}

interface PinnedTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

const DEBOUNCE_MS = 80;
const MAX_RESULTS = 8;
const HIGHLIGHT_ITEMS = 4;
const BOTTOM_SECTION_ITEMS = 8;

function isUrl(query: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(query) ||
    /^[a-z0-9]+([\-.]{1}[a-z0-9]+)*\.[a-z]{2,}(\/.*)?$/i.test(query);
}

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const [pinnedTabs, setPinnedTabs] = useState<PinnedTab[]>([]);
  const [bottomBookmarks, setBottomBookmarks] = useState<BookmarkItem[]>([]);
  const [bottomDownloads, setBottomDownloads] = useState<DownloadItem[]>([]);
  const [topSites, setTopSites] = useState<TopSiteItem[]>([]);
  const [topSitesConfig, setTopSitesConfig] = useState<TopSitesConfig>({
    mode: 'frequent',
    count: DEFAULT_TOP_SITES_COUNT,
  });
  const [removedUrls, setRemovedUrls] = useState<Set<string>>(new Set());
  const [manualSites, setManualSites] = useState<TopSiteItem[]>([]);
  const [topSitesSettingsOpen, setTopSitesSettingsOpen] = useState(false);
  const [addSiteUrl, setAddSiteUrl] = useState('');
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const loadHighlightedSections = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ pinned: true });
      const pinned = tabs
        .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
        .slice(0, HIGHLIGHT_ITEMS)
        .map(t => ({ id: t.id!, title: t.title || t.url || 'Untitled', url: t.url!, favIconUrl: t.favIconUrl }));
      setPinnedTabs(pinned);
    } catch (e) {
      console.error('[NewTab] Load highlighted error:', e);
    }
  }, []);

  const loadDefaultResults = useCallback(async () => {
    setIsSearching(true);
    try {
      // Don't show recent tabs in search results - just load highlights
      setResults([]);
      setSelectedIndex(0);
      loadHighlightedSections();
    } catch (e) {
      console.error('[NewTab] Load default error:', e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [loadHighlightedSections]);


  const loadBottomSections = useCallback(async () => {
    try {
      const [downloadItems, bookmarkTree] = await Promise.all([
        chrome.downloads.search({ limit: 50 }).then(items =>
          items
            .filter(d => d.state === 'complete' && d.filename && d.id !== undefined)
            .slice(0, BOTTOM_SECTION_ITEMS)
            .map(d => ({ id: d.id!, filename: d.filename.split(/[/\\]/).pop() ?? d.filename, url: d.finalUrl || d.url || '' }))
        ),
        chrome.bookmarks.getTree(),
      ]);

      const flatten = (nodes: Array<{ id?: string; title?: string; url?: string; children?: unknown[] }>): Array<{ id: string; title: string; url: string }> => {
        const out: Array<{ id: string; title: string; url: string }> = [];
        for (const n of nodes) {
          if (n.url) out.push({ id: n.id ?? '', title: n.title || n.url, url: n.url });
          if (n.children?.length) out.push(...flatten(n.children as typeof nodes));
        }
        return out;
      };

      const root = bookmarkTree[0];
      const barFolder = root?.children?.[0];
      const otherFolder = root?.children?.[1];
      let bms = flatten(barFolder?.children ?? []);
      if (bms.length === 0) bms = flatten(otherFolder?.children ?? []);
      if (bms.length === 0) {
        try {
          bms = flatten(await chrome.bookmarks.getChildren('1'));
        } catch {
          /* id "1" may not exist in some setups */
        }
      }
      bms = bms.slice(0, BOTTOM_SECTION_ITEMS);

      setBottomDownloads(downloadItems);
      setBottomBookmarks(bms);
    } catch (e) {
      console.error('[NewTab] Load bottom sections error:', e);
    }
  }, []);

  useEffect(() => {
    loadBottomSections();
  }, [loadBottomSections]);

  // Load top sites config from storage
  useEffect(() => {
    chrome.storage.local.get([TOP_SITES_STORAGE_KEY, REMOVED_URLS_STORAGE_KEY, MANUAL_SITES_STORAGE_KEY]).then((result: Record<string, unknown>) => {
      const cfg = result[TOP_SITES_STORAGE_KEY] as TopSitesConfig | undefined;
      if (cfg && typeof cfg === 'object' && 'mode' in cfg) {
        setTopSitesConfig(cfg);
      }
      const removed = result[REMOVED_URLS_STORAGE_KEY] as string[] | undefined;
      if (Array.isArray(removed)) {
        setRemovedUrls(new Set(removed));
      }
      const manual = result[MANUAL_SITES_STORAGE_KEY] as TopSiteItem[] | undefined;
      if (Array.isArray(manual)) {
        setManualSites(manual);
      }
    });
  }, []);

  const loadTopSites = useCallback(async () => {
    const config = topSitesConfig;
    const removed = removedUrls;
    const limit = Math.min(Math.max(1, config.count), MAX_TOP_SITES_COUNT);

    try {
      if (config.mode === 'manual') {
        setTopSites(manualSites.slice(0, limit));
        return;
      }

      if (config.mode === 'frequent') {
        const items = await chrome.topSites.get();
        const filtered = items
          .filter((i) => !removed.has(i.url) && !i.url.startsWith('chrome://') && !i.url.startsWith('chrome-extension://'))
          .slice(0, limit)
          .map((i) => ({
            url: i.url,
            title: i.title || new URL(i.url).hostname || i.url,
          }));
        setTopSites(filtered);
        return;
      }

      if (config.mode === 'recent') {
        const historyItems = await chrome.history.search({
          text: '',
          maxResults: 100,
          startTime: 0,
        });
        const seen = new Set<string>();
        const filtered: TopSiteItem[] = [];
        for (const h of historyItems) {
          if (!h.url || h.url.startsWith('chrome://') || h.url.startsWith('chrome-extension://') || removed.has(h.url)) continue;
          const norm = h.url.replace(/\/$/, '');
          if (seen.has(norm)) continue;
          seen.add(norm);
          filtered.push({
            url: h.url,
            title: h.title || new URL(h.url).hostname || h.url,
          });
          if (filtered.length >= limit) break;
        }
        setTopSites(filtered);
      }
    } catch (e) {
      console.error('[NewTab] Load top sites error:', e);
      setTopSites([]);
    }
  }, [topSitesConfig, removedUrls, manualSites]);

  useEffect(() => {
    loadTopSites();
  }, [loadTopSites]);

  const removeFromTopSites = useCallback(
    (url: string) => {
      if (topSitesConfig.mode === 'manual') {
        const next = manualSites.filter((s) => s.url !== url);
        setManualSites(next);
        chrome.storage.local.set({ [MANUAL_SITES_STORAGE_KEY]: next });
      } else {
        const next = new Set(removedUrls);
        next.add(url);
        setRemovedUrls(next);
        chrome.storage.local.set({ [REMOVED_URLS_STORAGE_KEY]: Array.from(next) });
      }
    },
    [topSitesConfig.mode, manualSites, removedUrls]
  );

  const updateTopSitesConfig = useCallback((updates: Partial<TopSitesConfig>) => {
    setTopSitesConfig((prev) => {
      const next = { ...prev, ...updates };
      chrome.storage.local.set({ [TOP_SITES_STORAGE_KEY]: next });
      return next;
    });
  }, []);

  const addManualSite = useCallback(
    (url: string, title?: string) => {
      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const norm = parsed.href;
        if (manualSites.some((s) => s.url === norm)) return;
        const item: TopSiteItem = {
          url: norm,
          title: title || parsed.hostname || norm,
        };
        const next = [...manualSites, item];
        setManualSites(next);
        chrome.storage.local.set({ [MANUAL_SITES_STORAGE_KEY]: next });
        setAddSiteUrl('');
        setAddSiteOpen(false);
      } catch {
        /* invalid url */
      }
    },
    [manualSites]
  );

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const [tabs, bookmarks, historyItems] = await Promise.all([
        chrome.tabs.query({}),
        chrome.bookmarks.search(trimmed),
        chrome.history.search({ text: trimmed, maxResults: 50, startTime: 0 }),
      ]);

      const seen = new Set<string>();
      const out: SearchResult[] = [];

      for (const tab of tabs) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
        const key = `tab:${tab.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const title = (tab.title || tab.url || 'Untitled').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        if (title.includes(trimmed) || url.includes(trimmed)) {
          out.push({
            id: key,
            type: 'tab',
            title: tab.title || tab.url || 'Untitled',
            url: tab.url!,
            favIconUrl: tab.favIconUrl,
          });
        }
      }

      for (const bm of bookmarks) {
        if (!bm.url) continue;
        const key = `bm:${bm.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: key,
          type: 'bookmark',
          title: bm.title || bm.url,
          url: bm.url,
          favIconUrl: undefined,
        });
      }

      for (const h of historyItems) {
        if (!h.url || h.url.startsWith('chrome://')) continue;
        const key = `hist:${h.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: key,
          type: 'history',
          title: h.title || h.url,
          url: h.url,
          favIconUrl: undefined,
        });
      }

      setResults(out.slice(0, MAX_RESULTS));
      setSelectedIndex(0);
    } catch (e) {
      console.error('[NewTab] Search error:', e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      if (isFocused) {
        loadDefaultResults();
      } else {
        setResults([]);
        setPinnedTabs([]);
      }
      setSelectedIndex(0);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    setPinnedTabs([]);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isFocused, search, loadDefaultResults]);

  const goTo = useCallback((result: SearchResult | null) => {
    if (result) {
      if (result.type === 'tab' && result.id.startsWith('session:')) {
        const sessionId = result.id.replace('session:', '');
        chrome.sessions.restore(sessionId);
      } else if (result.type === 'tab') {
        const tabId = parseInt(result.id.replace('tab:', ''), 10);
        chrome.tabs.get(tabId).then(tab => {
          chrome.tabs.update(tabId, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
        }).catch(() => {});
      } else {
        window.location.href = result.url;
      }
      return;
    }
    if (!query.trim()) return;
    if (isUrl(query)) {
      const url = query.startsWith('http') ? query : `https://${query}`;
      window.location.href = url;
    } else {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
  }, [query]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const top = results[selectedIndex] ?? null;
    goTo(top);
  }, [results, selectedIndex, goTo]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (!query.trim()) loadDefaultResults();
  }, [query, loadDefaultResults]);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsFocused(false);
      if (!queryRef.current.trim()) {
        setResults([]);
        setPinnedTabs([]);
      }
    }, 180);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      inputRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % Math.max(1, results.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + results.length) % Math.max(1, results.length));
    }
  }, [results.length]);

  return (
    <div className="newtab-root">
      <form onSubmit={handleSubmit} className="newtab-form">
        <div className="newtab-input-wrap">
          {results.length > 0 && (
            <ul className="newtab-results" role="listbox">
              {results.map((r, i) => (
                <li
                  key={r.id}
                  role="option"
                  aria-selected={i === selectedIndex}
                  className={`newtab-result ${i === selectedIndex ? 'newtab-result--selected' : ''}`}
                  onClick={() => goTo(r)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  {r.favIconUrl ? (
                    <img src={r.favIconUrl} alt="" className="newtab-result-icon" />
                  ) : (
                    <span className="newtab-result-icon-placeholder">
                      {r.type === 'tab' ? '◉' : r.type === 'bookmark' ? '★' : '🕐'}
                    </span>
                  )}
                  <div className="newtab-result-content">
                    <span className="newtab-result-title">{r.title || r.url}</span>
                    <span className="newtab-result-url">{r.url}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="Search or enter URL"
            autoFocus
            autoComplete="off"
            className="newtab-input"
            aria-label="Search"
          />
        </div>

        {query.trim() && results.length === 0 && !isSearching && (
          <p className="newtab-hint">Press Enter to search Google</p>
        )}
      </form>

      {!query.trim() && (topSites.length > 0 || topSitesConfig.mode === 'manual') && (
        <div className="newtab-topsites">
          <div className="newtab-topsites-header">
            <span className="newtab-topsites-title">
              {topSitesConfig.mode === 'frequent' ? 'Frequent' : topSitesConfig.mode === 'recent' ? 'Recent' : 'Shortcuts'}
            </span>
            <div className="newtab-topsites-actions">
              {topSitesConfig.mode === 'manual' && (
                <button
                  type="button"
                  className="newtab-topsites-add-btn"
                  onClick={() => setAddSiteOpen(true)}
                  title="Add site"
                  aria-label="Add site"
                >
                  +
                </button>
              )}
              <div className="newtab-topsites-settings-wrap">
                <button
                  type="button"
                  className="newtab-topsites-settings-btn"
                  onClick={() => setTopSitesSettingsOpen((o) => !o)}
                  title="Settings"
                  aria-label="Top sites settings"
                  aria-expanded={topSitesSettingsOpen}
                >
                  ⚙
                </button>
                {topSitesSettingsOpen && (
                  <>
                    <div
                      className="newtab-topsites-settings-backdrop"
                      onClick={() => setTopSitesSettingsOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="newtab-topsites-settings-popover">
                      <div className="newtab-topsites-settings-row">
                        <label>Mode</label>
                        <select
                          value={topSitesConfig.mode}
                          onChange={(e) => updateTopSitesConfig({ mode: e.target.value as TopSitesMode })}
                          className="newtab-topsites-select"
                        >
                          <option value="frequent">Frequent</option>
                          <option value="recent">Recent</option>
                          <option value="manual">Manual</option>
                        </select>
                      </div>
                      <div className="newtab-topsites-settings-row">
                        <label>Count</label>
                        <select
                          value={topSitesConfig.count}
                          onChange={(e) => updateTopSitesConfig({ count: parseInt(e.target.value, 10) })}
                          className="newtab-topsites-select"
                        >
                          {[4, 6, 8, 10, 12, 16].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="newtab-topsites-grid">
            {topSites.length === 0 && topSitesConfig.mode === 'manual' && (
              <p className="newtab-topsites-empty">Add shortcuts with the + button</p>
            )}
            {topSites.map((site) => (
              <div key={site.url} className="newtab-topsites-item-wrap">
                <a
                  href={site.url}
                  className="newtab-topsites-item"
                  title={site.title}
                >
                  <span className="newtab-topsites-item-label">{site.title}</span>
                </a>
                <button
                  type="button"
                  className="newtab-topsites-item-remove"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromTopSites(site.url);
                  }}
                  title="Remove"
                  aria-label={`Remove ${site.title}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {addSiteOpen && (
        <div className="newtab-addsite-backdrop" onClick={() => setAddSiteOpen(false)}>
          <div className="newtab-addsite-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="newtab-addsite-title">Add shortcut</h3>
            <input
              type="url"
              className="newtab-addsite-input"
              placeholder="https://example.com"
              value={addSiteUrl}
              onChange={(e) => setAddSiteUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addManualSite(addSiteUrl);
                if (e.key === 'Escape') setAddSiteOpen(false);
              }}
              autoFocus
            />
            <div className="newtab-addsite-actions">
              <button type="button" className="newtab-addsite-cancel" onClick={() => setAddSiteOpen(false)}>
                Cancel
              </button>
              <button type="button" className="newtab-addsite-add" onClick={() => addManualSite(addSiteUrl)}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {isFocused && !query.trim() && pinnedTabs.length > 0 && (
        <div className="newtab-highlights">
          {pinnedTabs.length > 0 && (
            <div className="newtab-highlight-card">
              <div className="newtab-highlight-title">Pinned Tabs</div>
              <div className="newtab-highlight-grid">
                {pinnedTabs.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className="newtab-highlight-item"
                    onClick={() => {
                      chrome.tabs.update(t.id, { active: true });
                      chrome.tabs.get(t.id).then(tab => chrome.windows.update(tab.windowId!, { focused: true })).catch(() => {});
                    }}
                    title={t.title}
                  >
                    {t.favIconUrl ? (
                      <img src={t.favIconUrl} alt="" className="newtab-highlight-favicon" />
                    ) : (
                      <span className="newtab-highlight-icon">◉</span>
                    )}
                    <span className="newtab-highlight-label">{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(bottomBookmarks.length > 0 || bottomDownloads.length > 0) && (
        <div className="newtab-bottom-sections">
          {bottomBookmarks.length > 0 && (
            <div className="newtab-bottom-section">
              <div className="newtab-bottom-section-title">Bookmarks</div>
              <div className="newtab-bottom-section-list">
                {bottomBookmarks.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    className="newtab-bottom-item"
                    onClick={() => { window.location.href = b.url; }}
                    title={b.title}
                  >
                    <span className="newtab-bottom-item-icon">★</span>
                    <span className="newtab-bottom-item-label">{b.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {bottomDownloads.length > 0 && (
            <div className="newtab-bottom-section">
              <div className="newtab-bottom-section-title">Recent Downloads</div>
              <div className="newtab-bottom-section-list">
                {bottomDownloads.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className="newtab-bottom-item"
                    onClick={() => chrome.downloads.open(d.id)}
                    title={d.filename}
                  >
                    <span className="newtab-bottom-item-icon">↓</span>
                    <span className="newtab-bottom-item-label">{d.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="newtab-footer">⌘K to focus · ⌘ Enter · Esc</p>
    </div>
  );
}
