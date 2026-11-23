# Own Your Health: records

A web page that shows a household's medical records from the household's own
Google Drive. It reads the records folder that
[medrec](https://github.com/own-your-health/medrec-cli) keeps, and shows:

- each person's overview: what the latest loads added, the newest result of
  each test with those out of range first, active conditions, current
  medicines, allergies, immunizations and recent visits, each naming the
  source it came from;
- each person's records: a timeline, results by panel and over time against
  their reference range, medicines,
  conditions, allergies, immunizations, claims and bills, documents and
  imaging studies;
- one search over everyone's records, documents and imaging, and the text
  medrec extracted from documents, from the home screen or the search
  button in the bar, or within one person;
- for any record, the raw FHIR the source served, where it came from, and the
  import that brought it in;
- each source's last load (when, and how many records were new, changed and
  unchanged), its last attempt, and whether its sign-in is good or needs a
  person;
- a Refresh button per source, per person and for everything, which asks the
  household's Mac to load again.

It runs entirely in the browser at **https://own-your-health.github.io/app/**.
There is no server: the page signs in to Google, reads the folder from Drive,
and keeps what it reads in memory.

**Try it without a Drive:** https://own-your-health.github.io/app/?demo shows
invented records for an invented household, and a simulated Mac that answers
Refresh.

## What you need

New to this? [docs/getting-started.md](docs/getting-started.md) goes from
nothing to the records on a phone: medrec and its tools, the records folder,
your documents and providers, the Google client, the app and Refresh.

1. **A records folder in Google Drive, kept by medrec.** The app reads
   `household.json` at the top of the folder, each person's `index.json`, and
   the files they list. See medrec's
   [data contract](https://github.com/own-your-health/medrec-cli/blob/main/docs/data-contract.md).
2. **Your own Google OAuth client.** Each household signs in through a client
   it creates in its own Google Cloud project, so no one else's app holds
   access to its Drive. It takes about ten minutes and costs nothing:
   [docs/registration.md](docs/registration.md).
3. **For Refresh: `medrec refresh` on the household's Mac.** Run
   `medrec refresh --install` there once. Without it, the app still shows
   everything medrec has loaded, built from medrec's import history, and says
   Refresh is not set up.

## Using it

1. Open https://own-your-health.github.io/app/ and paste your client id (it
   ends in `.apps.googleusercontent.com`). On every other device, open the
   setup link instead: Settings, **Setup link for another device**, which adds
   `?client=<your client id>` to the address and skips this step.
2. Sign in with the Google account that holds the records folder, or one it is
   shared with. Google warns that it has not verified the app, which is
   expected for a household's own client, in Testing or published. Allow both
   permissions.
3. Choose the records folder. The app lists the folders with a
   `household.json` that the account can see; you can also paste a folder link.

