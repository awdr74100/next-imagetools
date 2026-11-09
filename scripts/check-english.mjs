// Fails when a tracked text file contains CJK characters. The project is written for an
// international audience, so comments, docs and fixture copy stay in English.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const BINARY = /\.(?:avif|gif|heif|ico|jpe?g|png|tiff|webp|woff2?)$/i;

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(f => f && !BINARY.test(f) && f !== 'pnpm-lock.yaml');

let failed = false;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  for (const [i, line] of text.split('\n').entries()) {
    if (CJK.test(line)) {
      console.error(`${file}:${i + 1}: ${line.trim()}`);
      failed = true;
    }
  }
}
if (failed) {
  console.error('\nNon-English text found; this repo keeps comments, docs and copy in English.');
  process.exit(1);
}
