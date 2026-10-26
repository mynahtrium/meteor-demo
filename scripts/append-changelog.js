import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readmePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md');
// Produce a timestamp in Europe/Istanbul (GMT+3) formatted like: 2025-10-04T14:23:45+03:00
function formatIstanbulISO(date) {
  // Istanbul is UTC+3
  const offsetHours = 3;
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const istanbul = new Date(date.getTime() + offsetMs);

  const pad = n => String(n).padStart(2, '0');
  const year = istanbul.getUTCFullYear();
  const month = pad(istanbul.getUTCMonth() + 1);
  const day = pad(istanbul.getUTCDate());
  const hour = pad(istanbul.getUTCHours());
  const minute = pad(istanbul.getUTCMinutes());
  const second = pad(istanbul.getUTCSeconds());

  return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
}

const now = new Date();
const ts = formatIstanbulISO(now);
const entry = `- ${ts} (Europe/Istanbul) — Automated changelog entry: run scripts/append-changelog.js\n`;

let readme = fs.readFileSync(readmePath, 'utf8');

if (!/## Changelog/.test(readme)) {
  readme += '\n## Changelog\n\n';
}

// Insert entry under Changelog heading
readme = readme.replace(/(## Changelog\n\n)/, `$1${entry}`);

fs.writeFileSync(readmePath, readme, 'utf8');
console.log('Appended changelog entry to README.md:', entry.trim());
