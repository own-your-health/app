// A person's insurance coverage, on their Money: each insurer and plan they
// have had, newest first, and a change that fell on someone's birthday.

import { birthWords, coverageHistory, type CoverageSegment } from '../model/coverage';
import { organizationName } from '../model/records';
import { card, row, type Ctx } from '../ui/components';
import { h } from '../ui/dom';
import { dateText } from '../ui/format';

const COVERED_AS: Record<string, string> = { child: 'covered as a child', spouse: 'covered as a spouse', common: 'covered as a partner', parent: 'covered as a parent' };

/** "Jan 1, 2012 to May 16, 2016", "since May 17, 2016". */
function coverageDays(s: CoverageSegment): string {
  if (s.start && s.end) return `${dateText(s.start)} to ${dateText(s.end)}`;
  if (s.start) return `since ${dateText(s.start)}`;
  return s.end ? `until ${dateText(s.end)}` : 'no dates in these records';
}

const coverageName = (s: CoverageSegment) => (s.plan ? `${s.insurer}, ${s.plan}` : s.insurer);

/** The person's coverage card, or nothing when their records name no coverage. */
export function coverageCard(ctx: Ctx, person: string): HTMLElement | null {
  const idx = ctx.store.index(person);
  const segments = idx ? coverageHistory(idx, ctx.store.household, person) : [];
  if (!segments.length) return null;
  const from = (s: CoverageSegment) => s.organizations.flatMap((o) => organizationName(ctx.store.household, person, o) ?? []);
  return card(
    { title: 'Coverage', class: 'coverage-history' },
    segments.map((s) => {
      const born = birthWords(s, dateText);
      const sources = from(s);
      return row({
        route: { name: 'item', person, id: s.records[0]!.id },
        title: coverageName(s),
        meta: [coverageDays(s), s.relationship ? COVERED_AS[s.relationship] : null].filter(Boolean).join(' · '),
        extra: h(
          'div',
          { class: 'coverage-extra' },
          born ? h('p', { class: 'small coverage-born' }, born) : null,
          sources.length ? h('p', { class: 'small muted' }, `In records from ${sources.join(' and ')}.`) : null,
        ),
      });
    }),
    segments.some((s) => s.born) ? h('p', { class: 'small muted' }, 'A birthday beside a change is a date the two share. These records don’t say why coverage changed.') : null,
  );
}
