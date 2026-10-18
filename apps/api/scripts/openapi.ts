// Writes the OpenAPI snapshot the SDK ships (packages/sdk/openapi.json). CI fails when the
// snapshot drifts from the spec the API serves (src/openapi.test.ts).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiSpec } from '../src/openapi';

export const SNAPSHOT = fileURLToPath(
  new URL('../../../packages/sdk/openapi.json', import.meta.url),
);
export const snapshotSpec = () =>
  openApiSpec({ apiUrl: 'https://api.trenchmart.fun', cluster: 'devnet' });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshotSpec(), null, 2)}\n`);
  console.log(`wrote ${SNAPSHOT}`);
}
