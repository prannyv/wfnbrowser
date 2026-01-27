import { memo, useState } from 'react';
import type { ExtendedTab } from '@/types';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}

// Memoized Tab component - only re-renders when props actually change
const Tab = memo(function Tab({ tab, isActive, onClick, onClose }: TabProps) {
  // Only track image error state - hover handled via CSS
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="tab-item"
      data-active={isActive}
      onClick={onClick}
      title={tab.title}
    >
      {/* Favicon */}
      <div className="tab-icon">
        {!imgError && tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="tab-icon-fallback">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Title */}
      <span className="tab-title">
        {tab.title || 'New Tab'}
      </span>

      {/* Close button */}
      <button
        className="tab-close"
        onClick={onClose}
        aria-label="Close tab"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <style>{`
        .tab-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-radius: 8px;
          cursor: pointer;
          margin-bottom: 12px;
          transition: background-color 0.15s;
          background-color: transparent;
          border-left: 2px solid transparent;
          user-select: none;
          -webkit-user-select: none;
        }
        
        .tab-item:hover {
          background-color: rgba(55, 65, 81, 0.4);
        }
        
        .tab-item[data-active="true"] {
          background-color: rgba(55, 65, 81, 0.5);
          border-left-color: #4a9eff;
        }
        
        .tab-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .tab-icon img {
          width: 32px;
          height: 32px;
          object-fit: contain;
        }
        
        .tab-icon-fallback {
          width: 32px;
          height: 32px;
          background-color: #4b5563;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .tab-icon-fallback svg {
          width: 20px;
          height: 20px;
          color: #9ca3af;
        }
        
        .tab-title {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
          font-weight: 500;
          color: #e5e5e5;
          line-height: 1.5;
        }
        
        .tab-close {
          padding: 4px;
          border-radius: 4px;
          background-color: transparent;
          border: none;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s, background-color 0.15s;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
        }
        
        .tab-item:hover .tab-close {
          opacity: 1;
        }
        
        .tab-close:hover {
          background-color: rgba(239, 68, 68, 0.2);
          color: #f87171;
        }
        
        .tab-close svg {
          width: 16px;
          height: 16px;
        }
      `}</style>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props change
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.tab.id === nextProps.tab.id &&
    prevProps.tab.title === nextProps.tab.title &&
    prevProps.tab.favIconUrl === nextProps.tab.favIconUrl &&
    prevProps.tab.pinned === nextProps.tab.pinned
  );
});

export default Tab;
