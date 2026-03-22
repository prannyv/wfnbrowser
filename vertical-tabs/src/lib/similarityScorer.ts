import type { TabAnalysis } from "./tab-analyzer";

export type TabFeatures = Pick<TabAnalysis, 'domain' | 'subdomains' | 'keywords'>;

export interface SpaceCorpus {
    spaceID: string;
    tabs: TabFeatures[];
}

export const DEFAULT_DOMAIN_THRESHOLD = 0.5;
export const DEFAULT_JACCARD_THRESHOLD = 0.08;

export interface SpaceScore {
    spaceID: string;
    domain: number;
    jaccard: number;
}

function domainScore(newTab: TabFeatures, tabs: TabFeatures[]): number {
    let best = 0;
    for (const tab of tabs) {
        if (!tab.domain || !newTab.domain) continue;
        if (tab.domain === newTab.domain) {
            best = 1.0; break;
        }
        const newHost = [...newTab.subdomains, newTab.domain].join('.');
        const tabHost = [...tab.subdomains, tab.domain].join('.');
        if (newHost.endsWith(tab.domain) || tabHost.endsWith(newTab.domain)) {
            best = Math.max(best, 0.6);
        }
    }
    return best;
}

function jaccardScore(newTab: TabFeatures, space: SpaceCorpus): number {
    if (newTab.keywords.length === 0) return 0;
    const spaceKeywords = new Set(space.tabs.flatMap(t => t.keywords));
    if (spaceKeywords.size === 0) return 0;

    const tabKeywords = new Set(newTab.keywords);
    let intersection = 0;
    for (const kw of tabKeywords) {
        if (spaceKeywords.has(kw)) intersection++;
    }

    const union = new Set([...tabKeywords, ...spaceKeywords]).size;
    return intersection / union;
}

export function scoreSpace(
    newTab: TabFeatures,
    space: SpaceCorpus,
): SpaceScore {
    return {
        spaceID: space.spaceID,
        domain: domainScore(newTab, space.tabs),
        jaccard: jaccardScore(newTab, space),
    };
}

export function rankSpaces(
    newTab: TabFeatures,
    spaces: SpaceCorpus[],
    domainThreshold: number,
    jaccardThreshold: number,
): SpaceScore[] {
    return spaces
        .map(s => scoreSpace(newTab, s))
        .filter(s => s.domain >= domainThreshold || s.jaccard >= jaccardThreshold)
        .sort((a, b) => {
            const aMax = Math.max(a.domain, a.jaccard);
            const bMax = Math.max(b.domain, b.jaccard);
            return bMax - aMax;
        });
}

