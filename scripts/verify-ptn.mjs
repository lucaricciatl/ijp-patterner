#!/usr/bin/env node
/**
 * Quantitative check of the .ptn reader/writer.
 *
 *   node scripts/verify-ptn.mjs [folder]
 *
 * 1. every .ptn in the folder must round-trip byte-for-byte
 * 2. the print-area rule (blocks + 1 jet pitch) must hold for every file
 * 3. templates must produce files whose declared print area matches the rule
 */
import { build } from 'esbuild';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const OUT = path.join(os.tmpdir(), `ijp-ptn-${process.pid}.mjs`);

await build({
  entryPoints: ['src/lib/ptn.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'warning',
});
await build({
  entryPoints: ['src/lib/geometry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT.replace('.mjs', '-geo.mjs'),
  logLevel: 'warning',
});
await build({
  entryPoints: ['src/lib/templates.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT.replace('.mjs', '-tpl.mjs'),
  logLevel: 'warning',
});

// dynamic import needs a URL: a bare absolute path fails on Windows
const ptn = await import(pathToFileURL(OUT).href);
const geo = await import(pathToFileURL(OUT.replace('.mjs', '-geo.mjs')).href);
const tpl = await import(pathToFileURL(OUT.replace('.mjs', '-tpl.mjs')).href);

const folder = process.argv[2] || '/Users/lucaricci/Desktop/inkjet printer/patterns';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.ptn$/i.test(entry.name)) yield full;
  }
}

let files = 0;
let byteExact = 0;
let areaOk = 0;
const failures = [];

for await (const f of walk(folder)) {
  files++;
  const src = await readFile(f, 'utf8');
  let p;
  try {
    p = ptn.parsePattern(src);
  } catch (err) {
    failures.push(`${path.basename(f)}: parse failed (${err.message})`);
    continue;
  }
  const out = ptn.serializePattern(p);
  if (out === src) byteExact++;
  else {
    failures.push(`${path.basename(f)}: round-trip differs (${src.length} vs ${out.length} bytes)`);
  }

  const fit = geo.fittedPrintArea(p);
  const dw = Math.abs(p.general.width - fit.width);
  const dh = Math.abs(p.general.height - fit.height);
  const tol = Math.max(1e-4, (p.general.jetSpacing / 1000) * 0.01);
  if (dw <= tol && dh <= tol) areaOk++;
  else failures.push(`${path.basename(f)}: print area ${p.general.width}×${p.general.height} vs blocks ${fit.width}×${fit.height}`);
}

// template sanity
const templates = ['film', 'fingers', 'line', 'stage', 'blank'];
const params = { ...tpl.defaultParams };
for (const id of templates) {
  const p = tpl.buildTemplate(id, params);
  const fit = geo.fittedPrintArea(p);
  const ok = Math.abs(p.general.width - fit.width) < 1e-6 && Math.abs(p.general.height - fit.height) < 1e-6;
  if (!ok) failures.push(`template ${id}: print area ${p.general.width}×${p.general.height} vs ${fit.width}×${fit.height}`);
  // re-parse what we would write
  const again = ptn.parsePattern(ptn.serializePattern(p));
  if (again.blocks.length !== p.blocks.length) failures.push(`template ${id}: reparse lost blocks`);
}

console.log(`folder          ${folder}`);
console.log(`files           ${files}`);
console.log(`byte-exact      ${byteExact}/${files}`);
console.log(`area rule ok    ${areaOk}/${files}`);
console.log(`templates       ${templates.length} built + reparsed`);

if (failures.length) {
  console.log('\nFAILURES');
  for (const f of failures) console.log(' ✗ ' + f);
  process.exit(1);
}
console.log('\nall checks passed');
