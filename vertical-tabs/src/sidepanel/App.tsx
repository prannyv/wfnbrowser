import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import type { FuseResultMatch } from 'fuse.js';
import type React from 'react';
import type { ExtendedTab, Space } from '@/types';
import { sendMessage, onMessage } from '@/lib/messages';
import Tab from './Tab';
import ContextMenu from './ContextMenu';

const DEFAULT_SPACE_ID = 'default';
const ALL_TABS_ID = 'all';

const SPACE_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E0BBE4', '#957DAD', '#D291BC', '#FEC8D8', '#FFDFD3',
  '#B5EAD7', '#C7CEEA', '#A8E6CF', '#DCEDC1', '#FFD3B6',
  '#FFAAA5', '#FF8B94', '#a8dadc', '#457b9d', '#e9c46a',
  '#2a9d8f', '#e76f51', '#f4a261', '#9b5de5', '#00bbf9',
];

const BASE_BG = '#1a1a1a';

function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6;
}

function blendWithBase(hex: string, base: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const b = base.replace('#', '');
  if (full.length !== 6 || b.length !== 6) return base;
  const r = Math.round(parseInt(b.slice(0, 2), 16) * (1 - alpha) + parseInt(full.slice(0, 2), 16) * alpha);
  const g = Math.round(parseInt(b.slice(2, 4), 16) * (1 - alpha) + parseInt(full.slice(2, 4), 16) * alpha);
  const bl = Math.round(parseInt(b.slice(4, 6), 16) * (1 - alpha) + parseInt(full.slice(4, 6), 16) * alpha);
  return `rgb(${r}, ${g}, ${bl})`;
}

interface SpaceTheme {
  bg: string;
  inputBg: string;
  border: string;
  spacesBarBg: string;
  spacesBarBorder: string;
}

const DEFAULT_THEME: SpaceTheme = {
  bg: BASE_BG,
  inputBg: '#2a2a2a',
  border: '#333',
  spacesBarBg: 'linear-gradient(0deg, rgba(30, 30, 32, 0.98) 0%, rgba(22, 22, 24, 0.98) 100%)',
  spacesBarBorder: 'rgba(255, 255, 255, 0.06)',
};

function buildSpaceTheme(hex: string): SpaceTheme {
  return {
    bg: blendWithBase(hex, BASE_BG, 0.35),
    inputBg: blendWithBase(hex, '#2a2a2a', 0.30),
    border: blendWithBase(hex, '#333333', 0.25),
    spacesBarBg: blendWithBase(hex, '#1a1a1c', 0.30),
    spacesBarBorder: blendWithBase(hex, '#333333', 0.20),
  };
}

const SPACE_EMOJIS = [
  '💼','📁','📂','📋','📌','🗂️','📎','📝','✏️','🖊️','🖋️',
  '📊','📈','📉','📅','🗓️','⏰','👥','🤝','📣','🧾',
  '🏢','🧑‍💼','📇','🪪','📤','📥','🔖','📍',
  '🎓','📚','📖','🧠','🧮','📐','📏','🧪','🔬',
  '🧬','🌍','🏫','🧑‍🏫','👩‍🏫','👨‍🏫','📓','📒','📔',
  '🗒️','📄','🖍️','📘','📙','📗','📕',
  '💰','💵','💴','💶','💷','🪙','💳','🏦',
  '💸','💹','📑','⚖️','🔢','💲',
  '🎨','🖌️','🧵','🪡','🧶','🎭','🎬',
  '🎤','🎧','🎼','🎹','🥁','📷','📸','🎞️','🖼️',
  '✨','🌈','💡','🪄','🌟','🎇','🎆','🧩',
  '💻','🖥️','⌨️','🖱️','📱','🧑‍💻','👨‍💻','👩‍💻',
  '⚙️','🔧','🛠️','🔌','🔋','💾','📡','🌐',
  '☁️','🛰️','🤖','🔍','🧱',
  '🏠','🛋️','🛏️','🚗','✈️','🧳','🛒','🍕','☕',
  '🌿','🌸','🐱','🐶','🦊','🦁','🐼','🦋',
  '☀️','🌙','⭐','❤️','💙','💚','💛',
  '✅','❌','⚠️','⛔','🟢','🟡','🔴','🔵','🟣',
  '🔥','🚀','🔒','🔓','🔄','⏳'
];


