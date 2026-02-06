import { memo, useState, useLayoutEffect, useRef } from 'react';
import type { ExtendedTab } from '@/types';

interface TabProps {
  tab: ExtendedTab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

// Memoized Tab component - only re-renders when props actually change
// Memoized Tab component - only re-renders when props actually change
const Tab = memo(function Tab({
  tab,
  isActive,
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
  variant = 'default',
}: TabProps & {
  variant?: 'default' | 'compact' | 'minimal' | 'elongated' | 'single';
}) {
  // Track image error and loading state
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevUrlRef = useRef<string | undefined>(undefined);

  // Reset states when favIconUrl changes (during render, before effects)
  if (tab.favIconUrl !== prevUrlRef.current) {
    prevUrlRef.current = tab.favIconUrl;
    // Only reset if we had a previous URL (not initial mount)
    if (imgError || imgLoaded) {
      setImgError(false);
      setImgLoaded(false);
    }
  }

  // Check for cached images immediately after DOM update
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && tab.favIconUrl && !imgError && !imgLoaded) {
      // Image is already loaded (cached)
      if (img.complete && img.naturalHeight !== 0) {
        setImgLoaded(true);
      }
    }
  }, [tab.favIconUrl, imgError, imgLoaded]);

  // Show loading spinner when: we have a URL, no error, and not yet loaded
  const showSpinner = tab.favIconUrl && !imgError && !imgLoaded;

  // Handle middle-click to close tab
  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle mouse button (button 1) closes the tab
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onClose(e);
    }
  };

  const isCompact = variant === 'compact';
  const isMinimal = variant === 'minimal';
  const isElongated = variant === 'elongated';
  const isSingle = variant === 'single';
  const isDefault = variant === 'default';

  return (
    <div
      className={`tab-item ${isCompact ? 'tab-item-compact' : ''} ${isMinimal ? 'tab-item-minimal' : ''} ${isElongated ? 'tab-item-elongated' : ''} ${isSingle ? 'tab-item-single' : ''}`}
      data-active={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={handleMouseDown}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={tab.title}
    >
      {/* Favicon */}
      <div className="tab-icon">
        {!imgError && tab.favIconUrl ? (
          <>
            {showSpinner && (
              <div className="tab-icon-loader">
                <div className="loader"></div>
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
                width: (isDefault) ? '32px' : '20px',
                height: (isDefault) ? '32px' : '20px',
                objectFit: 'contain',
              }}
            />
          </>
        ) : (
          <div className="tab-icon-fallback">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Title - Only show if default */}
      {isDefault && (
        <span className="tab-title">
          {tab.title || 'New Tab'}
        </span>
      )}

      {/* Close button - Only show if default */}
      {isDefault && (
        <button
          className="tab-close"
          onClick={onClose}
          aria-label="Close tab"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

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
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .tab-item-compact {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;  
          min-width: 0;
          background-color: rgba(48, 49, 50, 0.4);
          padding: 8px;
          gap: 1px;
          margin-bottom: 0;
          justify-content: center;
          width: calc(33.33% - 3px);
          height: 36px;
        }

        .tab-item-minimal {
          display: flex;
          flex-direction: column;
          flex-wrap: wrap;  
          min-width: 0;
          background-color: rgba(48, 49, 50, 0.4);
          padding: 8px;
          gap: 0;
          margin-bottom: 0;
          justify-content: center;
          width: calc(50% - 2px);
          height: 36px;
        }
        
        .tab-item-elongated {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;  
          width: calc(50% - 2px);
          height: 56px;
          background-color: rgba(48, 49, 50, 0.4);
          padding: 8px;
          gap: 12px;
          margin-bottom: 0;
          justify-content: center;
        }
        
        .tab-item-single {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;  
          align-items: center;
          width: 100%;
          padding: 8px;
          gap: 12px;
          margin-bottom: 0;
          height: 56px;
          background-color: rgba(48, 49, 50, 0.4);
          justify-content: center;
          margin: 0 auto;
        }
        
        .tab-item * {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }
        
        .tab-item:hover {
          background-color: rgba(55, 65, 81, 0.4);
        }
        
        .tab-item[data-active="true"] {
          background-color: rgba(55, 65, 81, 0.5);
          border-left-color: #233955ff;
        }

        .tab-item-compact[data-active="true"],
        .tab-item-minimal[data-active="true"],
        .tab-item-elongated[data-active="true"],
        .tab-item-single[data-active="true"] {
          border-left: none;
          border-bottom: 2px solid #233955ff; 
        }
        
        .tab-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .tab-item-compact .tab-icon,
        .tab-item-minimal .tab-icon,
        .tab-item-elongated .tab-icon,
        .tab-item-single .tab-icon {
          width: 20px;
          height: 20px;
        }
        
        .tab-icon img {
          width: 32px;
          height: 32px;
          object-fit: contain;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .tab-item-compact .tab-icon img,
        .tab-item-minimal .tab-icon img,
        .tab-item-elongated .tab-icon img,
        .tab-item-single .tab-icon img {
          width: 20px;
          height: 20px;
        }
        
        .tab-icon-fallback {
          width: 32px;
          height: 32px;
          background-color: #4b5563;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .tab-item-compact .tab-icon-fallback,
        .tab-item-minimal .tab-icon-fallback,
        .tab-item-elongated .tab-icon-fallback,
        .tab-item-single .tab-icon-fallback {
            width: 20px;
            height: 20px;
        }
        
        .tab-icon-fallback svg {
          width: 20px;
          height: 20px;
          color: #9ca3af;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        .tab-item-compact .tab-icon-fallback svg,
        .tab-item-minimal .tab-icon-fallback svg,
        .tab-item-elongated .tab-icon-fallback svg,
        .tab-item-single .tab-icon-fallback svg {
            width: 14px;
            height: 14px;
        }
        
        .tab-icon-loader {
          position: absolute;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tab-item-compact .tab-icon-loader,
        .tab-item-minimal .tab-icon-loader,
        .tab-item-elongated .tab-icon-loader,
        .tab-item-single .tab-icon-loader {
            width: 20px;
            height: 20px;
        }
        
        .loader {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          position: relative;
          animation: rotate 1s linear infinite;
        }

        .tab-item-compact .loader,
        .tab-item-minimal .loader,
        .tab-item-elongated .loader,
        .tab-item-single .loader {
            width: 20px;
            height: 20px;
            border-width: 2px;
        }
        
        .loader::before {
          content: "";
          box-sizing: border-box;
          position: absolute;
          inset: 0px;
          border-radius: 50%;
          border: 3px solid #9ca3af;
          animation: prixClipFix 2s linear infinite;
        }

        .tab-item-compact .loader::before,
        .tab-item-minimal .loader::before,
        .tab-item-elongated .loader::before,
        .tab-item-single .loader::before {
            border-width: 2px;
        }
        
        @keyframes rotate {
          100% { transform: rotate(360deg); }
        }
        
        @keyframes prixClipFix {
          0%   { clip-path: polygon(50% 50%, 0 0, 0 0, 0 0, 0 0, 0 0); }
          25%  { clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 0, 100% 0, 100% 0); }
          50%  { clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 100%, 100% 100%, 100% 100%); }
          75%  { clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 100%, 0 100%, 0 100%); }
          100% { clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 100%, 0 100%, 0 0); }
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
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
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
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
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
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -khtml-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
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
    prevProps.tab.pinned === nextProps.tab.pinned &&
    prevProps.variant === nextProps.variant
  );
});

export default Tab;
