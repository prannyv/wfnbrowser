import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Tab from './Tab';
import type { ExtendedTab } from '@/types';

interface SortableTabProps {
  tab: ExtendedTab;
  isActive: boolean;
  variant?: 'default' | 'compact' | 'minimal' | 'elongated' | 'single';
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function SortableTab({
  tab,
  isActive,
  variant,
  onClick,
  onClose,
  onContextMenu
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tab.id ?? -1 });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 999 : 'auto',
    position: 'relative',
    pointerEvents: isDragging ? 'none' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} data-tab-id={tab.id}>
      <Tab
        tab={tab}
        isActive={isActive}
        variant={variant}
        onClick={onClick}
        onClose={onClose}
        onContextMenu={onContextMenu}
      // Removed original drag handlers as dnd-kit handles it
      />
    </div>
  );
}