export default function App() {
  const [tabs, setTabs] = useState<ExtendedTab[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>(ALL_TABS_ID);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [spaceModal, setSpaceModal] = useState<{ mode: 'create' | 'edit'; spaceId?: string } | null>(null);
  const [spaceForm, setSpaceForm] = useState<{ name: string; color: string; icon: string }>({
    name: '',
    color: SPACE_COLORS[0],
    icon: '',
  });
  const [errorMessage, setErrorMessage] = useState<{ text: string; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tab: ExtendedTab;
  } | null>(null);
  const [isDragOverPinned, setIsDragOverPinned] = useState(false);
  const [draggedTab, setDraggedTab] = useState<number | null>(null);
  const [isDragOverRegular, setIsDragOverRegular] = useState(false);
  const [dragOverSpaceId, setDragOverSpaceId] = useState<string | null>(null);
  const [dragGhostPos, setDragGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerOpenRef = useRef(false);
  emojiPickerOpenRef.current = emojiPickerOpen;

  useEffect(() => {
    if (!spaceModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (emojiPickerOpenRef.current) {
          setEmojiPickerOpen(false);
        } else {
          setSpaceModal(null);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [spaceModal]);

  useEffect(() => {
    if (!spaceModal) setEmojiPickerOpen(false);
  }, [spaceModal]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [emojiPickerOpen]);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (!mounted) return;

        const windowId = activeTab?.windowId ?? null;
        setCurrentWindowId(windowId);

        if (activeTab?.id) {
          setActiveTabId(activeTab.id);
        }

        await sendMessage({ type: 'SUBSCRIBE' });
      } catch (error) {
        console.error('[SidePanel] Failed to initialize:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    initialize();

    return () => {
      mounted = false;
      sendMessage({ type: 'UNSUBSCRIBE' }).catch(console.error);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onMessage((message) => {
      switch (message.type) {
        case 'STATE_SYNC': {
          setTabs(message.state.tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
          setSpaces(message.spaces);
          break;
        }

        case 'TAB_CREATED': {
          setTabs(prev => {
            if (prev.some(t => t.id === message.tab.id)) {
              return prev;
            }
            return [...prev, message.tab].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          });
          break;
        }

        case 'TAB_REMOVED': {
          setTabs(prev => prev.filter(t => t.id !== message.tabId));
          break;
        }

        case 'TAB_UPDATED': {
          setTabs(prev =>
            prev.map(t => t.id === message.tab.id ? message.tab : t)
          );
          break;
        }

        case 'TAB_MOVED': {
          setTabs(prev => {
            const updated = [...prev];
            const tabIndex = updated.findIndex(t => t.id === message.tabId);
            if (tabIndex !== -1) {
              const [tab] = updated.splice(tabIndex, 1);
              tab.index = message.toIndex;
              updated.splice(message.toIndex, 0, tab);
              return updated.map((t, i) => ({ ...t, index: i }));
            }
            return prev;
          });
          break;
        }

        case 'TAB_ACTIVATED': {
          setActiveTabId(message.tabId);
          break;
        }

        case 'WINDOW_FOCUSED': {
          console.log('[SidePanel] Window focused:', message.windowId);
          break;
        }

        case 'SPACES_UPDATED': {
          setSpaces(message.spaces);
          break;
        }

        case 'SIDE_PANEL_CLOSING': {
          setIsClosing(true);
          break;
        }
      }
    });

    return unsubscribe;
  }, [currentWindowId]);

  useEffect(() => {
    if (activeSpaceId === ALL_TABS_ID) return;
    if (!spaces.some(space => space.id === activeSpaceId)) {
      setActiveSpaceId(DEFAULT_SPACE_ID);
    }
  }, [spaces, activeSpaceId]);

  const handleTabClick = useCallback((tab: ExtendedTab) => {
    if (!tab.id) return;

    if (tab.pinned && currentWindowId !== null && tab.windowId !== currentWindowId) {
      sendMessage({
        type: 'MOVE_TAB',
        tabId: tab.id,
        windowId: currentWindowId,
        index: 0
      });
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: currentWindowId });
    } else if (tab.windowId) {
      sendMessage({ type: 'SWITCH_TAB', tabId: tab.id, windowId: tab.windowId });
    }
  }, [currentWindowId]);

  const handleCloseTab = useCallback((e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    sendMessage({ type: 'CLOSE_TAB', tabId });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: ExtendedTab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tab,
    });
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!contextMenu?.tab.url) return;
    try {
      await navigator.clipboard.writeText(contextMenu.tab.url);
      setContextMenu(null);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  }, [contextMenu]);

  const handleReload = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    sendMessage({ type: 'RELOAD_TAB', tabId: contextMenu.tab.id });
    setContextMenu(null);
  }, [contextMenu]);

  const handleMute = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    const isMuted = contextMenu.tab.mutedInfo?.muted ?? false;
    sendMessage({ type: 'MUTE_TAB', tabId: contextMenu.tab.id, muted: !isMuted });
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuClose = useCallback(() => {
    if (!contextMenu?.tab.id) return;
    sendMessage({ type: 'CLOSE_TAB', tabId: contextMenu.tab.id });
    setContextMenu(null);
  }, [contextMenu]);

  const handleTogglePin = useCallback(() => {
    if (!contextMenu?.tab) return;

    const tab = contextMenu.tab;
    const isPinning = !tab.pinned;

    const currentPinnedCount = tabs.filter(t => t.pinned).length;

    if (isPinning && currentPinnedCount >= 6) {
      setErrorMessage({
        text: 'Can only pin up to 6 tabs',
        x: contextMenu.x,
        y: contextMenu.y
      });
      setTimeout(() => setErrorMessage(null), 750);
      setContextMenu(null);
      return;
    }

    if (tab.id && tab.id > 0) {
      sendMessage({
        type: 'PIN_TAB',
        tabId: tab.id,
        pinned: isPinning
      });
    }
    setContextMenu(null);
  }, [contextMenu, tabs]);

  const handleDragStart = useCallback((tab: ExtendedTab) => (e: React.DragEvent) => {
    if (!tab.id) return;
    setDraggedTab(tab.id);
    setDragGhostPos({ x: e.clientX, y: e.clientY });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tab.id));

    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);

    const handleDragMove = (event: DragEvent) => {
      setDragGhostPos({ x: event.clientX, y: event.clientY });
      const container = scrollContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scrollThreshold = 50;
      const scrollSpeed = 10;

      const mouseY = event.clientY;
      const distanceFromTop = mouseY - rect.top;
      const distanceFromBottom = rect.bottom - mouseY;

      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }

      if (distanceFromTop < scrollThreshold && distanceFromTop > 0) {
        autoScrollIntervalRef.current = setInterval(() => {
          container.scrollTop -= scrollSpeed;
        }, 16);
      } else if (distanceFromBottom < scrollThreshold && distanceFromBottom > 0) {
        autoScrollIntervalRef.current = setInterval(() => {
          container.scrollTop += scrollSpeed;
        }, 16);
      }
    };

    document.addEventListener('drag', handleDragMove);

    const cleanup = () => {
      document.removeEventListener('drag', handleDragMove);
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }
    };

    document.addEventListener('dragend', cleanup, { once: true });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
    setDragGhostPos(null);
    setIsDragOverPinned(false);
    setIsDragOverRegular(false);
    setDragOverSpaceId(null);

    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const openCreateSpaceModal = useCallback(() => {
    setSpaceForm({ name: '', color: SPACE_COLORS[0], icon: '' });
    setSpaceModal({ mode: 'create' });
  }, []);

  const openEditSpaceModal = useCallback((spaceId: string) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    const color = SPACE_COLORS.includes(space.color) ? space.color : SPACE_COLORS[0];
    setSpaceForm({ name: space.name, color, icon: space.icon ?? '' });
    setSpaceModal({ mode: 'edit', spaceId });
  }, [spaces]);

  const handleSpaceSelect = useCallback((spaceId: string) => {
    setActiveSpaceId(spaceId);
    sendMessage({ type: 'SET_ACTIVE_SPACE', spaceId }).catch(console.error);
    if (spaceId !== ALL_TABS_ID) {
      sendMessage({
        type: 'UPDATE_SPACE',
        spaceId,
        updates: { lastAccessedAt: Date.now() },
      }).catch(console.error);

      const spaceTabs = tabs.filter(t =>
        (t.spaceId ?? DEFAULT_SPACE_ID) === spaceId &&
        t.windowId === currentWindowId &&
        !t.pinned
      );
      if (spaceTabs.length > 0) {
        const mostRecent = spaceTabs.reduce((best, t) =>
          (t.lastActiveAt ?? 0) > (best.lastActiveAt ?? 0) ? t : best
        );
        if (mostRecent.id && mostRecent.windowId) {
          sendMessage({ type: 'SWITCH_TAB', tabId: mostRecent.id, windowId: mostRecent.windowId }).catch(console.error);
        }
      }
    }
  }, [tabs, currentWindowId]);

  const rootRef = useRef<HTMLDivElement>(null);
  const carouselOuterRef = useRef<HTMLDivElement>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeDragging, setIsSwipeDragging] = useState(false);

  const spaceIds = useMemo(() => [ALL_TABS_ID, ...spaces.map(s => s.id)], [spaces]);
  const activeSpaceIndex = Math.max(0, spaceIds.indexOf(activeSpaceId));
  const activeSpaceIndexRef = useRef(activeSpaceIndex);
  activeSpaceIndexRef.current = activeSpaceIndex;

  const handleSpaceIndexChange = useCallback((newIndex: number) => {
    const clamped = Math.max(0, Math.min(spaceIds.length - 1, newIndex));
    handleSpaceSelect(spaceIds[clamped]);
  }, [spaceIds, handleSpaceSelect]);

  const resolveRelease = useCallback((dragDistance: number, velocity: number) => {
    const panelWidth = carouselOuterRef.current?.clientWidth ?? 320;
    const idx = activeSpaceIndexRef.current;
    const len = spaceIds.length;
    const distanceThreshold = panelWidth * 0.5;
    const velocityThreshold = 0.4;
    const moveNext = dragDistance >= distanceThreshold || velocity >= velocityThreshold;
    const movePrev = dragDistance <= -distanceThreshold || velocity <= -velocityThreshold;
    let newIdx = idx;
    if (moveNext && idx < len - 1) newIdx = idx + 1;
    else if (movePrev && idx > 0) newIdx = idx - 1;
    return Math.max(0, Math.min(len - 1, newIdx));
  }, [spaceIds.length]);

  const swipeRef = useRef<{
    active: boolean;
    startX: number;
    lastX: number;
    lastTime: number;
    velocity: number;
  }>({ active: false, startX: 0, lastX: 0, lastTime: 0, velocity: 0 });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const now = Date.now();
      swipeRef.current = { active: true, startX: x, lastX: x, lastTime: now, velocity: 0 };
      setIsSwipeDragging(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeRef.current.active || e.touches.length !== 2) return;
    e.preventDefault();
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const now = Date.now();
    const dt = Math.max(1, now - swipeRef.current.lastTime);
    const instantVelocity = (x - swipeRef.current.lastX) / dt;
    swipeRef.current.velocity = swipeRef.current.velocity * 0.3 + instantVelocity * 0.7;
    swipeRef.current.lastX = x;
    swipeRef.current.lastTime = now;
    const rawDrag = x - swipeRef.current.startX;
    const pw = carouselOuterRef.current?.clientWidth ?? 320;
    setSwipeOffset(Math.max(-pw, Math.min(pw, rawDrag)));
  }, []);

  const handleTouchEnd = useCallback(() => {
    const { active, startX, lastX, velocity } = swipeRef.current;
    swipeRef.current.active = false;
    setIsSwipeDragging(false);
    if (!active) return;
    const dragDistance = lastX - startX;
    const newIdx = resolveRelease(dragDistance, velocity);
    handleSpaceIndexChange(newIdx);
    setSwipeOffset(0);
  }, [handleSpaceIndexChange, resolveRelease]);

  const handleTouchCancel = useCallback(() => {
    swipeRef.current.active = false;
    setIsSwipeDragging(false);
    setSwipeOffset(0);
  }, []);

  const wheelRef = useRef<{
    dragX: number;
    lastTime: number;
    velocity: number;
    gestureEndTimer: ReturnType<typeof setTimeout> | null;
  }>({ dragX: 0, lastTime: 0, velocity: 0, gestureEndTimer: null });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const GESTURE_END_MS = 350;
    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 3) return;
      e.preventDefault();
      const now = Date.now();
      const ref = wheelRef.current;
      if (now - ref.lastTime > 350) {
        ref.dragX = 0;
        ref.velocity = 0;
      }
      const dt = Math.max(1, now - ref.lastTime);
      const instantVelocity = e.deltaX / dt;
      ref.velocity = ref.velocity * 0.3 + instantVelocity * 0.7;
      ref.lastTime = now;
      ref.dragX += e.deltaX;
      setIsSwipeDragging(true);
      const pw = carouselOuterRef.current?.clientWidth ?? 320;
      setSwipeOffset(Math.max(-pw, Math.min(pw, ref.dragX)));

      if (ref.gestureEndTimer) clearTimeout(ref.gestureEndTimer);
      ref.gestureEndTimer = setTimeout(() => {
        ref.gestureEndTimer = null;
        setIsSwipeDragging(false);
        const newIdx = resolveRelease(ref.dragX, ref.velocity);
        handleSpaceIndexChange(newIdx);
        setSwipeOffset(0);
        ref.dragX = 0;
      }, GESTURE_END_MS);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (wheelRef.current.gestureEndTimer) clearTimeout(wheelRef.current.gestureEndTimer);
    };
  }, [handleSpaceIndexChange, resolveRelease]);

  const handleSpaceContextMenu = useCallback((spaceId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openEditSpaceModal(spaceId);
  }, [openEditSpaceModal]);

  const handleSpaceSave = useCallback(async () => {
    if (!spaceForm.name.trim()) return;

    if (spaceModal?.mode === 'create') {
      await sendMessage({
        type: 'CREATE_SPACE',
        name: spaceForm.name.trim(),
        color: spaceForm.color,
        icon: spaceForm.icon.trim() || undefined,
      });
    }

    if (spaceModal?.mode === 'edit' && spaceModal.spaceId) {
      await sendMessage({
        type: 'UPDATE_SPACE',
        spaceId: spaceModal.spaceId,
        updates: {
          name: spaceForm.name.trim(),
          color: spaceForm.color,
          icon: spaceForm.icon.trim() || undefined,
        },
      });
    }

    setSpaceModal(null);
  }, [spaceForm, spaceModal]);

  const handleSpaceDelete = useCallback(async () => {
    if (spaceModal?.mode !== 'edit' || !spaceModal.spaceId) return;
    if (spaceModal.spaceId === DEFAULT_SPACE_ID) return;
    await sendMessage({ type: 'DELETE_SPACE', spaceId: spaceModal.spaceId });
    setSpaceModal(null);
    setActiveSpaceId(DEFAULT_SPACE_ID);
  }, [spaceModal]);

  const handleSpaceDragOver = useCallback((spaceId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSpaceId(spaceId);
  }, []);

  const handleSpaceDrop = useCallback((spaceId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSpaceId(null);

    const data = e.dataTransfer.getData('text/plain');
    const tabId = draggedTab ?? (data ? parseInt(data, 10) : null);
    if (!tabId || Number.isNaN(tabId)) return;

    sendMessage({ type: 'ASSIGN_TAB_TO_SPACE', tabId, spaceId }).catch(console.error);
    setDraggedTab(null);
  }, [draggedTab]);

  const handleSpaceDragLeave = useCallback((spaceId: string) => (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverSpaceId(prev => (prev === spaceId ? null : prev));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverPinned(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverPinned(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPinned(false);

    if (!draggedTab) return;

    const currentPinnedCount = tabs.filter(t => t.pinned).length;

    if (currentPinnedCount >= 6) {
      setErrorMessage({
        text: 'Can only pin up to 6 tabs',
        x: e.clientX,
        y: e.clientY
      });
      setTimeout(() => setErrorMessage(null), 750);
      setDraggedTab(null);
      return;
    }

    sendMessage({
      type: 'PIN_TAB',
      tabId: draggedTab,
      pinned: true
    });

    setDraggedTab(null);
  }, [draggedTab, tabs]);

  const handleDragOverRegular = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverRegular(true);
  }, []);

  const handleDragLeaveRegular = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverRegular(false);
  }, []);

  const handleDropRegular = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverRegular(false);

    if (!draggedTab) return;

    sendMessage({
      type: 'PIN_TAB',
      tabId: draggedTab,
      pinned: false
    });

    setDraggedTab(null);
  }, [draggedTab]);

  const tabsPerSpace = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const result: Record<string, { pinned: ExtendedTab[]; regular: ExtendedTab[]; variant: string; filteredCount: number }> = {};
    for (const spaceId of spaceIds) {
      const spaceFiltered = spaceId === ALL_TABS_ID
        ? tabs
        : tabs.filter(tab => (tab.spaceId ?? DEFAULT_SPACE_ID) === spaceId);
      const filtered = query
        ? spaceFiltered.filter(tab =>
          tab.title?.toLowerCase().includes(query) ||
          tab.url?.toLowerCase().includes(query)
        )
        : spaceFiltered;
      const pinned: ExtendedTab[] = [];
      const regular: ExtendedTab[] = [];
      for (const tab of filtered) {
        if (tab.pinned) pinned.push(tab);
        else if (tab.windowId === currentWindowId) regular.push(tab);
      }
      const count = pinned.length;
      const variant =
        count <= 1 ? 'single' :
        count <= 3 ? 'elongated' :
        count <= 4 ? 'compact' :
        'minimal';
      result[spaceId] = { pinned, regular, variant, filteredCount: filtered.length };
    }
    return result;
  }, [tabs, searchQuery, spaceIds, currentWindowId]);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#888'
      }}>
        Loading tabs...
      </div>
    );
  }

  const panelPct = spaceIds.length > 0 ? 100 / spaceIds.length : 100;

  const activeSpace = activeSpaceId !== ALL_TABS_ID ? spaces.find(s => s.id === activeSpaceId) : null;
  const theme = activeSpace ? buildSpaceTheme(activeSpace.color) : DEFAULT_THEME;

  return (
    <div
      ref={rootRef}
      className={`sidepanel-root${isClosing ? ' sidepanel-root--closing' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: theme.bg, transition: 'background-color 0.25s ease' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Tab list - carousel with swipe */}
      <div
        ref={carouselOuterRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: `${spaceIds.length * 100}%`,
            height: '100%',
            minHeight: 0,
            transform: `translate3d(calc(${-activeSpaceIndex * panelPct}% - ${swipeOffset}px), 0, 0)`,
            transition: !isSwipeDragging ? 'transform 0.18s cubic-bezier(0.2, 0, 0.2, 1)' : 'none',
            willChange: isSwipeDragging ? 'transform' : 'auto',
          }}
        >
          {spaceIds.map((spaceId) => {
            const { pinned, regular, variant } = tabsPerSpace[spaceId] ?? { pinned: [], regular: [], variant: 'single' };
            const isActive = spaceId === activeSpaceId;
            return (
              <div
                key={spaceId}
                ref={isActive ? scrollContainerRef : undefined}
                className="tab-list-container"
                style={{
                  width: `${panelPct}%`,
                  flexShrink: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  minHeight: 0,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div style={{ padding: '8px 0', boxSizing: 'border-box' }}>
                  {/* Pinned tabs */}
                  {pinned.length > 0 && (
                    <div
                      style={{ marginBottom: '16px' }}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div style={{
                        fontSize: '11px',
                        color: '#888',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        padding: '0 8px',
                        marginBottom: '8px'
                      }}>
                        Pinned Tabs
                      </div>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: '4px',
                        padding: '4px 8px',
                        justifyContent: 'flex-start',
                        alignItems: 'flex-end',
                        backgroundColor: isDragOverPinned ? 'rgba(59, 130, 246, 0.1)' : undefined,
                        border: isDragOverPinned ? '2px solid rgba(59, 130, 246, 0.5)' : '2px solid transparent',
                        borderRadius: '8px',
                        transition: 'all 0.2s ease',
                        minHeight: '56px',
                        width: '100%',
                      }}>
                        {pinned.map((tab) => (
                          <Tab
                            key={tab.id}
                            tab={tab}
                            isActive={tab.id === activeTabId}
                            variant={variant as 'default' | 'compact' | 'minimal' | 'elongated' | 'single'}
                            onClick={() => handleTabClick(tab)}
                            onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                            onContextMenu={(e) => handleContextMenu(e, tab)}
                            onDragStart={handleDragStart(tab)}
                            onDragEnd={handleDragEnd}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Regular tabs */}
                  {pinned.length > 0 && regular.length > 0 && (
                    <div style={{
                      fontSize: '11px',
                      color: '#888',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '0 8px',
                      marginBottom: '8px'
                    }}>
                      Tabs ({regular.length})
                    </div>
                  )}
                  <div
                    style={{
                      backgroundColor: isDragOverRegular ? 'rgba(59, 130, 246, 0.1)' : undefined,
                      border: isDragOverRegular ? '2px solid rgba(59, 130, 246, 0.5)' : '2px solid transparent',
                      borderRadius: '10px',
                      padding: '0 8px 8px',
                    }}
                    onDragOver={handleDragOverRegular}
                    onDragLeave={handleDragLeaveRegular}
                    onDrop={handleDropRegular}
                  >
                    {regular.map((tab) => (
                      <Tab
                        key={tab.id}
                        tab={tab}
                        isActive={tab.id === activeTabId}
                        fullWidth
                        onClick={() => handleTabClick(tab)}
                        onClose={(e) => tab.id && handleCloseTab(e, tab.id)}
                        onContextMenu={(e) => handleContextMenu(e, tab)}
                        onDragStart={handleDragStart(tab)}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </div>

                  {((tabsPerSpace[spaceId]?.filteredCount) ?? 0) === 0 && (
                    <div style={{ textAlign: 'center', color: '#888', padding: '32px 0' }}>
                      {searchQuery ? 'No matching tabs' : 'No tabs open'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag ghost */}
      {dragGhostPos && draggedTab && (() => {
        const tab = tabs.find(t => t.id === draggedTab);
        if (!tab) return null;
        const overSpace = dragOverSpaceId !== null;
        return (
          <div
            className={`drag-ghost${overSpace ? ' drag-ghost--over-space' : ''}`}
            style={{
              position: 'fixed',
              left: dragGhostPos.x,
              top: dragGhostPos.y,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          >
            <div className="drag-ghost__inner">
              <div className="drag-ghost__icon">
                {tab.favIconUrl ? (
                  <img src={tab.favIconUrl} alt="" />
                ) : (
                  <div className="drag-ghost__icon-fallback">
                    {tab.title?.charAt(0).toUpperCase() ?? '•'}
                  </div>
                )}
              </div>
              <div className="drag-ghost__title">{tab.title ?? tab.url ?? 'Untitled'}</div>
            </div>
          </div>
        );
      })()}

      {/* Error Message */}
      {errorMessage && (
        <div style={{
          position: 'fixed',
          top: `${errorMessage.y + 10}px`,
          left: `${errorMessage.x}px`,
          backgroundColor: '#333',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 750,
        }}>
          {errorMessage.text}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: `1px solid ${theme.border}`, flexShrink: 0, transition: 'border-color 0.25s ease' }}>
        <div style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} open
        </div>
      </div>

      {/* Spaces bar */}
      <div className="spaces-bar" style={{ flexShrink: 0, background: theme.spacesBarBg, borderTopColor: theme.spacesBarBorder, transition: 'background 0.25s ease, border-color 0.25s ease' }}>
        <div className="spaces-row">
          <button
            type="button"
            className={`space-pill space-pill--all${activeSpaceId === ALL_TABS_ID ? ' active' : ''}`}
            onClick={() => handleSpaceSelect(ALL_TABS_ID)}
          >
            All Tabs
          </button>

          {spaces.map(space => (
            <div
              key={space.id}
              onContextMenu={handleSpaceContextMenu(space.id)}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <div
                role="button"
                tabIndex={0}
                className={`space-pill space-pill--space${activeSpaceId === space.id ? ' active' : ''}${dragOverSpaceId === space.id ? ' drag-over' : ''}`}
                style={{ background: space.color, color: isLightColor(space.color) ? '#1a1a1a' : undefined }}
                onClick={() => handleSpaceSelect(space.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSpaceSelect(space.id);
                  }
                }}
                onContextMenu={handleSpaceContextMenu(space.id)}
                onDragOver={handleSpaceDragOver(space.id)}
                onDrop={handleSpaceDrop(space.id)}
                onDragLeave={handleSpaceDragLeave(space.id)}
              >
                {space.icon && <span className="space-pill__icon">{space.icon}</span>}
                <span>{space.name}</span>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="space-pill-add"
            onClick={openCreateSpaceModal}
            aria-label="Create new space"
            title="Create space"
          >
            +
          </button>
        </div>
      </div>

      {/* Space Modal */}
      {spaceModal && (
        <div
          className="space-modal-backdrop"
          onClick={() => setSpaceModal(null)}
        >
          <div
            className="space-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal
            aria-labelledby="space-modal-title"
          >
            <h2 id="space-modal-title" className="space-modal__title">
              {spaceModal.mode === 'create' ? 'Create Space' : 'Edit Space'}
            </h2>

            <div className="space-modal__field">
              <label htmlFor="space-name" className="space-modal__label">Name</label>
              <input
                id="space-name"
                type="text"
                className="space-modal__input"
                placeholder="Work, Personal, etc."
                value={spaceForm.name}
                onChange={(e) => setSpaceForm(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="space-modal__field">
              <label className="space-modal__label">Color</label>
              <div className="space-modal__color-grid">
                {SPACE_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`space-modal__color-swatch${spaceForm.color === hex ? ' space-modal__color-swatch--selected' : ''}`}
                    style={{ backgroundColor: hex }}
                    onClick={() => setSpaceForm(prev => ({ ...prev, color: hex }))}
                    aria-label={`Color ${hex}`}
                    title={hex}
                  />
                ))}
              </div>
            </div>

            <div className="space-modal__field" ref={emojiPickerRef} style={{ position: 'relative' }}>
              <label className="space-modal__label">Icon</label>
              <button
                type="button"
                className="space-modal__emoji-trigger"
                onClick={() => setEmojiPickerOpen(open => !open)}
                aria-label="Choose emoji"
                aria-expanded={emojiPickerOpen}
              >
                {spaceForm.icon ? (
                  <span>{spaceForm.icon}</span>
                ) : (
                  <span className="space-modal__emoji-placeholder">😀</span>
                )}
              </button>
              {emojiPickerOpen && (
                <div className="space-modal__emoji-popover">
                  <div className="space-modal__emoji-grid">
                    <button
                      type="button"
                      className="space-modal__emoji-btn"
                      onClick={() => {
                        setSpaceForm(prev => ({ ...prev, icon: '' }));
                        setEmojiPickerOpen(false);
                      }}
                      title="No icon"
                    >
                      ✕
                    </button>
                    {SPACE_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        className="space-modal__emoji-btn"
                        onClick={() => {
                          setSpaceForm(prev => ({ ...prev, icon: emoji }));
                          setEmojiPickerOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-modal__actions">
              {spaceModal.mode === 'edit' && spaceModal.spaceId !== DEFAULT_SPACE_ID && (
                <button
                  type="button"
                  className="space-modal__btn space-modal__btn--danger"
                  onClick={handleSpaceDelete}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                className="space-modal__btn space-modal__btn--secondary"
                onClick={() => setSpaceModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="space-modal__btn space-modal__btn--primary"
                onClick={handleSpaceSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCopyLink={handleCopyLink}
          onReload={handleReload}
          onCloseTab={handleContextMenuClose}
          onMute={handleMute}
          isMuted={contextMenu.tab.mutedInfo?.muted ?? false}
          onTogglePin={handleTogglePin}
          isPinned={contextMenu.tab.pinned}
        />
      )}
    </div>
  );
}
