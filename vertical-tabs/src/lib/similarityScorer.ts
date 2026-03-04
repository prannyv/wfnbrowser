//File for the similarity scorer for the Tab to Space

import type { TabAnalysis } from "./tab-analyzer";

export type TabFeatures = Pick<TabAnalysis, 'domain' | 'subdomains' | 'keywords'>;

export interface SpaceCorpus {
    spaceID: string;
    tabs: TabFeatures[];
}

export const SIMILARITY_THRESHOLD = 0.45;

function domainScore(newTab: TabFeatures, tabs: TabFeatures[]): number {
    let best = 0;
    for (const tab of tabs) {
        if (!tab.domain || !newTab.domain) continue;
        if (tab.domain === newTab.domain) {
            best = 0.8; break;
        }
        const newHost = [...newTab.subdomains, newTab.domain].join('.');
        const tabHost = [...tab.subdomains, tab.domain].join('.');
        if (newHost.endsWith(tab.domain) || tabHost.endsWith(newTab.domain)) {
            best = Math.max(best, 0.5);
        }
    }
    return best;
}

function buildIdf(spaces: SpaceCorpus[]): Map<string, number> {
    const docCount = spaces.length;
    const df = new Map<string, number>();

    for (const space of spaces) {
        const seen = new Set<string>();
        for (const tab of space.tabs) {
            for (const kw of tab.keywords) {
                if (!seen.has(kw)) {
                    df.set(kw, (df.get(kw) ?? 0) + 1);
                    seen.add(kw);
                }
            }
        }
    }

    const idf = new Map<string, number>();
    for (const [term, count] of df) {
        // +1 in numerator prevents negative IDF when docCount === 1
        idf.set(term, Math.log((docCount + 1) / (1 + count)));
    }
    return idf;
}

function keywordScore(
    newTab: TabFeatures,
    space: SpaceCorpus,
    idf: Map<string, number>
): number {
    if (newTab.keywords.length === 0) return 0;
    // build term frequency map for this space
    const corpusKws: string[] = space.tabs.flatMap(t => t.keywords);
    const tf = new Map<string, number>();
    for (const kw of corpusKws) tf.set(kw, (tf.get(kw) ?? 0) + 1);
    const corpusTotal = corpusKws.length || 1;
    let score = 0;
    for (const kw of newTab.keywords) {
        const termTf = (tf.get(kw) ?? 0) / corpusTotal;
        const termIdf = idf.get(kw) ?? 0;
        score += termTf * termIdf;
    }
    // normalize to [0, 1] — cap at 1 in case of extreme overlap
    return Math.min(score / newTab.keywords.length, 1);
}

export function scoreSpaceMatch(
    newTab: TabFeatures,
    space: SpaceCorpus,
    idf: Map<string, number>
): number {
    const d = domainScore(newTab, space.tabs);
    const k = keywordScore(newTab, space, idf);
    return (d * 0.4) + (k * 0.6);
}

export function rankSpaces(
    newTab: TabFeatures,
    spaces: SpaceCorpus[]
): Array<{ spaceID: string; score: number }> {
    const idf = buildIdf(spaces);
    return spaces
        .map(s => ({ spaceID: s.spaceID, score: scoreSpaceMatch(newTab, s, idf) }))
        .sort((a, b) => b.score - a.score);
}