Home leads with the household's people and their records, then one line for
a sign-in that needs a person ("Example Health Plan needs a sign-in on the
Mac"), which opens the source, then search, when the records last loaded and
**Refresh everything**. **Sources** (`#/sources`, the stack icon in the bar,
which carries a dot while a source needs attention) has every source: its
sign-in, its last load and attempt, and when the Mac loads it next. A
source's page says in one sentence what happened and gives the medrec
command to run; what the provider's own tool reported, which can name that
tool's commands, is folded under **Error details**. When the Mac skips a
source because it loaded or tried it too recently, the answer says when it
may load again.

For a child under 19, the overview and the Immunizations section set the
recorded doses beside the routine rows of the CDC's child and adolescent
immunization schedule (the July 2, 2025 version, which CDC's site serves):
which doses the schedule places by the child's age that the records do not
show, and which fall in the next 90 days, with each season's flu dose. It is
the schedule's timing, not advice. Doses given elsewhere may be missing from
the records, and the schedule's catch-up rules and exceptions are not
applied. The table is `src/model/schedule.ts`.

A result is out of range when the source's interpretation says so (High,
Low, Abnormal, Critical), or, when it gave none the app can read, when the
value falls outside the reference range in the same unit; the app labels
those **Above range** or **Below range**, so it is clear the app worked it out.

Conditions, allergies, medicines and vaccines are listed once each, however
many dates the records hold them on, by the newest record's status in words
(active, resolved, inactive, stopped), with when each was first recorded and
every source that recorded it. A medicine joins its prescription to its
fills: who prescribed it and the last fill and pharmacy. One only reported
says so. A vaccine lists every dose, and a dose recorded as not given stands
apart. The rules are `src/model/lists.ts`, which the overview's cards use too.

Search needs every word, or "a quoted phrase", somewhere in an item's name,
its fields (a visit's reason, a medicine's dosage or prescriber, each of a
claim's lines, a statement's account and amount) or, for a document, the
text in the person's `text.json`, ignoring case and accents. Name matches
come first, then field matches, then matches only in a document's text,
newest first in each, with the words marked and filters by kind and person.

A few everyday words name a kind of thing instead. The other words in the
query are searched within that kind. Each word below also matches its
plural. `CONCEPTS` in `src/model/search.ts` is the table:

| Words | Finds |
|---|---|
| blood test, bloodwork, blood work, lab, lab result, lab test, lab work, test result | lab results (not vital signs or other categories) and lab reports |
| shot, vaccine, vaccination, immunization | vaccines and immunization records |
| bill, cost, claim, charge, statement, EOB | claims, statements, receipts and explanations of benefits |
| visit, appointment | visits and visit summaries |
| med, medication, medicine, prescription | medicines and prescriptions |

- "Flu shot" finds flu vaccines.
- When nothing of the kind has the other words, the search is every word as
  written: "lab statement" finds the lab's statement.
- A phrase in quotes is always words.
- The page offers to search the words as written instead. The address
  keeps that choice as `&words=1`.

Results come in groups by kind:
- health records first, then imaging and documents, then coverage and
  claims;
- a test found more than once is one row under its panel, with its newest
  value and how many results it has, and opens its history;
- a claim shows its provider and what you owe, and the line that matched.

Each person's `text.json` is read from Drive on the first search, and
nothing leaves the browser. `#/search?q=<words>` is the search page's
address. The rules are `src/model/search.ts`.

The timeline lists visits, each with its documents, what was recorded at it
(diagnoses, results, procedures, medicines, vaccines, allergies and
reports), its insurer claim and imaging. A
document belongs to a visit when medrec linked it, or when it is dated within
the visit (its day, or a stay's days) and comes from the same organization,
by medrec's organization id or, for a document filed by hand, by name. Each
document joins one visit at most, and a linked one is never taken by another.
Every record, in the order it happened, is one tap away. The rules are
`src/model/visits.ts`.

Claims and bills show what each provider's newest statement says is due
(per provider and account, with a receipt filed after it counted as paid),
the plan's deductible and out-of-pocket limit so far from the newest claim
that printed them, and each insurer claim beside its bill: a statement from
the same provider within 120 days after the visit, preferring one whose
amount is the claim's share. A claim with nothing to pay says so, and one
with a share but no bill yet says that. Money is added in whole cents. The
rules are `src/model/billing.ts`.

A claim is named for what it paid for, from its lines ("Lipid panel and
blood draw"), not for its type. Its page lists each line with its code, a
category from the code (visit, lab test, imaging, vaccine and so on), its
date and its amounts: billed, allowed, plan paid, deductible, copay,
coinsurance, not covered and you owe. The rules are `src/model/claims.ts`.

Results are grouped by panel (metabolic, lipid, A1c, liver, blood count,
thyroid, vitamins and iron, urine, vital signs) by each test's LOINC code,
from a table in `src/model/panels.ts`; a test outside the table goes by the
category its source gave, or under Other tests. A panel with a critical
result comes first, then one with any result out of range, and within a
panel the out-of-range tests come first, then the order a lab report uses.
Each test's chart shades the reference range each result came with.

Every record's page leads with the plain answer. A result shows:
- its plain name, from a table of the common tests in
  `src/model/labtests.ts`, else the source's own name, else its LOINC name;
- its value, and whether it is within the lab's range, in words and as a
  marker on the range;
- a sentence or two on what the test measures and what a high or low result
  can go with, written from the MedlinePlus page it links and stopping at
  "a question for your doctor";
- its history, with the range band;
- the other tests from the same draw, and the visit and lab report it came
  with.

A status badge shows only when the result is not final. A medicine leads
with how to take it and its last fill. A condition, an allergy, a vaccine, a
visit and a claim each lead with what a person would ask first. Codes, every
field, where a record came from, the import that brought it in, its
identifiers and its raw FHIR stay whole under one folded Technical details.

Every person and record has its own address, such as `#/p/<person id>` (the
person's overview; `#/p/<person id>/timeline` is the visits timeline and
`#/p/<person id>/timeline/all` every record in date order) and
`#/p/<person id>/r/<record id>`, so a bookmark or another app can link
straight to it. `#/hh/<id>` opens the person whose
`links.huishouden_health_person` is that id.

A link from Huishouden Health, or any other app, can carry the setup link's
`?client=<client id>` before the route:
`https://own-your-health.github.io/app/?client=<client id>#/hh/<id>`. A device
that has never opened the app then needs no setup: it signs in and lands on
the person. The app takes `?client=` out of the address before signing in.

The sign-in lasts an hour. When it ends, the app signs in again on its own, as
the same account, when you come back to it or it next reads the folder. It
asks you only if Google needs you. Opening the app later does the same. The
app names the account to Google, so a browser signed in to several Google
accounts shows no account chooser; **Use a different account** on the sign-in
screen forgets it, and so do signing out and changing the client.

Settings has a **Theme**: System (the device's light or dark setting, the
default), Light or Dark.

### On the Home Screen

The app can be installed like an app, with no app store, once it is set up in
the browser:

- **Android, in Chrome:** the menu, then **Install app** (or **Add to Home
  screen**). The installed app shares Chrome's storage, so it keeps the client
  and the folder. Google's sign-in opens over the app and returns to it.
- **iPhone and iPad, in Safari:** Share, then **Add to Home Screen**. The
  installed app keeps its own storage, apart from Safari's, and has no address
  bar: on its first screen, paste the setup link (or the client id) and choose
  the folder again.

The app opens at its start page; nothing about the household is in the
installed shortcut. It has no service worker, so it needs a connection, as it
does in the browser.

### Refresh, and sign-ins that need a person

Refresh writes one small request file into the folder's `_requests/`. The Mac
picks it up on its next pass (every few minutes), loads the sources it names,
and writes the outcome to `_status/` and `_requests/done/`, which the app
reads back. The app shows when a request is waiting, when the Mac is late, and
what it answered.

Some sign-ins need a person: a new password, a code by text, a captcha. The
app never asks for or holds a provider password. It shows the exact command to
run in a terminal on the Mac, such as `medrec refresh sign-in s_…`.

## Privacy and security

The privacy policy is at https://own-your-health.github.io/app/privacy.html
(`privacy.html`), linked under every screen and from Settings.

- **No server, no third parties.** The page loads only its own files. Its
  Content-Security-Policy lets it connect only to itself and Google's OAuth
  and Drive endpoints (`www.googleapis.com`, `oauth2.googleapis.com`). There
  are no analytics, fonts or CDNs, and the page refuses to run inside a frame.
- **Google sign-in by redirect.** The app uses Google's OAuth 2.0 flow for
  client-side apps: a full-page redirect to Google, which returns an access
  token. It loads no Google script and uses no client secret.
- **The token stays in memory.** It is gone when the tab closes. Signing out
  revokes it with Google.
- **Browser storage holds four settings, nothing else:** your client id
  (`own-your-health-app.client_id`), the chosen folder's id and name
  (`own-your-health-app.folder`), the email of the Google account that last
  signed in (`own-your-health-app.account`), and the theme, when you choose
  one (`own-your-health-app.theme`). None is a secret. The client
  id and the email go to Google as the sign-in's `client_id` and `login_hint`,
  and the folder id goes to Drive when the app reads the folder. During a
  sign-in, a random nonce sits in session storage until Google answers.
- **Read-only, except requests.** The app writes only refresh requests into
  `_requests/`, and deletes only requests it made (a cancel). medrec is the
  only writer of records.
- **Records stay in the browser.** Nothing from the folder is sent anywhere
  but back to Drive. Error messages carry no record content.
- **Links out carry the thing, never the person.** A record page links to
  where a person can read about a test, medicine, condition, allergy,
  procedure or vaccine:
  - MedlinePlus Connect, by the record's code (LOINC, RxNorm, NDC,
    ICD-10-CM, ICD-9-CM, SNOMED CT or CPT), with the test's name from this
    app's own table when it has one;
  - CDC's Vaccine Information Statement, for a vaccine's CVX code;
  - otherwise a MedlinePlus search by the record's name, only when that name
    is short, one phrase, and holds no date, long number, email address or
    link. The page shows the exact words beside the link.

  The record's name, in that last case, is the only text from the records a
  link can carry. No link carries a value, a date, a person, or a record or
  folder id. The app never fetches the page; it opens only when tapped, in a new tab with
  `rel="noopener noreferrer"` and no referrer. The page says which site it
  opens. The rules are `src/model/learn.ts`.

### Google permissions, and why

| Scope | What the app does with it |
|---|---|
| `drive.readonly` | Reads the records folder, which medrec wrote, so the app did not create it. |
| `drive.file` | Creates and deletes its own refresh requests in `_requests/`. |

`drive.file` alone reaches only files the app created or was given, so it
cannot read the records. `drive.readonly` alone cannot create a file. Together
they are the narrowest pair that works; the app never asks for full `drive`.
[docs/registration.md](docs/registration.md#scopes) records how this was
tested.

## Limits

- One records folder at a time.
- Imaging studies are listed, not viewed: the app shows the command that
  opens a study in Weasis on the Mac.
- No offline copy. Each visit reads the folder again.
- Records folders written by a newer medrec, with a higher `format` in
  `household.json`, are refused with "Update the app".

## Development

Node 22 or newer.

```sh
npm ci
npm run dev        # http://localhost:5173/app/ (sample: /app/?demo)
npm run verify     # lint, typecheck, unit tests, build
npm run e2e        # browser tests at phone and desktop sizes: the sample, and signed in through a stand-in for Google and Drive
```

- Plain TypeScript, built by Vite, with no runtime dependencies.
- The sample folder in `public/demo/` comes from `scripts/demo-folder.mjs`.
  Run `node scripts/demo-folder.mjs` after changing it, and commit both.
- The PNG icons in `public/` (for the manifest and the iPhone Home Screen) are
  drawn from `public/icon.svg` by `npm run icons`. Run it after changing the
  icon, and commit them.
- `http://localhost:5173/app/?scope-test=1&client=<client id>` runs a check of
  the two Drive permissions against a folder named `oyh-app-scope-test`. It
  exists only in the dev server and is left out of production builds.
- Tests use invented data only. Never commit a real record, account, client
  id or folder id.

Unofficial. Not affiliated with or endorsed by Google.

## License

MIT
