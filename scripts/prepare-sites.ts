import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Copy only hosting metadata beside the dry-run Worker bundle; no local env files.
const manifest: unknown = JSON.parse(
  await readFile(new URL('../.openai/hosting.json', import.meta.url), 'utf8'),
);
const output = new URL('../dist/sites/.openai/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('hosting.json', output), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  'Prepared dist/sites: Worker ESM and hosting metadata. Sites archive validation and publication are separate steps.',
);
