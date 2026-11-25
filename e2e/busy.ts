import { demoJson, type Overlay } from '../test/helpers';
import { rewritten } from './alter';

interface Item extends Record<string, unknown> {
  id: string;
}
interface Index {
  records: (Item & { display?: string; date: string; fields: Record<string, unknown> })[];
  documents: (Item & { statement?: { amount_due?: { amount: string } } })[];
}

const TODAY = '2026-11-22';
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PEOPLE = 4;

/**
 * The sample with `extra` more things waiting, dealt out to its people in
 * turn: each gets bills past due, medicines that ran out, bills to come and
 * medicines that run out soon, in turn. Everything added is invented.
 */
export function busy(extra: number): Overlay {
  const sam = demoJson<Index>('Sam Example/index.json');
  const statement = sam.documents.find((d) => d.statement?.amount_due?.amount === '90.50')!;
  const claim = sam.records.find((r) => r.kind === 'claim')!.id;
  const medicine = sam.records.filter((r) => r.display === 'Famotidine 20 mg tablet' && r.date <= '2026-09-28');
  if (medicine.length !== 2) throw new Error('the sample’s famotidine is not an order and a fill');
  let made = 0;
  const newId = (kind: string) => `${kind}_${String(++made).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!).padStart(20, 'z')}`;
  let person = 0;
  return rewritten({}, ({ index, bills }) => {
    const turn = person++;
    for (let n = turn; n < extra; n += PEOPLE) {
      const kind = Math.floor(n / PEOPLE) % 4;
      if (kind === 0 || kind === 2) {
        const due = day(kind === 0 ? -(n % 40) - 1 : (n % 20) + 1);
        const [id, organization, asks] = [newId('d'), `Example Practice Number ${n + 1}`, `${n + 1}.00`];
        index.documents.push({ ...structuredClone(statement), id, organization, title: `Statement from ${organization}`, date: day(-60), statement: { statement_date: day(-60), due_date: due, amount_due: { amount: asks, currency: 'USD' } } });
        bills.bills[id] = { organization, title: `Statement from ${organization}`, date: day(-60), currency: 'USD', amount_due: asks, due_date: due, rule: 'D3', claim, claim_you_owe: asks, paid: [], paid_total: '0.00', left: asks, settled: false };
      } else {
        const out = kind === 1 ? -(n % 13) - 1 : (n % 13) + 1;
        const display = `Sample Medicine With A Long Name ${n + 1} 10 mg tablet`;
        for (const r of medicine) {
          const filled = r.fields.source === 'dispense' ? day(out - 30) : r.date;
          index.records.push({ ...structuredClone(r), id: newId('r'), key: `medication|${display.toLowerCase()}|${filled}`, code: undefined, display, date: filled, fields: { ...r.fields, when: filled } } as (typeof index.records)[number]);
        }
      }
    }
  });
}
