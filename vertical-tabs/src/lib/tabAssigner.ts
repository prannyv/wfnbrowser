// Auto-assignment orchestrator.
// Owns chrome.tabs.onCreated / onUpdated logic; keeps assignment idempotent.

import { analyzeTab } from '@/lib/tab-analyzer';
import { rankSpaces, DEFAULT_DOMAIN_THRESHOLD, DEFAULT_JACCARD_THRESHOLD, type SpaceCorpus } from '@/lib/similarityScorer';
import { broadcastMessage } from '@/lib/messages';
import type { StateManager } from '@/lib/storage';
import type { ExtendedTab } from '@/types';

// TabEngine only exposes what we need — avoid a circular import by typing it locally.
interface TabEngineLike {
    getTab(id: number): ExtendedTab | undefined;
    getAllTabs(): ExtendedTab[];
    updateTabMetadata(id: number, data: Record<string, unknown>): void;
}

const DEFAULT_SPACE_ID = 'default';

export class TabAssigner {
    /**
     * Fingerprint map — tracks the last "url|title" we scored for each tab.
     * Prevents re-running the scorer when onUpdated fires with identical data
     * (Chrome can fire it several times per navigation).
     */
    private readonly scored = new Map<number, string>();

    constructor(
        private readonly stateManager: StateManager,
        private readonly tabEngine: TabEngineLike,
        private uiActiveSpaceId: string,
    ) { }

    /** Call this whenever the UI reports a space change. */
    setUiActiveSpaceId(id: string): void {
        this.uiActiveSpaceId = id;
    }

    // ============================================================
    // Public event handlers (called from service-worker listeners)
    // ============================================================

    /** Handle chrome.tabs.onCreated */
    onCreated(tab: chrome.tabs.Tab): void {
        const tabId = tab.id;
        if (tabId === undefined) return;

        // Skip if already assigned (e.g. restored session tab)
        if (this.stateManager.getTabMetadata()[tabId]?.spaceId) return;

        // At creation time URL/title are usually blank — run the scorer anyway.
        // If it returns nothing useful we fall through to the active-space fallback.
        const targetSpaceId = this.resolveSpace(
            tabId,
            tab.url ?? '',
            tab.title ?? '',
            tab.openerTabId,
        );

        this.doAssign(tabId, targetSpaceId, true);
    }

    /** Handle chrome.tabs.onUpdated (caller should filter for url/title changes) */
    async onUpdated(
        tabId: number,
        changeInfo: { url?: string; title?: string },
        tab: chrome.tabs.Tab,
    ): Promise<void> {
        if (changeInfo.url === undefined && changeInfo.title === undefined) return;

        const url = tab.url ?? '';
        const title = tab.title ?? '';
        const fingerprint = `${url}|${title}`;

        // Idempotency — skip if we already scored this exact url+title for this tab
        if (this.scored.get(tabId) === fingerprint) return;
        this.scored.set(tabId, fingerprint);

        // Persist analysis features so they contribute to future corpus builds
        const analysis = analyzeTab(tabId, url, title);
        this.stateManager.setTabMetadata(tabId, {
            domain: analysis.domain,
            subdomains: analysis.subdomains,
            keywords: analysis.keywords,
        });
        broadcastMessage({ type: 'TAB_ANALYZED', analysis });

        // Respect manual assignments — if the user explicitly moved this tab, leave it alone
        const meta = this.stateManager.getTabMetadata()[tabId];
        if (meta?.autoAssigned === false) return;

        const targetSpaceId = this.resolveSpace(tabId, url, title);

        // Only broadcast/write if the space would actually change
        const currentSpaceId = meta?.spaceId ?? DEFAULT_SPACE_ID;
        if (targetSpaceId === currentSpaceId) return;

        this.doAssign(tabId, targetSpaceId, true);
    }

    /**
     * Mark a tab as manually assigned so the assigner won't touch it again.
     * Call this from the ASSIGN_TAB_TO_SPACE message handler.
     */
    markManual(tabId: number): void {
        this.stateManager.setTabMetadata(tabId, { autoAssigned: false });
        // Remove from fingerprint cache so if the tab navigates later we re-evaluate freshly
        this.scored.delete(tabId);
    }

    /** Clean up when a tab is closed. */
    onRemoved(tabId: number): void {
        this.scored.delete(tabId);
    }

    // ============================================================
    // Private helpers
    // ============================================================

    /**
     * Fallback chain:
     *  1. Scorer (filtered corpus, configurable threshold)
     *  2. Opener tab's space
     *  3. Active UI space (if not 'all')
     *  4. DEFAULT_SPACE_ID
     */
    private resolveSpace(
        tabId: number,
        url: string,
        title: string,
        openerTabId?: number,
    ): string {
        const settings = this.stateManager.getSettings();

        // 1. Global master switch
        if (!settings.autoAssignSpaces) {
            return this.fallback(openerTabId);
        }

        const analysis = analyzeTab(tabId, url, title);

        // 2. Build corpus — exclude spaces that opted out and the tab being scored
        const corpus = this.buildCorpus(tabId);
        const rankings = rankSpaces(
            analysis,
            corpus,
            DEFAULT_DOMAIN_THRESHOLD,
            DEFAULT_JACCARD_THRESHOLD,
        );
        const best = rankings[0];

        if (best) {
            return best.spaceID;
        }

        // 3-4. Opener / active-space / default fallback
        return this.fallback(openerTabId);
    }

    private fallback(openerTabId?: number): string {
        // Opener tab's space
        if (openerTabId !== undefined) {
            const openerMeta = this.stateManager.getTabMetadata()[openerTabId];
            if (openerMeta?.spaceId) return openerMeta.spaceId;
        }
        // Active UI space
        if (this.uiActiveSpaceId && this.uiActiveSpaceId !== 'all') {
            return this.uiActiveSpaceId;
        }
        return DEFAULT_SPACE_ID;
    }

    private buildCorpus(excludeTabId: number): SpaceCorpus[] {
        const metadata = this.stateManager.getTabMetadata();
        return this.stateManager
            .getSpaces()
            .filter(space => !space.autoAssignDisabled)
            .map(space => ({
                spaceID: space.id,
                tabs: (space.tabIds ?? [])
                    .filter(id => id !== excludeTabId)
                    .map(id => ({
                        domain: metadata[id]?.domain ?? '',
                        subdomains: metadata[id]?.subdomains ?? [],
                        keywords: metadata[id]?.keywords ?? [],
                    })),
            }));
    }

    private doAssign(tabId: number, spaceId: string, autoAssigned: boolean): void {
        const assignedSpaceId = this.stateManager.assignTabToSpace(tabId, spaceId);
        this.stateManager.setTabMetadata(tabId, { autoAssigned });
        this.tabEngine.updateTabMetadata(tabId, { spaceId: assignedSpaceId });

        const updatedTab = this.tabEngine.getTab(tabId);
        if (updatedTab) {
            broadcastMessage({
                type: 'TAB_UPDATED',
                tab: { ...updatedTab, spaceId: assignedSpaceId },
            });
        }
    }
}
