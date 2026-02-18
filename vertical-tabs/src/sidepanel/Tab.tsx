import { memo } from 'react';
import type React from 'react';
import type { ExtendedTab } from '@/types';

type TabVariant = 'default' | 'compact' | 'minimal' | 'elongated' | 'single';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  variant?: TabVariant;
  fullWidth?: boolean;
  onClick: () => void;
  onClose: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: (event: React.DragEvent) => void;
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
        {tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="tab-icon-fallback">
            {tab.title?.charAt(0).toUpperCase() ?? '•'}
          </div>
        )}
      </div>

      {showTitle && (
        <div className="tab-title">
          {tab.title ?? tab.url ?? 'Untitled'}
        </div>
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
    prev.tab.url === next.tab.url
  );
});

export default Tab;
