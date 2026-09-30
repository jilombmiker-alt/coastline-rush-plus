import { copyFile } from 'node:fs/promises';

// Keep license information with the website's distributed code and fonts.
await Promise.all([
  copyFile(new URL('../LICENSE', import.meta.url), new URL('../dist/LICENSE', import.meta.url)),
  copyFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), new URL('../dist/THIRD_PARTY_NOTICES.md', import.meta.url)),
]);
