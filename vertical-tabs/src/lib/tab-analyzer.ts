// Breaks down a tab's URL and title into structured pieces.
// No network calls – purely string parsing.

export interface TabAnalysis {
    domain: string;       // registered domain, e.g. "github.com" from "gist.github.com"
    subdomains: string[]; // e.g. ["gist"] from "gist.github.com"
    pathSegments: string[];
    keywords: string[];   // from title, stop words removed
    rawTitle: string;
    rawUrl: string;
}
    
// Two-part TLDs we know about so we don't chop them wrong.
// e.g. "bbc.co.uk" → registered domain is "bbc.co.uk", not "co.uk"
const MULTI_PART_TLDS = new Set([
    'co.uk', 'co.nz', 'co.jp', 'co.za', 'co.in', 'co.kr', 'co.id',
    'com.au', 'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.ph',
    'org.uk', 'net.uk', 'me.uk', 'ac.uk', 'gov.uk',
    'gov.au', 'edu.au',
    'ne.jp', 'or.jp', 'ac.jp', 'ad.jp',
]);

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
    'what', 'which', 'who', 'how', 'when', 'where', 'why', 'not',
    'no', 'so', 'if', 'then', 'than', 'as', 'up', 'out', 'about',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'each', 'more', 'most', 'other', 'some', 'such', 'also',
    'just', 'new', 'can', 'will', 'would', 'could', 'should',
]);

// Junk segments we never want in pathSegments
const SKIP_PATH_TOKENS = new Set(['www', 'index', 'html', 'htm', 'php', 'aspx', 'jsp']);

function isSpecialUrl(url: string): boolean {
    if (!url) return true;
    return (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('moz-extension://') ||
        url.startsWith('edge://')
    );
}

// Returns { domain, subdomains } from a hostname string.
// Strips www, handles two-part TLDs like co.uk.
function extractDomainParts(hostname: string): { domain: string; subdomains: string[] } {
    const stripped = hostname.replace(/^www\./, '');
    const parts = stripped.split('.');

    if (parts.length <= 2) {
        // "github.com" or "localhost" — nothing to split off
        return { domain: stripped, subdomains: [] };
    }

    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (MULTI_PART_TLDS.has(lastTwo)) {
        if (parts.length === 3) {
            // e.g. "bbc.co.uk" with no subdomain
            return { domain: stripped, subdomains: [] };
        }
        return {
            domain: parts.slice(-3).join('.'),
            subdomains: parts.slice(0, -3),
        };
    }

    return {
        domain: parts.slice(-2).join('.'),
        subdomains: parts.slice(0, -2),
    };
}

function extractPathSegments(pathname: string): string[] {
    return pathname
        .split('/')
        .map(seg => decodeURIComponent(seg).toLowerCase())
        .map(seg => seg.replace(/\.[a-z0-9]{1,5}$/, '')) // strip extensions
        .filter(seg => {
            if (!seg) return false;
            if (SKIP_PATH_TOKENS.has(seg)) return false;
            if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(seg)) return false; // UUID
            if (/^\d+$/.test(seg) && seg.length < 6) return false; // short numeric ID
            if (seg.length < 2) return false;
            return true;
        })
        .flatMap(seg => seg.split(/[-_]/)) // split hyphenated slugs
        .filter(seg => seg.length >= 2);
}

function extractTitleKeywords(title: string): string[] {
    if (!title) return [];

    const tokens = title
        .split(/[\s\-\|·–—:,;\/\\]+/)
        .map(tok => tok.toLowerCase().replace(/[^a-z0-9']/g, '').trim())
        .filter(tok => tok.length >= 2 && !STOP_WORDS.has(tok));

    // dedupe, keep first occurrence
    const seen = new Set<string>();
    return tokens.filter(tok => {
        if (seen.has(tok)) return false;
        seen.add(tok);
        return true;
    });
}

export function analyzeTab(tabId: number, url: string, title: string): TabAnalysis {
    const rawUrl = url ?? '';
    const rawTitle = title ?? '';

    if (isSpecialUrl(rawUrl)) {
        console.log(`[TabAnalyzer] #${tabId} skipped (special page): ${rawUrl}`);
        return { domain: '', subdomains: [], pathSegments: [], keywords: [], rawTitle, rawUrl };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        console.warn(`[TabAnalyzer] #${tabId} bad URL: ${rawUrl}`);
        return {
            domain: '',
            subdomains: [],
            pathSegments: [],
            keywords: extractTitleKeywords(rawTitle),
            rawTitle,
            rawUrl,
        };
    }

    const { domain, subdomains } = extractDomainParts(parsed.hostname);
    const pathSegments = extractPathSegments(parsed.pathname);
    const keywords = extractTitleKeywords(rawTitle);

    const analysis: TabAnalysis = { domain, subdomains, pathSegments, keywords, rawTitle, rawUrl };
    console.log(`[TabAnalyzer] #${tabId}`, analysis);
    return analysis;
}
