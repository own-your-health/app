// Runs medrec over a folder of invented records. It runs under a scratch home
// and profile, so this machine's own medrec setup is never touched: it gets
// only the variables below, every config, data, cache and state directory
// inside the scratch home, a Keychain service with nothing in it, and no
// MEDREC_* setting of the shell's. The time zone is fixed (a US one, as
// medrec reads a UTC time's day in the writing machine's zone), so a visit's
// local days are the same on every machine. MEDREC names the binary, else
// `medrec` on the PATH.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MEDREC = process.env.MEDREC ?? 'medrec';

// 0.9.1 dates a portal stay across its days and makes a day's doses one
// event. 0.9.3 names a visit plainly for its code and makes a day billed only
// for vaccines a vaccine. 0.9.4 names conditions and claim diagnoses, and
// 0.9.5 makes a private record's papers and a private report's study private.
// The sample's checks expect all of it.
function checkVersion() {
  const version = execFileSync(MEDREC, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).at(-1);
  const [major, minor, patch] = version.split('.').map(Number);
  if (major === 0 && (minor < 9 || (minor === 9 && patch < 5))) throw new Error(`medrec ${version} writes the sample's views differently: set MEDREC to medrec 0.9.5 or later`);
}

/** Runs `steps` with a function that runs medrec on the records in `root`. */
export function withMedrec(root, steps) {
  checkVersion();
  const home = mkdtempSync(join(tmpdir(), 'medrec-demo-'));
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    MEDREC_PROFILE: 'demo',
    MEDREC_KEYCHAIN_SERVICE: 'own-your-health-app-sample',
    TZ: 'America/New_York',
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
  };
  const medrec = (...args) => execFileSync(MEDREC, ['-q', ...args], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    medrec('profiles', 'add', 'demo');
    medrec('init', root);
    steps(medrec);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The views the app reads: each person's events, bills, private items and code names, by the name medrec stores them under. */
export const APP_VIEW = /^(events|bills|private|code-names)\.[0-9a-f]{12}\.json$/;

export const md5Of = (bytes) => createHash('md5').update(bytes).digest('hex');
