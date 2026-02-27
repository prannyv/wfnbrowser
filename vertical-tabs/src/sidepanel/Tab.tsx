import { memo, useState, useRef, useLayoutEffect } from 'react';
import type React from 'react';
import type { ExtendedTab } from '@/types';

type TabVariant = 'default' | 'compact' | 'minimal' | 'elongated' | 'single';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  variant?: TabVariant;
  fullWidth?: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

const Tab = memo(function Tab({
  tab,
  isActive,
  variant = 'default',
  fullWidth = false,
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: TabProps) {
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
  const lastActiveAt = tab.lastActiveAt ?? tab.lastAccessed ?? now;
  const ageMs = now - lastActiveAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  let inactivityOpacity = 1;
  if (ageHours > 6) {
    inactivityOpacity = 0.3;
  } else if (ageHours > 3) {
    inactivityOpacity = 0.5;
  } else if (ageHours > 1) {
    inactivityOpacity = 0.8;
  }
  const titleInactivityOpacity = Math.min(1, inactivityOpacity + 0.5);
  const isVeryStale = ageHours > 6 && !isActive;

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
  const classNames = ['tab-item', variantClass, isVeryStale ? 'tab-item--dusty' : '']
    .filter(Boolean)
    .join(' ');
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
      <div
        className="tab-icon"
        style={{
          opacity: isActive ? 1 : inactivityOpacity,
          transition: 'opacity 0.2s ease',
        }}
      >
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
              onError={() => setImgError(true)}
              onLoad={() => setImgLoaded(true)}
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
        <>
          <span
            className="tab-title"
            style={{
              opacity: isActive ? 1 : titleInactivityOpacity,
              transition: 'opacity 0.2s ease',
            }}
          >
            {tab.title || 'New Tab'}
          </span>
          {isVeryStale && (
            <>
              <span className="tab-dust-fall" aria-hidden="true" />
              <span className="tab-dust-settled" aria-hidden="true" />
            </>
          )}
        </>
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
    prev.tab.lastActiveAt === next.tab.lastActiveAt
  );
});

export default Tab;
