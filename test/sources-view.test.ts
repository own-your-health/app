import { describe, expect, it } from 'vitest';
import { ANSWER_SHOWN_MS, ATTENTION, HEALTH_ORDER, isRecentAnswer, latestAnswered, needsAttention, needsPerson, sourceViews, type AnsweredRequest } from '../src/model/sources';
import type { ErrorInfo, RefreshRequest } from '../src/model/types';
import { clock } from '../src/ui/format';
import { isMedrecOwnError, remedyCommand, requestAnswer, shownRemedy, signInWords } from '../src/ui/views/sources';
import { demo, sourceOf } from './demo-data';

const NOW = new Date('2026-11-22T20:00:00Z');
const { household, indexes, status } = demo();
const views = sourceViews({ household, indexes, status, pending: [], done: [], now: NOW });
const names = { sources: views, people: household.people };

function answered(scope: RefreshRequest['scope'], outcomes: string[], message?: string, finishedAt = '2026-11-22T19:58:00Z'): AnsweredRequest {
  return {
    schema: 'medrec-request/v1',
    id: 'x_aaaaaaaaaaaaaaaaaaaa',
    requested_at: '2026-11-22T19:00:00Z',
    requested_by: { email: 'robin@example.com' },
    scope,
    app: { name: 'own-your-health-app', version: '0.1.0' },
    handled: { finished_at: finishedAt, outcome: 'partial', sources: outcomes.map((outcome, i) => ({ source: `s_${String(i).padStart(20, 'a')}`, outcome })), ...(message ? { message } : {}) },
  };
}

describe('the answer to a refresh request', () => {
  it('names the one outcome every source had', () => {
    expect(requestAnswer(answered({ all: true }, ['ok', 'ok']), names, NOW)).toBe('Last refresh request 2 minutes ago: loaded');
  });

  it('counts each outcome when they differ', () => {
    expect(requestAnswer(answered({ all: true }, ['ok', 'ok', 'needs_person', 'skipped_interval']), names, NOW)).toBe(
      'Last refresh request 2 minutes ago: 2 loaded, 1 needed a person, 1 too soon after its last try',
    );
  });

  it('says when a source skipped as too soon may load again', () => {
    const lab = sourceOf(household, 'Sam Example', 'labcorp');
    const next = '2026-11-23T01:40:00Z';
    const r = answered({ source: lab.id }, ['skipped_interval']);
    r.handled.sources![0]!.next_allowed_at = next;
    expect(requestAnswer(r, names, NOW)).toMatch(/^Last refresh request for .+ 2 minutes ago: not loaded, too soon after its last try; next load allowed /);
    expect(requestAnswer(r, names, NOW).endsWith(`; next load allowed ${clock(next, NOW)}`)).toBe(true);
  });

  it('names the earliest of several skipped sources, in the plural', () => {
    const all = answered({ all: true }, ['skipped_interval', 'skipped_interval']);
    all.handled.sources![0]!.next_allowed_at = '2026-11-23T05:00:00Z';
    all.handled.sources![1]!.next_allowed_at = '2026-11-23T02:00:00Z';
    expect(requestAnswer(all, names, NOW)).toBe(`Last refresh request 2 minutes ago: none loaded, too soon after their last tries; next load allowed ${clock('2026-11-23T02:00:00Z', NOW)}`);
    // 21:00-05:00 is 02:00Z, after 01:30Z, though it sorts first as text.
    const offsets = answered({ all: true }, ['skipped_interval', 'skipped_interval', 'skipped_interval']);
    offsets.handled.sources![0]!.next_allowed_at = '2026-11-22T21:00:00-05:00';
    offsets.handled.sources![1]!.next_allowed_at = '2026-11-23T01:30:00Z';
    offsets.handled.sources![2]!.next_allowed_at = 'not a time';
    expect(requestAnswer(offsets, names, NOW).endsWith(`; next load allowed ${clock('2026-11-23T01:30:00Z', NOW)}`)).toBe(true);
    const mixed = answered({ all: true }, ['ok', 'skipped_interval', 'skipped_interval']);
    expect(requestAnswer(mixed, names, NOW)).toBe('Last refresh request 2 minutes ago: 1 loaded, 2 too soon after their last tries');
  });

  it('says a source that loads only after a sign-in waits for one, rather than needed a person', () => {
    const blood = sourceOf(household, 'Robin Example', 'oneblood');
    const peds = sourceOf(household, 'Alex Example', 'athena');
    const r = answered({ all: true }, ['ok', 'needs_person', 'needs_person']);
    r.handled.sources![1]!.source = blood.id;
    r.handled.sources![2]!.source = peds.id;
    expect(requestAnswer(r, names, NOW)).toBe('Last refresh request 2 minutes ago: 1 loaded, 1 waits for a sign-in, 1 needed a person');
    const one = answered({ source: blood.id }, ['needs_person']);
    one.handled.sources![0]!.source = blood.id;
    expect(requestAnswer(one, names, NOW)).toMatch(/: waits for a sign-in on the Mac$/);
  });

  it('names the source or person a narrower request was for', () => {
    const lab = sourceOf(household, 'Sam Example', 'labcorp');
    const sam = household.people.find((p) => p.name === 'Sam Example')!;
    expect(requestAnswer(answered({ source: lab.id }, ['ok']), names, NOW)).toMatch(/^Last refresh request for .+ 2 minutes ago: loaded$/);
    expect(requestAnswer(answered({ person: sam.id }, ['ok']), names, NOW)).toBe('Last refresh request for Sam 2 minutes ago: loaded');
  });

  it('falls back to the Mac’s message when it lists no source', () => {
    expect(requestAnswer(answered({ all: true }, [], 'No source of this request is set up for refresh.'), names, NOW)).toBe(
      'Last refresh request 2 minutes ago: No source of this request is set up for refresh.',
    );
  });
});

