import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCopyLink: () => void;
  onReload: () => void;
  onCloseTab: () => void;
  onMute: () => void;
  isMuted: boolean;
}

export default function ContextMenu({
  x,
  y,
  onClose,
  onCopyLink,
  onReload,
  onCloseTab,
  onMute,
  isMuted,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Close on outside click
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position if menu would go off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }
      if (y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }
      if (adjustedX < 8) adjustedX = 8;
      if (adjustedY < 8) adjustedY = 8;

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 10000,
      }}
    >
      <div className="context-menu-item" onClick={onCopyLink}>
        Copy Link
      </div>
      <div className="context-menu-item" onClick={onReload}>
        Reload
      </div>
      <div className="context-menu-item" onClick={onMute}>
        {isMuted ? 'Unmute' : 'Mute'}
      </div>
      <div className="context-menu-item context-menu-item-danger" onClick={onCloseTab}>
        Close
      </div>
      <style>{`
        .context-menu {
          background-color: #2a2a2a;
          border: 1px solid #404040;
          border-radius: 8px;
          padding: 4px;
          min-width: 160px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          animation: context-menu-enter 0.1s ease-out;
        }

        @keyframes context-menu-enter {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .context-menu-item {
          padding: 8px 12px;
          font-size: 14px;
          color: #e5e5e5;
          cursor: pointer;
          border-radius: 4px;
          transition: background-color 0.1s;
          user-select: none;
        }

        .context-menu-item:hover {
          background-color: rgba(55, 65, 81, 0.6);
        }

        .context-menu-item-danger {
          color: #f87171;
        }

        .context-menu-item-danger:hover {
          background-color: rgba(239, 68, 68, 0.2);
        }
      `}</style>
    </div>
  );
}

