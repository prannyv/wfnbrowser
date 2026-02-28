import { memo, useState, useRef, useLayoutEffect } from 'react';
import type React from 'react';
import type { ExtendedTab } from '@/types';

import type { FuseResultMatch } from 'fuse.js';

type TabVariant = 'default' | 'compact' | 'minimal' | 'elongated' | 'single';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  matches?: readonly FuseResultMatch[];
  searchHighlightQuery?: string;
  variant?: TabVariant;
  fullWidth?: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

const HighlightedText = ({ text, matches, query }: { text: string; matches?: readonly FuseResultMatch[]; query?: string }) => {
  if (query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);

    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <span key={i} className="highlight">{part}</span>
          ) : (
            part
          )
        )}
      </>
    );
  }

  if (!matches || matches.length === 0) return <>{text}</>;

  // Sort matches by start index
  const sortedMatches = [...matches].sort((a, b) => a.indices[0][0] - b.indices[0][0]);

  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  // For simplicity, we just handle the first set of indices for the first match that hits this text
  // Fuse matches can be complex, but for title/url search, this is usually enough
  const match = sortedMatches[0];

  for (const [start, end] of match.indices) {
    // Add text before match
    if (start > lastIndex) {
      result.push(text.slice(lastIndex, start));
    }
    // Add highlighted match
    result.push(
      <span key={`${start}-${end}`} className="highlight">
        {text.slice(start, end + 1)}
      </span>
    );
    lastIndex = end + 1;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return <>{result}</>;
};

// Memoized Tab component - only re-renders when props actually change
const Tab = memo(function Tab({ tab, isActive, matches, searchHighlightQuery, variant, fullWidth, onClick, onClose, onContextMenu, onDragStart, onDragEnd }: TabProps) {
  // Track image error and loading state
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevUrlRef = useRef<string | undefined>(undefined);

  if (tab.favIconUrl !== prevUrlRef.current) {
    prevUrlRef.current = tab.favIconUrl;
    if (imgError || imgLoaded) {
      setImgError(false);
      setImgLoaded(false);
    }
  }

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && tab.favIconUrl && !imgError && !imgLoaded) {
      if (img.complete && img.naturalHeight !== 0) {
        setImgLoaded(true);
      }
    }
  }, [tab.favIconUrl, imgError, imgLoaded]);

  const showSpinner = tab.favIconUrl && !imgError && !imgLoaded;

  const now = Date.now();
  const lastActiveAt = tab.lastActiveAt ?? now;
  const ageMs = now - lastActiveAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  let inactivityOpacity = 1;
  if (ageHours > 72) {
    inactivityOpacity = 0.55;
  } else if (ageHours > 24) {
    inactivityOpacity = 0.7;
  } else if (ageHours > 6) {
    inactivityOpacity = 0.85;
  }

  const isCompact = variant === 'compact';
  const isMinimal = variant === 'minimal';
  const isElongated = variant === 'elongated';
  const isSingle = variant === 'single';
  const isDefault = variant === 'default';

  const variantClass =
    isCompact ? 'tab-item-compact' :
    isMinimal ? 'tab-item-minimal' :
    isElongated ? 'tab-item-elongated' :
    isSingle ? 'tab-item-single' :
    '';

  const showTitle = isDefault || isElongated || isSingle;
  const classNames = ['tab-item', variantClass].filter(Boolean).join(' ');
  const isPinned = !!tab.pinned;
  const iconSize = isPinned ? '20px' : '32px';

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onClose(e);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={classNames}
      data-active={isActive}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={fullWidth ? { width: '100%' } : undefined}
      title={tab.title ?? tab.url ?? 'Untitled tab'}
    >
      <div className="tab-icon">
        {!imgError && tab.favIconUrl ? (
          <>
            {showSpinner && (
              <div className="tab-icon-loader">
                <div className="loader" />
              </div>
            )}
            <img
              ref={imgRef}
              src={tab.favIconUrl}
              alt=""
              key={tab.favIconUrl}
              onError={() => {
                setImgError(true);
              }}
              onLoad={() => {
                setImgLoaded(true);
              }}
              style={{
                display: imgLoaded ? 'block' : 'none',
                width: iconSize,
                height: iconSize,
                objectFit: 'contain',
              }}
            />
          </>
        ) : (
          <div className="tab-icon-fallback">
            {tab.title?.charAt(0).toUpperCase() ?? '•'}
          </div>
        )}
      </div>

      {showTitle && (
        <span
          className="tab-title"
          style={{
            opacity: isActive ? 1 : inactivityOpacity,
            transition: 'opacity 0.2s ease',
          }}
        >
          <HighlightedText
          text={tab.title || 'New Tab'}
          matches={matches?.filter(m => m.key === 'title')}
          query={searchHighlightQuery}
        />
        </span>
      )}

      {isDefault && (
        <button
          type="button"
          className="tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose(e);
          }}
          aria-label="Close tab"
        >
          ✕
        </button>
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.isActive === next.isActive &&
    prev.variant === next.variant &&
    prev.fullWidth === next.fullWidth &&
    prev.tab.id === next.tab.id &&
    prev.tab.title === next.tab.title &&
    prev.tab.favIconUrl === next.tab.favIconUrl &&
    prev.tab.pinned === next.tab.pinned &&
    prev.tab.url === next.tab.url &&
    prev.tab.lastActiveAt === next.tab.lastActiveAt &&
    prev.searchHighlightQuery === next.searchHighlightQuery &&
    JSON.stringify(prev.matches) === JSON.stringify(next.matches)
  );
});

export default Tab;
