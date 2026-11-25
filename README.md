# Own Your Health: records

A web page that shows a household's medical records from the household's own
Google Drive. It reads the records folder that
[medrec](https://github.com/own-your-health/medrec-cli) keeps, and shows:

- **Home**: what needs someone (bills worth a call, bills to pay, vaccine
  doses, refills), where everyone stands, and what happened recently;
- **Calendar**: the household's visits, stays, tests and fills, a month at a
  time with a lane per person, or as one list;
- each **visit**: what happened, its results, how the price came down to
  what you owe, who charged what, bills, papers and the claims;
- **Money**: what care cost by plan year or calendar year, bills beside their
  claims, the ones worth a call, deductibles and out-of-pocket limits,
  coverage over time, and every claim by provider, kind of care and month,
  with a CSV of the lines;
- **Health**: each person's page (what is due, current, worth noticing and
  recent), their full lists of results against their reference range,
  medicines, conditions, allergies, immunizations and imaging, and a sheet to
  hand a doctor;
- **Papers**: every file in the folder, each with the visit it belongs to,
  for everyone or one person, by kind of paper;
- one search over everyone's records, documents and imaging, and the text
  medrec extracted from documents, from Home or the search button in the
  bar;
- for any record, the raw FHIR the source served, where it came from, and the
  import that brought it in;
- each source's last load (when, and how many records were new, changed and
  unchanged), its last attempt, and whether its sign-in is good or needs a
  person;
- a Refresh button per source, per person and for everything, which asks the
  household's Mac to load again.

It runs entirely in the browser at **https://own-your-health.github.io/app/**;
the project's page is https://own-your-health.github.io/. There is no server: the page signs in to Google, reads the folder from Drive,
and keeps what it reads in memory.

**Try it without a Drive:** https://own-your-health.github.io/app/?demo shows
invented records for an invented household, and a simulated Mac that answers
Refresh.

