// Runs medrec over a folder of invented records. It runs under a scratch home
// and profile, so this machine's own medrec setup is never touched: it gets
// only the variables below, every config, data, cache and state directory
// inside the scratch home (a new one under the system's temporary folder,
// which the system clears), a Keychain service with nothing in it, and no
// MEDREC_* setting of the shell's. The time zone is fixed (a US one, as
// medrec reads a UTC time's day in the writing machine's zone), so a visit's
// local days are the same on every machine. MEDREC names the binary, else
// `medrec` on the shell's PATH; the one whose version is checked runs each step.
//
// The same steps write the same bytes: the clock stands still at each step's
// moment, and medrec's ids are drawn from the step (sample/moment.c, which
// needs a C compiler). A step it was not loaded into, which some systems let
// pass, stops the run.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = process.platform === 'darwin';

// The sample is what this release writes.
const VERSION = '0.9.7';

/** A command as an absolute path: its own, or the first on the shell's PATH, as a step's PATH may have none of that. */
function commandAt(name, version) {
  if (name.includes(sep)) return resolve(name);
  const found = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => resolve(dir, name))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
  if (!found) throw new Error(`no ${name} on the PATH: set MEDREC to medrec ${version}`);
  return found;
}

/** The moment the sample is as of; the app moves its loads' times from here to now. */
export const ANCHOR = '2026-11-22T20:00:00Z';
/** The seconds since 1970 `before` (seconds) the anchor, and that time. */
export const seconds = (before) => Date.parse(ANCHOR) / 1000 - before;
export const iso = (before) => new Date(seconds(before) * 1000).toISOString().replace('.000Z', 'Z');

/**
 * A scratch machine: its home, a folder in it that comes first on medrec's
 * PATH (`alone` makes it the only one), and `medrec(before, ...args)`, which
 * runs medrec there `before` the anchor, its profile set up for `root`. It is
 * the sample's release, or another where a case says which.
 */
export function scratchMachine(root, { alone = false, release = VERSION } = {}) {
  const binary = commandAt(process.env.MEDREC ?? 'medrec', release);
  const version = execFileSync(binary, ['-V'], { encoding: 'utf8' }).trim().split(/\s+/)[1];
  if (version !== release) throw new Error(`medrec ${version} writes this differently: set MEDREC to medrec ${release}`);
  const home = mkdtempSync(join(tmpdir(), 'medrec-demo-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const shim = join(home, MAC ? 'moment.dylib' : 'moment.so');
  execFileSync('cc', ['-O2', '-Wall', '-Werror', ...(MAC ? ['-dynamiclib'] : ['-shared', '-fPIC']), '-o', shim, join(HERE, 'sample', 'moment.c')], { stdio: 'inherit' });
  const loaded = join(home, 'loaded');
  mkdirSync(loaded);
  const env = {
    PATH: alone ? bin : `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
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
    SAMPLE_LOADED: loaded,
    [MAC ? 'DYLD_INSERT_LIBRARIES' : 'LD_PRELOAD']: shim,
  };
  const records = root ?? join(home, 'records');
  const medrec = (before, ...args) => {
    const step = `${args.join(' ').replaceAll(records, 'records').replaceAll(home, 'home')} ${before}`;
    const ran = spawnSync(binary, ['-q', ...args], { env: { ...env, SAMPLE_AT: String(seconds(before)), SAMPLE_SEED: step }, stdio: ['ignore', 'ignore', 'inherit'] });
    if (ran.error) throw ran.error;
    if (ran.status !== 0) throw new Error(`medrec ${args.join(' ')} ended with ${ran.signal ?? ran.status}`);
    if (!existsSync(join(loaded, String(ran.pid)))) throw new Error(`medrec ran on the real clock: ${shim} was not loaded into it (a temporary folder nothing may run from, or a medrec that takes no library)`);
  };
  return { home, bin, root: records, medrec };
}

/** The views of the sample's medrec that the app reads: each person's events, bills, private items and code names, by the name medrec stores them under. */
export const APP_VIEW = /^(events|bills|private|code-names)\.[0-9a-f]{12}\.json$/;

export const md5Of = (bytes) => createHash('md5').update(bytes).digest('hex');
