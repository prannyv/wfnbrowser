import { useState, useEffect, useCallback, useRef } from 'react';

type ResultType = 'tab' | 'bookmark' | 'history';

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
const DEFAULT_RECENT_COUNT = 4;
const HIGHLIGHT_ITEMS = 4;

function isUrl(query: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(query) ||
    /^[a-z0-9]+([\-.]{1}[a-z0-9]+)*\.[a-z]{2,}(\/.*)?$/i.test(query);
}

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isFocused, setIsFocused] = useState(true);
  const [pinnedTabs, setPinnedTabs] = useState<PinnedTab[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const loadHighlightedSections = useCallback(async () => {
    try {
      const [downloadItems, bookmarkTree, tabs] = await Promise.all([
        chrome.downloads.search({ limit: 25 }).then(items =>
          items
            .filter(d => d.state === 'complete' && d.filename && d.id !== undefined)
            .slice(0, HIGHLIGHT_ITEMS)
            .map(d => ({ id: d.id!, filename: d.filename.split(/[/\\]/).pop() ?? d.filename, url: d.finalUrl || d.url }))
        ),
        chrome.bookmarks.getTree(),
        chrome.tabs.query({ pinned: true }),
      ]);

      const bar = bookmarkTree[0]?.children?.find((n: { title: string }) => n.title === 'Bookmarks Bar');
      const bms = (bar?.children ?? [])
        .filter((n: { url?: string }) => n.url)
        .slice(0, HIGHLIGHT_ITEMS)
        .map((n) => ({ id: n.id!, title: n.title || n.url || '', url: n.url! }));

      const pinned = tabs
        .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
        .slice(0, HIGHLIGHT_ITEMS)
        .map(t => ({ id: t.id!, title: t.title || t.url || 'Untitled', url: t.url!, favIconUrl: t.favIconUrl }));

      setDownloads(downloadItems);
      setBookmarks(bms);
      setPinnedTabs(pinned);
    } catch (e) {
      console.error('[NewTab] Load highlighted error:', e);
    }
  }, []);

  const loadDefaultResults = useCallback(async () => {
    setIsSearching(true);
    try {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });

      const out: SearchResult[] = [];
      const seen = new Set<string>();

      for (const item of sessions) {
        if (out.length >= DEFAULT_RECENT_COUNT) break;

        if (item.tab) {
          const tab = item.tab as { sessionId?: string; url?: string; title?: string };
          if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
          const sessionId = tab.sessionId;
          if (!sessionId || seen.has(sessionId)) continue;
          seen.add(sessionId);
          out.push({
            id: `session:${sessionId}`,
            type: 'tab',
            title: tab.title || tab.url || 'Untitled',
            url: tab.url,
            favIconUrl: undefined,
          });
        } else if (item.window) {
          const win = item.window as { tabs?: Array<{ sessionId?: string; url?: string; title?: string }> };
          const tabs = win.tabs ?? [];
          for (const tab of tabs) {
            if (out.length >= DEFAULT_RECENT_COUNT) break;
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
            const sessionId = tab.sessionId;
            if (!sessionId || seen.has(sessionId)) continue;
            seen.add(sessionId);
            out.push({
              id: `session:${sessionId}`,
              type: 'tab',
              title: tab.title || tab.url || 'Untitled',
              url: tab.url,
              favIconUrl: undefined,
            });
          }
        }
      }

      setResults(out.slice(0, DEFAULT_RECENT_COUNT));
      setSelectedIndex(0);
      loadHighlightedSections();
    } catch (e) {
      console.error('[NewTab] Load default error:', e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [loadHighlightedSections]);

  const loadHighlights = useCallback(async () => {
    try {
      const [downloadItems, bookmarkTree] = await Promise.all([
        chrome.downloads.search({ limit: 25 }).then(items =>
          items
            .filter(d => d.state === 'complete' && d.filename && d.id !== undefined)
            .slice(0, HIGHLIGHT_ITEMS)
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
      bms = bms.slice(0, HIGHLIGHT_ITEMS);
      setDownloads(downloadItems);
      setBookmarks(bms);
    } catch (e) {
      console.error('[NewTab] Load highlights error:', e);
    }
  }, []);

  useEffect(() => {
    loadHighlights();
  }, [loadHighlights]);

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
        setDownloads([]);
        setBookmarks([]);
        setPinnedTabs([]);
      }
      setSelectedIndex(0);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    setDownloads([]);
    setBookmarks([]);
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
        setDownloads([]);
        setBookmarks([]);
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

      {isFocused && !query.trim() && (downloads.length > 0 || bookmarks.length > 0 || pinnedTabs.length > 0) && (
        <div className="newtab-highlights">
          {downloads.length > 0 && (
            <div className="newtab-highlight-card">
              <div className="newtab-highlight-title">Recent Downloads</div>
              <div className="newtab-highlight-grid">
                {downloads.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className="newtab-highlight-item"
                    onClick={() => chrome.downloads.open(d.id)}
                    title={d.filename}
                  >
                    <span className="newtab-highlight-icon">↓</span>
                    <span className="newtab-highlight-label">{d.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {bookmarks.length > 0 && (
            <div className="newtab-highlight-card">
              <div className="newtab-highlight-title">Bookmarks</div>
              <div className="newtab-highlight-grid">
                {bookmarks.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    className="newtab-highlight-item"
                    onClick={() => { window.location.href = b.url; }}
                    title={b.title}
                  >
                    <span className="newtab-highlight-icon">★</span>
                    <span className="newtab-highlight-label">{b.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
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

      <p className="newtab-footer">⌘K to focus · ⌘ Enter · Esc</p>
    </div>
  );
}
