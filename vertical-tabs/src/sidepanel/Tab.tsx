import type React from 'react';
import type { ExtendedTab } from '@/types';

type TabVariant = 'default' | 'compact' | 'minimal' | 'elongated' | 'single';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  variant?: TabVariant;
  onClick: () => void;
  onClose: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: (event: React.DragEvent) => void;
}

const variantStyles: Record<TabVariant, { width: string; height: string }> = {
  single: { width: '140px', height: '36px' },
  elongated: { width: '120px', height: '32px' },
  minimal: { width: '48px', height: '32px' },
  compact: { width: '96px', height: '32px' },
  default: { width: '200px', height: '38px' },
};

export default function Tab({
  tab,
  isActive,
  variant = 'default',
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: TabProps) {
  const styles = variantStyles[variant];
  const showTitle = variant === 'default' || variant === 'single' || variant === 'elongated' || variant === 'compact';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: styles.width,
        height: styles.height,
        padding: '6px 8px',
        borderRadius: '10px',
        background: isActive ? '#1f2937' : '#151515',
        border: isActive ? '1px solid #4a9eff' : '1px solid #242424',
        color: '#e5e5e5',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title={tab.title ?? tab.url ?? 'Untitled tab'}
    >
      {tab.favIconUrl ? (
        <img
          src={tab.favIconUrl}
          alt=""
          style={{ width: '16px', height: '16px', borderRadius: '4px' }}
        />
      ) : (
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '4px',
            background: '#333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
          }}
        >
          {tab.title?.charAt(0).toUpperCase() ?? '•'}
        </div>
      )}

      {showTitle && (
        <div
          style={{
            flex: 1,
            fontSize: '12px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.title ?? tab.url ?? 'Untitled'}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        style={{
          border: 'none',
          background: 'transparent',
          color: '#9ca3af',
          cursor: 'pointer',
          padding: 0,
          fontSize: '12px',
        }}
        aria-label="Close tab"
      >
        ✕
      </button>
    </div>
  );
}
