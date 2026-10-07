#!/usr/bin/env node
// Контрольні суми незмінної сировини.
//
//   node scripts/checksums.mjs          — перевірити dictionaries/ проти dictionaries/manifest.json
//   node scripts/checksums.mjs --write  — перерахувати суми в маніфесті (лише коли свідомо додано нове джерело)

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DICTIONARIES = join(ROOT, 'dictionaries');
const MANIFEST = join(DICTIONARIES, 'manifest.json');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** @returns {{ok: boolean, problems: string[], files: number}} */
export function verifyChecksums() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const problems = [];
  const listed = new Set();
  let files = 0;
  for (const dataset of manifest.datasets) {
    for (const file of dataset.files) {
      listed.add(file.path);
      files += 1;
      const full = join(DICTIONARIES, file.path);
      let actual;
      try {
        actual = sha256(full);
      } catch {
        problems.push(`немає файлу: ${file.path}`);
        continue;
      }
      if (actual !== file.sha256) problems.push(`контрольна сума не збігається: ${file.path}`);
      if (statSync(full).size !== file.bytes) problems.push(`розмір не збігається: ${file.path}`);
    }
  }
  for (const full of listFiles(DICTIONARIES)) {
    const rel = relative(DICTIONARIES, full).split(sep).join('/');
    if (rel !== 'manifest.json' && !listed.has(rel)) problems.push(`файл не описано в маніфесті: ${rel}`);
  }
  return { ok: problems.length === 0, problems, files };
}

function write() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const dataset of manifest.datasets) {
    for (const file of dataset.files) {
      const full = join(DICTIONARIES, file.path);
      file.sha256 = sha256(full);
      file.bytes = statSync(full).size;
    }
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) write();
  const result = verifyChecksums();
  if (result.ok) {
    console.log(`Контрольні суми збігаються: ${result.files} файлів.`);
  } else {
    console.error(result.problems.join('\n'));
    process.exit(1);
  }
}
