import { describe, expect, it } from 'vitest';
import { sourceViews } from '../src/model/sources';
import type { RefreshRequest } from '../src/model/types';
import { NEEDS_PERSON, needsAttention, requestAnswer } from '../src/ui/views/sources';
import { demo, sourceOf } from './demo-data';

const NOW = new Date('2026-11-22T20:00:00Z');
const { household, indexes, status } = demo();
const views = sourceViews({ household, indexes, status, pending: [], done: [] });
const names = { sources: views, people: household.people };

function answered(scope: RefreshRequest['scope'], outcomes: string[], message?: string): RefreshRequest {
  return {
    schema: 'medrec-request/v1',
    id: 'x_aaaaaaaaaaaaaaaaaaaa',
    requested_at: '2026-11-22T19:00:00Z',
    requested_by: { email: 'robin@example.com' },
    scope,
    app: { name: 'own-your-health-app', version: '0.1.0' },
    handled: { finished_at: '2026-11-22T19:58:00Z', outcome: 'partial', sources: outcomes.map((outcome, i) => ({ source: `s_${String(i).padStart(20, 'a')}`, outcome })), ...(message ? { message } : {}) },
  };
}

describe('the answer to a refresh request', () => {
  it('names the one outcome every source had', () => {
    expect(requestAnswer(answered({ all: true }, ['ok', 'ok']), names, NOW)).toBe('Last refresh request 2 minutes ago: loaded');
  });

  it('counts each outcome when they differ', () => {
    expect(requestAnswer(answered({ all: true }, ['ok', 'ok', 'needs_person', 'skipped_interval']), names, NOW)).toBe(
      'Last refresh request 2 minutes ago: 2 loaded, 1 needed a person, 1 not due yet',
    );
  });

  it('names the source or person a narrower request was for', () => {
    const lab = sourceOf(household, 'Sam Example', 'labcorp');
    const sam = household.people.find((p) => p.name === 'Sam Example')!;
    expect(requestAnswer(answered({ source: lab.id }, ['ok']), names, NOW)).toMatch(/^Last refresh request for .+ 2 minutes ago: loaded$/);
    expect(requestAnswer(answered({ person: sam.id }, ['ok']), names, NOW)).toBe('Last refresh request for Sam Example 2 minutes ago: loaded');
  });

  it('falls back to the Mac’s message when it lists no source', () => {
    expect(requestAnswer(answered({ all: true }, [], 'No source of this request is set up for refresh.'), names, NOW)).toBe(
      'Last refresh request 2 minutes ago: No source of this request is set up for refresh.',
    );
  });
});

describe('what needs attention', () => {
  it('puts the sign-in that needs a person before the failed load', () => {
    expect(needsAttention(views).map((v) => v.health)).toEqual(['needs_person', 'failed']);
  });

  it('leaves a failed load off the list only a person can act on', () => {
    expect(needsAttention(views).filter((v) => NEEDS_PERSON.includes(v.health)).map((v) => v.health)).toEqual(['needs_person']);
  });
});
