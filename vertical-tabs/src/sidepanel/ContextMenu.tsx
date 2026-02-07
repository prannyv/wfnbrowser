import { useEffect } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCopyLink: () => void;
  onReload: () => void;
  onCloseTab: () => void;
  onMute: () => void;
  isMuted: boolean;
  onTogglePin: () => void;
  isPinned: boolean;
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
  onTogglePin,
  isPinned,
}: ContextMenuProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const handleClick = () => onClose();

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: '#0f0f0f',
        border: '1px solid #333',
        borderRadius: '10px',
        padding: '6px',
        boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
        zIndex: 800,
        minWidth: '180px',
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <MenuButton label="Copy link" onClick={onCopyLink} />
      <MenuButton label="Reload tab" onClick={onReload} />
      <MenuButton label={isMuted ? 'Unmute' : 'Mute'} onClick={onMute} />
      <MenuButton label={isPinned ? 'Unpin tab' : 'Pin tab'} onClick={onTogglePin} />
      <MenuDivider />
      <MenuButton label="Close tab" onClick={onCloseTab} danger />
    </div>
  );
}

function MenuDivider() {
  return <div style={{ height: '1px', background: '#2a2a2a', margin: '6px 0' }} />;
}

function MenuButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderRadius: '8px',
        border: 'none',
        background: 'transparent',
        color: danger ? '#fca5a5' : '#e5e5e5',
        cursor: 'pointer',
        fontSize: '12px',
        textAlign: 'left',
      }}
    >
      {label}
    </button>
  );
}
