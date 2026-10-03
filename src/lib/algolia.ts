/**
 * Algolia search for the services marketplace.
 *
 * The database (Prisma `Service`) stays the source of truth. Algolia holds a
 * denormalized, search-optimized copy of each service's PUBLIC fields so the
 * marketplace gets typo-tolerant, relevance-ranked search instead of the old
 * client-side substring filter.
 *
 * SECURITY: `Service.apiKey` is a secret and is deliberately NEVER indexed.
 * Only the search-only API key may be exposed to the browser
 * (NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY). The write key lives server-side only
 * (see algolia-server.ts) and must never ship in client code.
 */

export const SERVICES_INDEX = 'services';

/** Shape of one record in the Algolia `services` index. */
export interface ServiceRecord {
  objectID: string;
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricePerCall: number;
  provider: string;
  providerAddr: string;
  status: string;
  totalCalls: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  latency: number;
  uptime: number;
  /** Parsed tag list (the DB stores tags as a JSON string). */
  tags: string[];
  createdAtTs: number;
}

/** The marketplace page's local Service shape (tags as JSON string). */
export interface ServiceShape {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricePerCall: number;
  provider: string;
  providerAddr: string;
  status: string;
  totalCalls: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  latency: number;
  uptime: number;
  tags: string;
  apiKey: string;
}

interface ServiceSource {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricePerCall: number;
  provider: string;
  providerAddr: string;
  status: string;
  totalCalls: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  latency: number;
  uptime: number;
  tags: string;
  createdAt: Date | string;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** DB service -> Algolia record. Field whitelist: no apiKey, ever. */
export function serviceToRecord(s: ServiceSource): ServiceRecord {
  return {
    objectID: s.id,
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    endpoint: s.endpoint,
    pricePerCall: s.pricePerCall,
    provider: s.provider,
    providerAddr: s.providerAddr,
    status: s.status,
    totalCalls: s.totalCalls,
    totalRevenue: s.totalRevenue,
    rating: s.rating,
    reviewCount: s.reviewCount,
    latency: s.latency,
    uptime: s.uptime,
    tags: parseTags(s.tags),
    createdAtTs: new Date(s.createdAt).getTime(),
  };
}

/** Algolia hit -> the page's Service shape (apiKey intentionally blank). */
export function recordToService(r: ServiceRecord): ServiceShape {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    endpoint: r.endpoint,
    pricePerCall: r.pricePerCall,
    provider: r.provider,
    providerAddr: r.providerAddr,
    status: r.status,
    totalCalls: r.totalCalls,
    totalRevenue: r.totalRevenue,
    rating: r.rating,
    reviewCount: r.reviewCount,
    latency: r.latency,
    uptime: r.uptime,
    tags: JSON.stringify(r.tags ?? []),
    apiKey: '',
  };
}

/** Index settings for the services index (applied by the seed script). */
export const SERVICES_INDEX_SETTINGS = {
  searchableAttributes: ['name', 'provider', 'description', 'category', 'tags'],
  attributesForFaceting: ['category', 'provider', 'status'],
  customRanking: ['desc(totalCalls)', 'desc(rating)', 'desc(reviewCount)'],
  attributesToHighlight: ['name', 'provider', 'description'],
  hitsPerPage: 60,
};