describe('which answer home shows', () => {
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

  it('is the newest answered request', () => {
    const older = answered({ all: true }, ['ok'], undefined, at(3_600_000));
    const newer = answered({ all: true }, ['failed'], undefined, at(60_000));
    expect(latestAnswered([older, newer], NOW)).toBe(newer);
    expect(latestAnswered([newer, older], NOW)).toBe(newer);
  });

  it('is shown for a day and then left to the Sources screen', () => {
    expect(latestAnswered([answered({ all: true }, ['ok'], undefined, at(ANSWER_SHOWN_MS - 1000))], NOW)).toBeDefined();
    expect(latestAnswered([answered({ all: true }, ['ok'], undefined, at(ANSWER_SHOWN_MS))], NOW)).toBeUndefined();
  });

  it('skips a request not yet finished, and a clock that runs ahead', () => {
    const open: RefreshRequest = { ...answered({ all: true }, ['ok']), handled: { outcome: 'running', picked_up_at: at(1000) } };
    const ahead = answered({ all: true }, ['ok'], undefined, at(-60_000));
    expect(latestAnswered([open], NOW)).toBeUndefined();
    expect(latestAnswered([ahead], NOW)).toBeUndefined();
    // The source rows ask the same question.
    expect([open, ahead].map((r) => isRecentAnswer(r, NOW))).toEqual([false, false]);
    expect(isRecentAnswer(answered({ all: true }, ['ok'], undefined, at(1000)), NOW)).toBe(true);
  });
});

describe('what needs attention', () => {
  it('is the head of the health order, through a signed-out sign-in', () => {
    expect(ATTENTION).toEqual(HEALTH_ORDER.slice(0, 4));
    expect(ATTENTION).toEqual(['needs_person', 'failed', 'expired', 'signed_out']);
  });

  it('puts the sign-in that needs a person before the failed load', () => {
    expect(needsAttention(views).map((v) => v.health)).toEqual(['needs_person', 'failed']);
  });

  it('leaves a failed load off the list only a person can act on', () => {
    expect(needsPerson(views).map((v) => v.health)).toEqual(['needs_person']);
  });
});

describe('home’s line for a sign-in that needs a person', () => {
  const peds = views.find((v) => v.source.id === sourceOf(household, 'Alex Example', 'athena').id)!;
  const lab = views.find((v) => v.source.id === sourceOf(household, 'Sam Example', 'labcorp').id)!;
  const chart = views.find((v) => v.source.id === sourceOf(household, 'Robin Example', 'mychart').id)!;
  const ended = (v: (typeof views)[number]) => ({ ...v, health: 'expired' as const });

  it('names the one source, and opens it', () => {
    expect(signInWords(views)).toEqual({ text: `${peds.name} needs a sign-in`, route: { name: 'source', source: peds.source.id } });
  });

  it('names two, and opens Sources', () => {
    expect(signInWords([peds, ended(lab)])).toEqual({ text: `${peds.name} and ${lab.name} need a sign-in`, route: { name: 'sources' } });
  });

  it('counts three or more', () => {
    expect(signInWords([peds, ended(lab), ended(chart)])?.text).toBe('3 sources need a sign-in');
  });

  it('says a Keychain approval when that is what the Mac waits for', () => {
    const keychain = { ...peds, status: { ...peds.status!, sign_in: { ...peds.status!.sign_in!, needs_person: { reason: 'keychain', command: 'medrec refresh sign-in s_x' } } } };
    expect(signInWords([keychain])?.text).toBe(`${peds.name} needs a Keychain approval`);
    expect(signInWords([keychain, ended(lab)])?.text).toBe(`${peds.name} and ${lab.name} need a person`);
  });

  it('tells two people’s sources of the same name apart', () => {
    const twin = { ...ended(lab), name: peds.name };
    expect(signInWords([peds, twin])?.text).toBe(`${peds.name} (Alex) and ${peds.name} (Sam) need a sign-in`);
  });

  it('leaves out a source that loads only after a sign-in', () => {
    const blood = views.find((v) => v.source.id === sourceOf(household, 'Robin Example', 'oneblood').id)!;
    const plan = views.find((v) => v.source.id === sourceOf(household, 'Robin Example', 'uhc').id)!;
    expect([blood.health, plan.health]).toEqual(['awaits_sign_in', 'awaits_sign_in']);
    expect(signInWords([peds, blood, plan])).toEqual({ text: `${peds.name} needs a sign-in`, route: { name: 'source', source: peds.source.id } });
    expect(signInWords([blood, plan])).toBeUndefined();
  });

  it('is absent when nothing needs a person', () => {
    expect(signInWords(views.filter((v) => v !== peds))).toBeUndefined();
  });
});

