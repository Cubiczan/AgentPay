/**
 * Backfill / re-sync the Algolia `services` index from the database.
 *
 * The DB is the source of truth; this script applies the index settings and
 * upserts every service (active and inactive — queries filter
 * `status:active`). New services are indexed automatically by
 * POST /api/services; run this after bulk imports or mapping changes.
 *
 * Usage (server-side only — needs the WRITE key, never expose it client-side):
 *   ALGOLIA_APP_ID=... ALGOLIA_WRITE_API_KEY=... DATABASE_URL=... \
 *     bun run scripts/index-services.ts
 */
import { db } from '../src/lib/db';
import { configureServicesIndex, getAlgoliaWriteClient } from '../src/lib/algolia-server';
import { SERVICES_INDEX, serviceToRecord } from '../src/lib/algolia';

async function main() {
  const client = getAlgoliaWriteClient();
  if (!client) {
    console.error('Algolia is not configured: set ALGOLIA_APP_ID and ALGOLIA_WRITE_API_KEY.');
    process.exit(1);
  }

  const ok = await configureServicesIndex();
  console.log(`Index settings applied: ${ok}`);

  const services = await db.service.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`Found ${services.length} services in the database.`);

  const objects = services.map((s) => serviceToRecord(s));
  if (objects.length > 0) {
    await client.saveObjects({
      indexName: SERVICES_INDEX,
      objects: objects as unknown as Record<string, unknown>[],
    });
  }
  console.log(`Indexed ${objects.length} records into "${SERVICES_INDEX}".`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
