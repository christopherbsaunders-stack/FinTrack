import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every (i) on the page has an explanation to show.
test('each (i) has an explanation', async () => {
  globalThis.document ||= { addEventListener() {} };
  globalThis.addEventListener ||= () => {};
  const { INFO } = await import('../public/info.js');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const used = new Set([
    ...[...html.matchAll(/data-info="(\w+)"/g)].map((m) => m[1]),
    ...[...app.matchAll(/infoButton\('(\w+)'/g)].map((m) => m[1]),
    ...[...app.matchAll(/infoButton\([^)]*\? '(\w+)' : '(\w+)'/g)].flatMap((m) => [m[1], m[2]]),
  ]);
  const map = app.match(/const (?:CARD_INFO|CHECK_INFO) = \{[\s\S]*?\};/g).join('\n');
  for (const m of map.matchAll(/: '(\w+)'/g)) used.add(m[1]);
  assert.ok(used.size > 40, `only ${used.size} found`);
  const missing = [...used].filter((k) => !INFO[k]);
  assert.deepEqual(missing, []);
  for (const [k, [title, body]] of Object.entries(INFO)) assert.ok(title && body.length > 40, `${k} needs a real explanation`);
});
