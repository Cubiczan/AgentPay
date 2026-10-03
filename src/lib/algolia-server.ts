/**
 * Server-side Algolia access (write key). NEVER import this from client code.
 *
 * Everything here is best-effort: if Algolia is not configured or is
 * unreachable, callers log and move on — search indexing must never break
 * service creation or the marketplace.
 */
import { algoliasearch, type Algoliasearch } from 'algoliasearch';
import { SERVICES_INDEX, SERVICES_INDEX_SETTINGS, serviceToRecord } from './algolia';

let cached: Algoliasearch | null | undefined;

export function getAlgoliaWriteClient(): Algoliasearch | null {
  if (cached !== undefined) return cached;
  const appId = process.env.ALGOLIA_APP_ID || process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const writeKey = process.env.ALGOLIA_WRITE_API_KEY;
  cached = appId && writeKey ? algoliasearch(appId, writeKey) : null;
  return cached;
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

/** Upsert one service into the search index. Never throws. */
export async function indexService(service: ServiceSource): Promise<void> {
  const client = getAlgoliaWriteClient();
  if (!client) return;
  try {
    await client.saveObject({
      indexName: SERVICES_INDEX,
      body: serviceToRecord(service),
    });
  } catch (err) {
    console.error('Algolia indexService failed:', err);
  }
}

/** Remove one service from the search index. Never throws. */
export async function unindexService(serviceId: string): Promise<void> {
  const client = getAlgoliaWriteClient();
  if (!client) return;
  try {
    await client.deleteObject({ indexName: SERVICES_INDEX, objectID: serviceId });
  } catch (err) {
    console.error('Algolia unindexService failed:', err);
  }
}

/** Apply the services index settings. Never throws. */
export async function configureServicesIndex(): Promise<boolean> {
  const client = getAlgoliaWriteClient();
  if (!client) return false;
  try {
    await client.setSettings({
      indexName: SERVICES_INDEX,
      indexSettings: SERVICES_INDEX_SETTINGS,
    });
    return true;
  } catch (err) {
    console.error('Algolia configureServicesIndex failed:', err);
    return false;
  }
}