describe('remedyCommand', () => {
  const base = { code: 'needs_person', message: 'athena needs a sign-in: its export answered that the sign-in has ended' };
  it('takes the command from medrec’s own remedy, which 0.7.0 writes beside the provider’s words', () => {
    expect(remedyCommand({ ...base, remedy: 'run `medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa` on this machine', provider_message: 'Run `athena auth login`.' })).toBe('medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa');
  });
  it('takes nothing from a remedy written before 0.7.0, or one that names no medrec command', () => {
    expect(remedyCommand({ ...base, remedy: 'Run `athena auth login`, then import again.' })).toBeNull();
    expect(remedyCommand({ ...base, remedy: 'Run `athena auth login`.', provider_message: 'Session ended.' })).toBeNull();
    expect(remedyCommand({ ...base, provider_message: 'Session ended.' })).toBeNull();
    expect(remedyCommand(null)).toBeNull();
  });
  it('takes it whether the provider said something, nothing (an empty string), or the key is missing', () => {
    const own = 'run `medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa` on this machine';
    for (const said of [{ provider_message: 'Session ended.' }, { provider_message: '' }, {}, { provider_message: null } as unknown as ErrorInfo]) {
      expect(remedyCommand({ ...base, remedy: own, ...said })).toBe('medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa');
    }
  });
});

describe('shownRemedy', () => {
  const base = { code: 'needs_person', message: 'athena needs a sign-in: its export answered that the sign-in has ended' };
  const own = { ...base, remedy: 'run `medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa` on this machine', provider_message: '' };
  it('leaves medrec’s own out where its command is above it, and of a try that is past', () => {
    expect([shownRemedy(own, {}), shownRemedy(own, { commandAbove: true }), shownRemedy(own, { past: true })]).toEqual([own.remedy, undefined, undefined]);
  });
  it('keeps a past one that gives no medrec command, and a provider tool’s own', () => {
    const wait = { ...base, remedy: 'ask the practice', provider_message: 'Account closed.' };
    expect([shownRemedy(wait, { past: true }), shownRemedy(wait, { commandAbove: true })]).toEqual(['ask the practice', undefined]);
    const tool = { ...base, remedy: 'Run `athena auth login`, then import again.' };
    expect([shownRemedy(tool, { past: true }), shownRemedy(tool, { commandAbove: true })]).toEqual([tool.remedy, tool.remedy]);
    expect(shownRemedy(base, {})).toBeUndefined();
  });
});

describe('isMedrecOwnError', () => {
  const message = 'athena needs a sign-in: its export answered that the sign-in has ended';
  const own = 'run `medrec refresh sign-in s_aaaaaaaaaaaaaaaaaaaa` on this machine';
  it('knows medrec’s own words, with or without the provider’s beside them', () => {
    expect(isMedrecOwnError({ code: 'needs_person', message, remedy: own, provider_message: 'Run `athena auth login`.' })).toBe(true);
    expect(isMedrecOwnError({ code: 'needs_person', message, remedy: own, provider_message: '' })).toBe(true);
    expect(isMedrecOwnError({ code: 'needs_person', message, remedy: own })).toBe(true);
  });
  it('takes a provider tool’s error from before 0.7.0 as the tool’s', () => {
    expect(isMedrecOwnError({ code: 'needs_person', message: 'The sign-in has expired. Run `athena auth login`.', remedy: 'Run `athena auth login`, then import again.' })).toBe(false);
    expect(isMedrecOwnError({ code: 'needs_person', message: 'Session expired.', remedy: 'Run `athena auth login`.', provider_message: null } as unknown as ErrorInfo)).toBe(false);
    expect(isMedrecOwnError({ code: 'upstream', message: 'The portal answered 502 twice.' })).toBe(false);
    expect(isMedrecOwnError(null)).toBe(false);
  });
});
