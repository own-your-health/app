// One source: its state, its refresh requests, and every attempt the Mac
// recorded for it.

import type { AttemptLine } from '../../model/types';
import { h, icon } from '../dom';
import { button, card, chip, empty, kv, link, refreshControl, type Ctx } from '../components';
import { count, dateTime, duration, relative } from '../format';
import { canRefresh, errorDetails, HEALTH_TEXT, sourceDetail } from './sources';
import { called } from '../../model/people';

const OUTCOME_TONE: Record<string, 'ok' | 'error' | 'attention' | 'muted' | 'running'> = {
  ok: 'ok',
  failed: 'error',
  needs_person: 'attention',
  skipped_interval: 'muted',
  skipped_paused: 'muted',
  running: 'running',
};

function monthsBack(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function attemptRow(a: AttemptLine): HTMLElement {
  const c = a.counts;
  const counts = c ? [c.records_added !== undefined ? `${c.records_added} new` : null, c.records_updated !== undefined ? `${c.records_updated} changed` : null, c.records_unchanged !== undefined ? `${c.records_unchanged} unchanged` : null].filter(Boolean).join(', ') : '';
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'row-line' },
      h(
        'div',
        { class: 'row-main' },
        h(
          'div',
          { class: 'row-body' },
          h('div', { class: 'row-title' }, dateTime(a.started_at)),
          h('div', { class: 'row-meta' }, [a.trigger === 'request' ? 'Asked from the app' : a.trigger === 'manual' ? 'Run on the Mac' : 'Scheduled', counts].filter(Boolean).join(' · ')),
        ),
      ),
      h('div', { class: 'row-aside' }, chip(a.outcome.replace(/_/g, ' '), OUTCOME_TONE[a.outcome] ?? 'muted')),
    ),
    a.error ? errorDetails(a.error) : null,
  );
}

export function sourceView(ctx: Ctx, sourceId: string): HTMLElement {
  const v = ctx.store.sources(ctx.now()).find((x) => x.source.id === sourceId);
  const back = h('p', null, link({ name: 'sources' }, icon('back', 16), ' All sources'));
  if (!v) return h('div', { class: 'stack' }, back, card({}, empty('This source is not in the records folder.')));
  const [label, tone] = HEALTH_TEXT[v.health];
  const st = v.status;
  const history = h('div', null, h('p', { class: 'muted small' }, 'Loading the Mac’s history…'));
  const now = ctx.now();
  let months = 3;
  const loadHistory = () => {
    void Promise.all(monthsBack(now, months).map((m) => ctx.store.attempts(m).catch(() => [])))
      .then((all) => all.flat().filter((a) => a.source === sourceId))
      .then((lines) => {
        history.replaceChildren(
          lines.length ? h('div', null, lines.map(attemptRow)) : empty(st ? `No attempts recorded in the last ${months} months.` : 'This source is not set up for refresh, so the Mac records no attempts for it.'),
        );
        if (st && months < 24) {
          history.append(
            button(
              'Show older',
              () => {
                months += 6;
                loadHistory();
              },
              { ghost: true, small: true },
            ),
          );
        }
      });
  };
  loadHistory();
  const imports = ctx.store.index(v.source.person)?.imports.filter((i) => i.cli === v.source.cli && i.organization === v.source.organization) ?? [];
  return h(
    'div',
    { class: 'stack' },
    back,
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h1', null, v.name), chip(label, tone)),
      h('p', { class: 'muted' }, [v.person ? called(v.person) : null, v.source.cli].filter(Boolean).join(' · ')),
      h('div', { class: 'source-lines' }, sourceDetail(ctx, v)),
      canRefresh(v) ? h('div', { class: 'glance-action' }, refreshControl(ctx, { source: v.source.id }, v.name, { primary: true })) : null,
    ),
    card(
      { title: 'Details' },
      kv([
        ['Provider CLI', v.source.cli],
        ['Organization', v.source.organization_name ?? v.source.organization],
        ['Kind', v.source.kind],
        ['Patient at source', v.source.patient_label ?? v.source.patient_id],
        ['Loads on a schedule', st ? (st.auto ? 'Yes' : 'No, only when asked') : 'Not set up for refresh'],
        ['Shortest time between loads', st?.min_interval_secs ? duration(st.min_interval_secs) : undefined],
        ['Sign-in checked', st?.sign_in?.checked_at ? relative(st.sign_in.checked_at, now) : undefined],
        ['Source id', h('code', null, v.source.id)],
      ]),
    ),
    card({ title: 'Attempts' }, history),
    card(
      { title: 'Imports in the records' },
      imports.length
        ? [...imports]
            .sort((a, b) => b.imported_at.localeCompare(a.imported_at))
            .slice(0, 20)
            .map((i) =>
              h(
                'div',
                { class: 'row' },
                h(
                  'div',
                  { class: 'row-line' },
                  h(
                    'div',
                    { class: 'row-main' },
                    h(
                      'div',
                      { class: 'row-body' },
                      h('div', { class: 'row-title' }, dateTime(i.imported_at)),
                      h('div', { class: 'row-meta' }, `${i.cli} ${i.cli_version} · ${i.records_added} new, ${i.records_updated} changed, ${i.records_unchanged} unchanged · ${count(i.documents_added, 'document')} added`),
                    ),
                  ),
                ),
              ),
            )
        : empty('medrec has not imported from this source yet.'),
    ),
  );
}