**Ask an assistant:** [connector](https://github.com/own-your-health/connector)
serves the same folder to Claude, ChatGPT, Gemini and other assistants that
take remote MCP connectors, from a Cloudflare Worker in the household's own
account.

## What you need

New to this? [docs/getting-started.md](docs/getting-started.md) goes from
nothing to the records on a phone: medrec and its tools, the Google Cloud
project and its two clients, the records folder, your documents and providers,
the app and Refresh.

1. **A records folder in Google Drive, kept by medrec.** The app reads
   `household.json` at the top of the folder, each person's `index.json`, and
   the files they list. See medrec's
   [data contract](https://github.com/own-your-health/medrec-cli/blob/main/docs/data-contract.md).
2. **Your own Google OAuth client.** Each household signs in through a client
   it creates in its own Google Cloud project, so no one else's app holds
   access to its Drive. It takes about ten minutes and costs nothing:
   [docs/registration.md](docs/registration.md). medrec 0.6.0 and later
   signs in through a Desktop app client in the same project; in another
   project, medrec cannot see the app's refresh requests.
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

Home, Calendar, Money, Health and Papers are tabs: at the bottom of a
phone's screen, and a row above the page from 640px wide. The bar's menu
holds Sources and Settings. Home closes with one line for a
sign-in that needs a person ("Example Pediatrics needs a sign-in on the
Mac"), which opens the source, then when the records last loaded and
**Refresh everything**. **Sources** (`#/sources`, in the bar's menu, which
carries a dot while a source needs attention) has every source: its
sign-in, its last load and attempt, and when the Mac loads it next. A
source's page says in one sentence what happened and gives the medrec
command to run; what the provider's own tool reported, which can name that
tool's commands, is folded under **Error details**. When the Mac skips a
source because it loaded or tried it too recently, the answer says when it
may load again.

For a child under 19, Home, Health and the Immunizations list set the
recorded doses beside the routine rows of the CDC's child and adolescent
immunization schedule (the July 2, 2025 version, which CDC restored after a
court stayed its January 2026 changes on March 16, 2026; the page says so):
which doses the schedule places by the child's age that the records do not
show, and which fall in the next 90 days, with each season's flu dose. It is
the schedule's timing, not advice. Doses given elsewhere may be missing from
the records, and the schedule's catch-up rules and exceptions are not
applied. The table is `src/model/schedule.ts`.

A result is out of range when the source's interpretation says so (High,
Low, Abnormal, Critical), or, when it gave none the app can read, when the
value falls outside the reference range in the same unit; the app labels
those **Above range** or **Below range**, so it is clear the app worked it out.
A number the lab sent as text ("95", a FHIR valueString) reads as a number,
in the unit its range names. A value sent as a bound ("<0.5", ">60") stays
text and reads against the range only when every value it allows sits on one
side of it: ">60" against "60 or more" is within, "<0.5" against 0–1 says
nothing.

Conditions, allergies, medicines and vaccines are listed once each, however
many dates the records hold them on, by the newest record's status in words
(active, resolved, inactive, stopped), with when each was first recorded and
every source that recorded it. A medicine joins its prescription to its
fills: who prescribed it and the last fill and pharmacy. One only reported
says so. A vaccine lists every dose, and a dose recorded as not given stands
apart. The rules are `src/model/lists.ts`, which Health uses too.

Search needs every word, or "a quoted phrase", somewhere in an item's name,
its fields (a visit's reason, a medicine's dosage or prescriber, each of a
claim's lines and diagnoses, a statement's account and amount) or, for a
document, the text in the person's `text.json`, ignoring case and accents.
Name matches come first, then field matches, then matches only in a
document's text, newest first in each, with the words marked and filters by
kind and person.

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
- The page offers to search the words as written instead.

Results come in groups by kind:
- health records first, then imaging and documents, then coverage and
  claims;
- a test found more than once is one row under its panel, with its newest
  value and how many results it has, and opens its history;
- a claim shows its provider and what you owe (your share, when the payer
  gives only its parts), and the line or diagnosis that matched
  ("Diagnosis: Strep throat (J02.0)"). The ids and amounts medrec gives a
  claim are not searched as words.

Each person's `text.json` is read from Drive once a search is coming (the
search page opens, or the home screen's search field is chosen), so it
downloads while the words are typed, and nothing leaves the browser. `#/search?q=<words>` is the search page's
address, with `&words=1` when the words are searched as written and
`&who=<person id>` when its person filter starts on someone. The rules are
`src/model/search.ts`.

A portal visit's page lists what belongs to it: its documents, what was
recorded at it (diagnoses, results, procedures, medicines, vaccines,
allergies and reports), its insurer claim and imaging. A
document belongs to a visit when medrec linked it, or when it is dated within
the visit (its day, or a stay's days) and comes from the same organization,
by medrec's organization id or, for a document filed by hand, by name. Each
document joins one visit at most, and a linked one is never taken by another.
Every record, in the order it happened, is one tap away. The rules are
`src/model/visits.ts`.

Money's bills show what each provider's newest statement says is due
(per provider and account, with a receipt filed after it counted as paid),
the plan's deductible and out-of-pocket limit so far from the newest claim
that printed them, and each insurer claim beside its bill: a statement from
the same provider within 120 days after the visit, preferring one whose
amount is the claim's share. A claim with nothing to pay says so, and one
with a share but no bill yet says that. A pharmacy fill is not matched to a
statement: its share is paid to the pharmacy, and the claim says so. Money is added in whole cents. The
rules are `src/model/billing.ts`.

A claim is named for what it paid for, from its lines ("Cholesterol tests and
blood draw"), not for its type. Its page lists each line with its code, a
category from the code (visit, lab test, imaging, vaccine, dental, facility
charge and so on), its date and its amounts: billed, discount, allowed, plan
paid, deductible, copay, coinsurance, not covered and you owe. "You owe" is
the payer's own figure. Without one, the page shows "your share": the
deductible, copay, coinsurance and not covered it gives, added up, never a
discount. Amounts are read to the nearest cent. The page names the diagnoses
the claim gives, and under **Paid for** the visit and the results it paid
for. Each line links the records it paid for, unless every line links the
same ones. A hospital's line can carry a revenue code, which says the part
of the hospital it was billed under (0360 is the operating room): medrec
0.8.2 and later gives it in `items[].revenue`, and the page shows it beside
the line's service code ("Operating room, revenue code 0360"). A line with
a revenue code and no service code is named and coded by its revenue code,
and counts as a facility charge.

A plan that pays a service under another code than the one billed keeps the
provider's line, marked not covered, beside the one it paid, and a plan that
writes a line off keeps that too; its totals count neither. medrec 0.8.2 and later marks such a line (`items[].counted: false`)
and keeps the payer's notes on it (`items[].payer_notes`, and the claim's own
in `payer_notes`). For a claim medrec has not marked, the app finds them by medrec's
rule: it compares billed, plan paid and you owe, those the totals and a line
both give, at least two of them, and takes the one smallest set of up to
three lines whose removal makes every one agree; none when two sets tie. The
app marks such a line **Left out**, "Left out by the plan, not owed", shows
only what was billed for it and the plan's notes, and leaves it out of the
claim's title, its kind of care and every sum.

medrec 0.5.0 and later files a claim in the shape of its data contract
(`docs/data-contract.md` in medrec-cli, "index.json", claims): fixed amount
names (`amounts`, on the claim and each line), each line's `category` by a
table of code rules and the claim's (`mixed`, or `pharmacy` for a fill), its
`diagnoses`, a name that ends with " · " and the provider, and links guessed
by date and name: `visit`, `results` and each line's `records`. The app reads
them as given, with its own category rules following the same table. It
adds no guess of its own to medrec's links: such a claim with no `visit`, or
one to a record these records do not hold, joins no visit. A claim from an
earlier medrec (no `amounts` and no `category`) still reads: its amounts come
from the payer's own words, its categories from the codes, and its visit is
the one of the same day from a matching provider. `medrec reindex` files
every earlier claim again in the contract's shape, from the raw file medrec
kept for it. Every machine that imports into the folder needs medrec 0.5.0 or
later; an earlier one files the claims it imports again in the earlier shape.
The rules are `src/model/claims.ts`, and for the visit, `src/model/visits.ts`.

Coverage, on each person's Money, lists each insurer and plan the person has
had, newest first, from when to when, and whose records name it. The same
insurer starting on the same day is one coverage, whichever source names it:
the insurer's own record and a provider portal's copy show once, even when
they spell the name differently ("Example Health Plan" and "EXAMPLE HEALTH
PLAN, INC."). An end of 9999-12-31 means the coverage runs on. When a coverage
started on the day someone in the household was born, it says so ("Changed on
May 17, 2016, the day Casey was born") as a date the two share. No
source gives a reason for a change, and FHIR's Coverage has no element for
one. Costs names the changes inside the period it shows: the plan, and so
the deductible, can differ on either side of one. The rules are `src/model/coverage.ts`.

Costs (`#/costs`, from Money, for everyone or one person) adds up every
claim line in the folder: what was billed, what the plan allowed and paid,
and your share, with its deductible, copay and coinsurance. A claim whose
lines do not add up to its totals keeps the difference as a line of its own,
"Not split by line", so a period's totals are always its claims'; a line the
totals leave out counts nothing, and leaves no such line. It narrows to:
- a period: this or last plan year, a calendar year, or every year. A plan
  year starts on the day the plan's claims give for it (the benefit period an
  ExplanationOfBenefit prints, `fields.benefit_period` in the index, when it
  is about a year long), else on the month set in Settings, **Plan year**,
  else on January 1, and the screen says which. Never on a coverage's start:
  that is the day a coverage took effect, which can fall mid-year (a new
  job, say). A calendar year counts care by the day it was given, not the day
  it was paid;
- a person, a provider, a kind of care, a month, or one billing code. Each
  is a link from the chart or the breakdown, so back undoes one.

The address keeps every choice: `period=` is `plan`, `plan-1`, a year
(`2025`) or `all`; `by=` (the breakdown) is `person`, `provider` or
`category`; and each `only=` is one narrowing, `person:<id>`,
`provider:<name>`, `category:<kind>`, `month:<YYYY-MM>` or
`code:<system>:<code>` (`code:CPT:99213`).

The screen shows the plan balances each plan printed with its newest claim
in the period, plan paid and your share month by month, where it went by
person, provider or kind of care, and every claim, newest first. Each claim
leads with what it says you owe, then its lines with your share of each; a
choice that shows only some of a claim's lines still leads with the whole
claim's. A code billed more than
once is listed under "Same service, different prices"; opening one shows,
for every time it was billed, what the provider billed beside what the plan
allowed. Download CSV saves the lines shown, built in the browser, with any
cell that a spreadsheet would read as a formula prefixed with `'`. A line the
totals leave out is a row with no amounts, so a column's sum is the claims',
and "yes" under **Left out by the plan**. The last column, **Revenue
code**, holds a hospital line's revenue code. Bills and
receipts no claim covers are not counted. The rules are `src/model/costs.ts`.

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
  marker on the range: within it in a calm green with a check, outside it in
  the attention colour with an arrow, the stretches outside the range
  hatched, so none of it rests on colour alone;
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

Every person, visit and record has its own address, such as
`#/health?who=<person id>` (the person's Health), `#/p/<person id>/e/<record
id>` (a visit) and `#/p/<person id>/r/<record id>` (a record), so a bookmark
or another app can link straight to it. `#/hh/<id>` opens the Health of the
person whose `links.huishouden_health_person` is that id. Addresses from
before the redesign still open, where their page lives now:
`#/p/<person id>` on the person's Health, `/timeline` on their calendar's
list, `/claims` on their Money, `/search` on the search, its person filter
on them, and `/documents` on their Papers. The person's lists (`/results`,
`/medicines` and so on) keep their addresses.

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
does in the browser, and each launch loads the version on the site (GitHub
Pages lets a browser keep the page for up to 10 minutes; the rest of the
app's files are named by their contents, so a new version never mixes with an
old one). An installed app that comes back from the background keeps the
version it opened with, so when it comes to the front it asks the site for
its page, at most every 5 minutes, and says **A new version of the app is
ready** with a **Reload** button when the site has another.

### Refresh, and sign-ins that need a person

Refresh writes one small request file into the folder's `_requests/`. The Mac
picks it up on its next pass (every few minutes), loads the sources it names,
and writes the outcome to `_status/` and `_requests/done/`, which the app
reads back. The app shows when a request is waiting, when the Mac is late, and
what it answered. Once a request is finished the app reads the records again,
so what it brought shows without a reload. A read that fails, or that leaves
out someone whose records are here, changes nothing: it is tried again after
30 seconds, then after twice as long each time, six tries in all, and the
third failure says so (`src/data/rereads.ts`).

A request loads each source at most once every 15 minutes, counted from its
last load or try (medrec 0.7.0 and later; before, it waited the source's own
interval, a day for a member site). A source inside that time answers "too
soon after its last try", and the app says when it may load again
(`next_allowed_at`).

Some sign-ins need a person: a new password, a code by text, a captcha. The
app never asks for or holds a provider password. It shows the exact command to
run in a terminal on the Mac, such as `medrec refresh sign-in s_…`.
From medrec 0.7.0, the error of a sign-in that ended is medrec's own, and its
remedy is that command. The provider tool's words, which name the tool's own
sign-in, are kept apart (`error.provider_message`, an empty string when the
provider said nothing), and the app folds them under **Error details**. The
app knows medrec's own error by that key, or by a `medrec …` command in its
remedy, which a provider tool's own remedy never names.

Some member sites keep a sign-in for less than an hour, and nothing renews
it, so the source loads only soon after someone signs in. medrec marks such a
source in `_status/` (`sign_in.renews: false`), and where it has measured how
long a sign-in lasts, says that too (`sign_in.lasts_secs`). The app shows the
source quietly, as **Waits for a sign-in** with "Loads when someone signs in
on the Mac" and the length where known, and not as an alert: it stays off
home's sign-in line and the dot on Sources. Its page still gives the command. That holds for a week after its last load; after a
week without one, or if it never loaded, its sign-in is an alert again. A
Keychain approval nobody gave is always an alert, and a failed load shows as
failed.

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
- **The token stays in memory.** It is gone when the tab closes, and Google
  expires it within the hour. Signing out forgets it without revoking it:
  Google's revoke ends every sign-in to the Cloud project, so it would also
  sign out a medrec that signs in to Drive through the household's project.
  Removing the app's access in the Google Account does the same, and the
  privacy policy says so.
- **Browser storage holds five settings, nothing else:** your client id
  (`own-your-health-app.client_id`), the chosen folder's id and name
  (`own-your-health-app.folder`), the email of the Google account that last
  signed in (`own-your-health-app.account`), the theme, when you choose
  one (`own-your-health-app.theme`), and the month your plan year starts,
  when you set it (`own-your-health-app.plan_year_start`). None is a secret. The client
  id and the email go to Google as the sign-in's `client_id` and `login_hint`,
  and the folder id goes to Drive when the app reads the folder. During a
  sign-in, a random nonce sits in session storage until Google answers.
- **Read-only, except requests.** The app writes only refresh requests into
  `_requests/`, and deletes only requests it made (a cancel). medrec is the
  only writer of records.
- **Records stay in the browser.** Nothing from the folder is sent anywhere
  but back to Drive. Error messages carry no record content. Download CSV
  on the costs screen builds the file in the page and saves it to the
  device; nothing is uploaded.
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
- The browser tests serve the build on port 4317. `E2E_PORT=<port> npm run e2e`
  moves it when another project's preview holds that port.
- The sample folder in `public/demo/` comes from `scripts/demo-folder.mjs`.
  Run `node scripts/demo-folder.mjs` after changing it, and commit both. It
  ends by running medrec 0.9.5 or later over the folder to write its views
  (`MEDREC=<path to medrec>`, else `medrec` on the PATH), under a scratch
  home and profile with only the variables it needs and the time zone set
  to `America/New_York`, so the machine's own medrec setup is never touched and every
  machine writes the same views. CI runs medrec 0.9.5's Linux build,
  checked against its SHA-256. Only `views/views.json` and each person's
  `events.json`, `private.json` and `code-names.json` are kept: the app
  reads no other view. medrec keeps the code names from the committed files,
  so they need the published table only when the sample gains a code: set
  `ICD10CM_ZIP` to the zip `medrec tables list` names, downloaded, for that
  run.
  `manifest.json` gives each file's MD5, as Drive would, for the store's
  freshness check. No private list is written by hand: the cases the tests
  lay over the sample (`test/fixtures/private/`) are medrec's too, made by
  `node scripts/private-fixtures.mjs`. CI runs both scripts.
- The PNG icons in `public/` (for the manifest and the iPhone Home Screen) are
  drawn from `public/icon.svg` by `npm run icons`. Run it after changing the
  icon, and commit them.
- `http://localhost:5173/app/?scope-test=1&client=<client id>` runs a check of
  the two Drive permissions against a folder named `oyh-app-scope-test`. It
  exists only in the dev server and is left out of production builds.
- `node scripts/perf.mjs`, after `npm run build`, times opening the app and
  searching on an emulated phone with a large folder: the sample, grown to a
  3.9 MB `index.json` and a 4.6 MB `text.json` from invented data.
  `--network` adds a 4G-like link and `--uncompressed` asks for the files
  without gzip; the script's header lists every option.
- Tests use invented data only. Never commit a real record, account, client
  id or folder id.

### The screens

The app is built around what happened (a visit, an emergency room trip, a
lab draw, a fill) rather than around kinds of record. The redesign was
built behind `?next`. It is the app now, and an old link's `?next` is
dropped from the address.

- Each person's Health lists **What happened**, one row per visit with
  what it cost. Each row opens the visit's page: what happened, its results,
  how the price came down from what providers charged to what you owe, what
  the plan changed, who charged what, bills and payments, papers, how the
  visit was put together, and the claims under Details.
- The events are medrec's (`views/<person id>/events.json`, medrec 0.9.0
  and later). The store finds each person's file through `views/views.json`
  (`src/model/events.ts`) and uses it only when it is fresh: when the MD5s
  Drive reports for `household.json`, the person's `index.json`,
  `text.json` and `overrides.json`, those of the people linked to them, and
  the events file itself are the ones views.json recorded. Otherwise, say
  while an import's views are still reaching Drive, that person's visits
  are the app's own grouping, and Settings and the visit page say why. The
  store attaches fresh events to the index they were written from, and
  `src/next/medrecEvents.ts` makes each member one of the visit's claims,
  portal visits, records or papers, with the rule that placed it and how
  sure that is. What medrec still expects (a bill, the doctors' claims)
  comes along, and another person's paper (X2) opens under them. An event's address is medrec's id
  (`e_…`); any record or paper of it opens it too. For a folder whose
  medrec has not written events yet, the app groups the records itself in
  `src/next/grouping.ts`, by the same rules; that file goes once every
  folder has them. Every screen reads events through `src/next/load.ts`.
  What an event is called and what it cost (`src/next/event.ts`) come from
  its records either way. A visit leads with its kind and its place
  ("Office visit · Example Pediatrics"). What it was, in plain words, goes
  beneath: medrec's `what`, the portal's name for the visit, its reason, or
  the claims' services, the first that is plain and says more than the
  title. A private visit goes by the portal's own name for it before
  medrec's `what`, which can be its reason. A fill is named for its drug, from the pharmacy's
  record before a claim's word for any drug ("Prescription drug"). A
  vaccine is named for its dose, and a day of several doses for how many.
  A day whose claims are all for vaccines is a vaccine visit, with medrec's
  events or without; its claim names the vaccine, not the line for giving it.
  Billing descriptors in capitals ("FIRST APPOINTMENT TIER THREE") are never
  a headline; they show only in the visit's Details (`src/model/words.ts`).
  A portal platform's name ("athenahealth (all practices)") is never a
  place; a visit that names no other is at its sign-in's practice
  (`practiceName` in `src/model/records.ts`), and has no place when that is
  not known. A store's number is said once. People go by their first name,
  or their full name where two share one, except in Settings and on the
  doctor's sheet (`src/model/people.ts`).
- **Home** leads with **Needs you**, quiet when nothing does:
  - a bill worth a call: one that asks something other than what the
    claims say you owe, or that no claim in these records backs
    (`src/next/money.ts`; receipts carry no amount yet, so an
    overpayment can't be found);
  - bills to pay, one row per visit, overdue first, until a receipt from
    the provider is filed after the bill;
  - vaccine doses the CDC schedule places by now that the records don't
    show, and this season's flu dose;
  - a refill, from two weeks before the last fill's days' supply runs out
    to two weeks after;
  - doses coming up within 90 days, grouped into the visit that gives
    them ("2-month vaccines").

  The schedule is CDC's of July 2, 2025, which CDC restored after a court
  stayed its January 2026 changes on March 16, 2026; Home and the
  person's page name that version and date. **Where everyone stands**
  follows, a few lines a person: their age, their last visit, what is
  open to pay and what comes next. **Recently** closes it. A person's own
  Health (vaccines and refills) and Money (bills) list the same needs,
  private ones marked.
- **Money** (`#/money`, from Home's Money card) opens on the year: the
  household's share of this plan year's care, with what the providers
  charged, what the network took off and what the plans paid, from the
  claims' own lines. Bills to act on come next, then each person's
  deductible and out-of-pocket limit as their plan printed it on its newest
  claim, a month chart whose months open the calendar, the biggest costs
  by visit, and where the network took off most. Any period the costs screen offers can be chosen;
  deductibles show for a plan year only. **Where the money went**
  (`#/money/events`) lists every visit of the period by network price, by
  your share, or by what the network took off (`?sort=discount`), with the
  pharmacy's fills as one line. A visit's discount is its charges less its
  network price, and only when every one of its claims gives a charge and
  the charges are not below the price: a claim without a charge would make
  the discount look smaller. The visits and fills left out are counted
  under the list. Totals and months count
  private care without naming it. The lists on everyone's view leave private
  visits off and count them. Costs (`#/costs`), which names every claim it
  adds up, leaves private claims out of its totals too on everyone's view,
  and says so; one person's counts theirs.
- **Bills** (`#/money/bills`, from Home, Money and each visit's bills): the
  open bills that ask what their claims say you owe, due date first; those
  to check before paying; the shares the claims say you owe with no bill or
  receipt from the provider yet (a pharmacy's are paid at the counter); and
  the bills a receipt paid. **Worth a call** (`#/money/calls`) gives each
  bill that asks more than the claims, or that no claim backs, its figures
  and the words to say on the phone. It then lists the bills that ask less,
  and the lines the plan left out of a claim's totals in the last year,
  which need nothing. Everyone's view leaves private bills off and counts
  them. One person's view lists them, marked. medrec 0.9.1 and later keep
  what the household marked paid, receipts' amounts and each bill's phone
  number in `views/<person id>/bills.json`. The app does not read that file
  yet: it works the bills out itself (`src/next/money.ts`).
- **Health** (`#/health`, from Where everyone stands on Home) gives each
  person a card: what the records can know about them (doctors' records and
  claims, doctors' records only, claims and papers only, or no records
  yet), what is due, what is current and which results are worth a look. A person's page
  (`#/health?who=`) runs in a fixed order: Due, then Current (conditions,
  medicines and allergies, each with when it was last recorded and where
  from), then Worth noticing (each test whose newest result is out of range
  and from the last two years, with its trend), then Recently. Quiet comes
  last, folded: the past conditions, medicines and allergies, the tests in
  range, older results out of range and the vaccines given, counted, each
  linking to all of them. **Hand to a doctor** (`#/health/doctor?who=`) is
  a sheet in a clinician's terms: allergies, medicines, problems with their
  ICD-10 codes, vaccines, two years of labs and vital signs as tables, and
  the care team (who was seen in two years, and who prescribes the current
  medicines). It prints on its own. Private items stay off everyone's view,
  counted. The sheet leaves them off, and any doctor known only from them,
  until Include brings them back; leaving the sheet leaves them off again.
- **Names for codes.** medrec 0.9.4 and later give each person's conditions
  and claim diagnoses the published ICD-10-CM title of their code, in
  `views/<person id>/code-names.json` (`src/model/codeNames.ts`). The name
  comes first, on Health, the conditions list, a condition's own page, a
  visit, a claim and the doctor's sheet, and the source's words stay: beside
  it (recorded as “…”), or in the claim's words. They are not said twice where
  the two differ only in "unspecified". Search, sorting and grouping use the
  source's words alone. A name only private items' codes have
  (`private_codes`) is given to a private record alone. The file is used only
  when the MD5s in `views/views.json` are the folder's, the person's
  `marks.json` too, as for private items. Without one, or for a code it does
  not name, the source's words show, and nothing says so.
- **Papers** (`#/papers`, a tab, also from Recently on Home and each
  person's Health): every paper in the Drive
  folder, newest first by year, each with the visit it belongs to as a
  link. A paper is with a visit when the visit holds it, when a record of
  the visit links it (an explanation of benefits names its claim), or when
  it is the receipt for a bill the visit holds; a parent's paper in a
  newborn's visit (medrec's X2) is with that visit. A paper with none says
  why: it fits several visits, which it names (medrec's `pending`), it is a
  kind about no one visit (an explanation of benefits whose claim is in no
  visit, an insurance card, a vaccine record), it has no date, or no visit
  is near its date. All, With a visit and With none filter the list, and so
does the kind of paper (bills, lab reports and so on); each row gives its
page count. Papers took the place of each person's list of documents. A
  person's own (`#/papers?who=`) shows their private papers, marked;
  everyone's leaves them off and counts them. A paper is private when medrec
  lists it, when a private record links it, when it is with no visit and
  could be part of a private one, or when its visit is private and medrec
  did not judge the two together (the app's own grouping). A paper the
  household marked not private shows, without naming its private visit.
- **Calendar** (`#/calendar`, and Recently on Home): the household's
  events a month at a time, with a lane per person (a dot for a visit or
  tests, a ring for a pharmacy trip or vaccine, a bar across the days of an
  emergency room visit or a hospital stay) and the month's events listed
  below with one number each; or every event as one list, by month. A day
  opens its own list. The list shows twelve months at a time.
- **Private items.** medrec 0.9.1 and later list each person's private
  records, papers and events, by area, in
  `views/<person id>/private.json`, from their codes and the household's own
  marks. From 0.9.5 the list has two more rules: a paper that a private
  record links is private, whatever else links it, and an imaging study is
  as private as its report (`studies`), or judged by nothing without one
  (`unreported_studies`). The app judges both the same way where an earlier
  medrec wrote the list. The household's own mark on a paper wins; an
  earlier list shows one only on a paper in a private visit, so a paper it
  took out that a private record links stays off until medrec is 0.9.5. The
  app decides nothing else itself, but for two things no list judges:
  - a fill or a vaccine is as private as the record it is named for;
  - with the app's own grouping, a visit is private when a record or paper
    in it is.

  A private item shows on its person's own pages, marked Private, and is
  kept off every shared screen: Home, the Everyone calendar, Money, Papers,
  Health, Costs and everyone's search. Each says how many it left off,
  without naming them, but search, which would say that words matched: it
  never looks at private items, and always says so, with how many imaging
  studies it leaves off because no report judges them. The calendar gives the
  areas, and Show them brings the events back there until the calendar is
  left or the page reloaded; nothing about it is stored. While anything is
  left off, an empty list on a shared screen says that nothing is listed
  there, not that there is nothing. The doctor's sheet
  leaves private items off until they are included. A section it left
  something out of says "None listed here", never that nothing is known.

  **Without a current list, everything of that person's stays off.** The
  list is used only when the MD5s in `views/views.json` are the folder's:
  the same files as for events, and the person's `marks.json`
  (`src/model/private.ts`, `src/data/store.ts`). A list that is missing,
  behind, still arriving, unreadable or from a newer medrec, or one that
  says the household's marks could not be read (`marks_unreadable`), holds
  back all of that person's items from every shared screen, which says so in
  a line with the reason. So does a `views.json` in a layout newer than the
  app knows, which says to update the app, or one that does not read. Their
  own pages still show everything. Settings gives each person's reason. While
  someone's items are held back, the app reads the records again each time it
  comes to the front and, where the list is behind, arriving or unread, with
  the same waits as after a Refresh, so the hold ends once medrec has written.

  The app says this is discretion, not security: everyone the Drive folder
  is shared with can still read the files. Money's totals count private care
  without naming it, and the Sources screen names every sign-in, a private
  one's practice included.
- A visit's address names a record in it. Any record or paper of the visit
  opens it, so a saved address still works after records arrive and the
  visit is led by another one.
- The sample's Sam had a knee procedure: five claims from four providers, a
  line the plan left out of its totals, a bill that matches its claim and a
  surgeon's bill not yet filed. Sam also has a video counseling session that
  medrec's list makes private by its codes, with its claim, whose copay is
  not billed yet, a nicotine patch that it makes private by the medicine, and
  a loratadine refill due.

Unofficial. Not affiliated with or endorsed by Google.

## License

Copyright (C) 2026 Own Your Health contributors. Licensed under the GNU Affero
General Public License, version 3 only (AGPL-3.0-only); see LICENSE.

The Sign in with Google button images in `public/google-sign-in/` are not
covered by that license.
They are Google's pre-approved branding assets, unchanged, from its
[branding guidelines](https://developers.google.com/identity/branding-guidelines),
and Google's trademarks. The sign-in screen shows them as the button, light or
dark with the theme, so the button is Google's own design.
