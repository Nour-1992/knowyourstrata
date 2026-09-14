/**
 * Syntax-check every inline <script> in the files named on the command line.
 *
 * Tool result text lives in single-quoted JS string literals, and a stray
 * apostrophe produces a syntax error that fails SILENTLY: the page loads, the
 * form renders, only the Calculate button stops working, and the diff looks
 * clean. This is the cloud-side check from WATCHER-LOG, run in CI so a
 * generated edit cannot ship past it.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const files = process.argv.slice(2).filter((f) => f.endsWith('.html'));
if (!files.length) { console.log('no html files to check'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'inlinejs-'));
const RX = /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g;
let checked = 0, failed = 0;

for (const f of files) {
  const html = readFileSync(f, 'utf8');
  let m, i = 0;
  while ((m = RX.exec(html))) {
    const p = join(dir, `${f.replace(/[^\w]/g, '_')}.${i++}.js`);
    writeFileSync(p, m[1], 'utf8');
    checked++;
    try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
    catch (e) { failed++; console.error(`SYNTAX FAIL ${f} script ${i - 1}\n${e.stderr}`); }
  }
  for (const j of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(j[1]); } catch (e) { failed++; console.error(`JSON-LD FAIL ${f}: ${e.message}`); }
  }
}
console.log(`inline scripts checked: ${checked}, failures: ${failed}`);
process.exit(failed ? 1 : 0);
