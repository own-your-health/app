// Writes test/fixtures/bills/paid/: the sample once the household has marked
// payments on its bills (scripts/cases.mjs). Run it after
// scripts/demo-folder.mjs, and commit the result.

import { only, writeMarked } from './cases.mjs';

/** A person's one bill for an amount. */
const bill = (folder, amount) => only(folder, 'documents', (d) => d.doc_type === 'bill' && d.statement?.amount_due?.amount === amount, `bills for $${amount}`);
const paid = (document, on, amount) => ['bills', 'paid', document, '--on', on, '--amount', amount];

writeMarked('bills/paid', [
  // All of a bill that asks more than its claim says.
  paid(bill('Sam Example', '120.00'), '2026-11-20', '120.00'),
  // Part of one, past its due date.
  paid(bill('Robin Example', '53.68'), '2026-11-18', '20.00'),
  // All of one, in two payments.
  paid(bill('Robin Example', '19.28'), '2026-11-02', '10.00'),
  paid(bill('Robin Example', '19.28'), '2026-11-16', '9.28'),
]);
