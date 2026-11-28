# Own Your Health: records

A web page that shows a household's medical records from the household's own
Google Drive. It reads the records folder that
[medrec](https://github.com/own-your-health/medrec-cli) keeps, and shows:

- **Home**: what to do now (vaccine doses, refills, sign-ins), the bills to
  pay or worth a call, what is coming up, where everyone stands, and what
  happened recently;
- **Calendar**: the household's visits, stays, tests and fills, a month at a
  time with a lane per person, or as one list, and what is ahead;
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
- **Papers**: the folder's papers, but those about another person or entered
  in error, each with the visit it belongs to, for everyone or one person, by
  kind of paper;
- one search over everyone's records, documents and imaging, and the text
  medrec extracted from documents, from the search button in the bar;
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
   project, medrec cannot see the app's requests.
3. **For Refresh: `medrec refresh` on the household's Mac.** Run
   `medrec refresh --install` there once. Without it, the app still shows
   everything medrec has loaded, built from medrec's import history, and says
   Refresh is not set up.

## Using it

1. Open https://own-your-health.github.io/app/ and paste your client id (it
   ends in `.apps.googleusercontent.com`). On every other device, open the
   setup link instead: Settings, **Setup link for another device**, which adds
   `#/setup/<your client id>` to the address and skips this step.
2. Sign in with the Google account that holds the records folder, or one it is
   shared with. Google warns that it has not verified the app, which is
   expected for a household's own client, in Testing or published. Allow both
   permissions.
3. Choose the records folder. The app lists the folders with a
   `household.json`, in the account's own Drive and among the 40 folders shared
   with it last; you can also paste a folder link. Where the account cannot
   open the folder, the app names the account its owner has to share it with.

An account the folder is shared with as a Viewer reads all of it and asks
nothing of the Mac: it has no Refresh and no Mark paid, and Settings says why.

Home, Calendar, Money, Health and Papers are tabs: at the bottom of a
phone's screen, and a row above the page from 640px wide. The bar's menu
holds Sources and Settings. A sign-in that needs a person is a line of Home's
Do now ("Example Pediatrics needs a sign-in", "On the Mac"), which opens the
source; Home closes with when the records last loaded, which opens Sources,
and **Refresh**, which asks for everything. **Sources** (`#/sources`, in the bar's menu, which
carries a dot while a source needs attention) has every source: its
sign-in, its last load and attempt, and when the Mac loads it next. A
source's page says in one sentence what happened and gives the medrec
command to run; what the provider's own tool reported, which can name that
tool's commands, is folded under **Error details**. An earlier try in its
**Attempts** says what went wrong, and gives no medrec command. When the Mac skips a
source because it loaded or tried it too recently, the answer says when it
may load again.

For a child under 19, Home, Ahead, Health and the Immunizations list set the
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
in the unit its range names. A value sent as a bound ("<0.5", ">60"), as text
or as a quantity with a comparator, is never plotted and reads against the
range only when every value it allows sits on one side of it: ">60" against
"60 or more" is within, "<0.5" against 0–1 says nothing. A result of several
parts with nothing said of the whole is out of range where a part is.

Conditions, allergies, medicines and vaccines are listed once each, however
many dates the records hold them on, by the newest record's status in words
(active, resolved, inactive, stopped), with when each was first recorded and
every source that recorded it. A medicine joins its prescription to its
fills: who prescribed it and the last fill and pharmacy. One only reported
says so. A vaccine lists every dose, and a dose recorded as not given stands
apart. The rules are `src/model/lists.ts`, which Health uses too. With medrec
0.9.9 and later, what is current is by every source's word instead, each
prescription is its own row, and All lists every record by itself ("What is
current", below).

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
  ("Diagnosis: Ringworm (B35.4)"). The ids and amounts medrec gives a claim
  are not searched as words.

Each person's `text.json` is read from Drive once a search is coming (the
search page opens), so it downloads while the words are typed, and nothing
leaves the browser. `#/search?q=<words>` is the search page's address, with `&words=1` when the words are searched as written and
`&who=<person id>` when its person filter starts on someone. The rules are
`src/model/search.ts`.

A provider's page (`#/p/<person id>/provider/<item id>/<field>`) opens from
any name that is a link: a visit's place, each row of "Who charged what", and
the provider on a claim, a portal visit, a medicine, a vaccine, a procedure,
an imaging study, a paper or a bill worth a call. Its address holds the item
that names the provider, never the name. The page is one person's, or
everyone's (`?all=1`, and no other value), newest first:
- what its claims say it charged, what the plan paid and your share, what its
  bills leave to pay, and shares with no bill yet;
- visits, bills and payments, claims, tests, imaging, medicines, vaccines,
  procedures, papers, and the people or places named at its visits.

Names are one provider when the records give one National Provider Identifier
for them (never shown), when one source of one person's prints the same
name (one sign-in, or the papers filed by hand), or when medrec gives them one
label that is the household's or that it is sure of. Names the records give
different identifiers for are one only where the household says so, and names
it said are not one provider are apart whatever else they share. Names that are
only alike, or share a likely label, are never put together; alike ones are
listed under "May be the same". A name that only a
sign-in several practices share would give is no link. Everyone's page leaves
private items off, so a provider named only by private items has none. The
rules are `src/next/providerNames.ts` (which names are one provider) and
`src/next/provider.ts` (the page, its totals and what is private on it).

A portal visit's page lists what belongs to it: its documents, what was
recorded at it (diagnoses, results, procedures, medicines, vaccines,
allergies and reports), its insurer claim and imaging. A
document belongs to a visit when medrec linked it, or when it is dated within
the visit (its day, or a stay's days) and comes from the same organization,
by medrec's organization id or, for a document filed by hand, by name. Each
document joins one visit at most, and a linked one is never taken by another.
Every record, in the order it happened, is one tap away. The rules are
`src/model/visits.ts`.

Money's bills show what is left to pay of each, as medrec's list of them
says (Bills, below), the plan's deductible and out-of-pocket limit so far
from the newest claim that printed them, and each insurer claim beside its
bill: a statement from
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
totals leave out counts nothing, and leaves no such line. On everyone's view the
private lines of a claim that is listed are one line for each of their days,
"Not shown here". It narrows to:
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
category its source gave where that is one other than laboratory, or else under
the newest panel of its source's that lists a result of it (medrec 0.9.10 and
later), on its own page and in search too, or under Other tests. A panel that its
source lists results for, filed or not, and that has no value is a heading and
no test: it is in no list of results and stands for none in search, a visit
names it as a panel, and its own page lists its results. A panel with a critical
result comes first, then one with any result out of range, and within a
panel the out-of-range tests come first, then the order a lab report uses.
Each test's chart shades the reference range each result came with.

Every record's page leads with the plain answer. A result shows:
- its plain name, from a table of the common tests in
  `src/model/labtests.ts`, else the source's own name, else its LOINC name;
- its value, and whether it is within the lab's range, in words and as a
  marker on the range: within it in a calm green with a check, outside it in
  the attention colour with an arrow, the stretches outside the range
  hatched, so none of it rests on colour alone. A blood pressure's value is
  made from its parts, whatever its source wrote as the whole, wherever the
  app gives it: the top and bottom numbers (LOINC 8480-6 and 8462-4, or a part
  with no code whose name starts Systolic or Diastolic) read `118/74 mmHg`;
  two of one kind are joined by "and"; one kind alone says `top number only`
  or `bottom number only`; numbers in different units each keep theirs; any
  other part follows by name (`122/78 mmHg, mean 93`). A part with no value
  is left out, and with no top or bottom number left the source's own value
  shows;
- a sentence or two on what the test measures and what a high or low result
  can go with, written from the MedlinePlus page it links and stopping at
  "a question for your doctor";
- its parts, for a result of several (a blood pressure's two numbers), each
  with its own range;
- its history, with the range band, or each part's where the whole is no
  number; a part its source names twice has no line, and a line draws the
  results in one unit, that of the newest result that shares its unit with
  another (case, spaces and µ for u aside), and says which unit it is and how
  many results in another it leaves out, or that there is no chart where no
  two share one;
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
`setup/<client id>` before the route:
`https://own-your-health.github.io/app/#/setup/<client id>/hh/<id>`. A device
that has never opened the app then needs no setup: it signs in and lands on
the person. The app takes the client id out of the address before signing in.
A browser sends no server what comes after `#`, so the site never receives the
id from this link. Links made before, with `?client=<client id>` before the
`#`, still open. Where the app is already open and signed in, a link that
names its own client goes to the page and keeps the sign-in; one that names
another asks first.

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
old one, and pdf.js's copied files by its version; a page open since before a new
version says so when a paper needs a file the site no longer has). An installed app that comes back from the background keeps the
version it opened with, so when it comes to the front it asks the site for
its page, at most every 5 minutes, and says **A new version of the app is
ready** with a **Reload** button when the site has another.

### Refresh, and sign-ins that need a person

Refresh writes one small request file into the folder's `_requests/`, which
takes an account that may add to the folder. The Mac picks it up on its next
pass (every few minutes), loads the sources it names, and writes the outcome to
`_status/` and `_requests/done/`, which the app reads back. The app shows when a request is waiting, when the Mac is late, and
what it answered. Once a request is finished the app reads the records again,
so what it brought shows without a reload. A read that fails, or that leaves
out someone whose records are here, changes nothing: it is tried again after
30 seconds, then after twice as long each time, six tries in all, and the
third failure says so (`src/data/rereads.ts`). A read that finds the folder
needs a newer app (its views' `reader`, or a higher `format` in
`household.json`) is not tried again: at once nothing of the folder stays on
screen, and the app looks for its update (Limits, below).

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
- **Local storage holds five settings, nothing else:** your client id
  (`own-your-health-app.client_id`), the chosen folder's id and name
  (`own-your-health-app.folder`), the email of the Google account that last
  signed in (`own-your-health-app.account`), the theme, when you choose
  one (`own-your-health-app.theme`), and the month your plan year starts,
  when you set it (`own-your-health-app.plan_year_start`). None is a secret. The client
  id and the email go to Google as the sign-in's `client_id` and `login_hint`,
  and the folder id goes to Drive when the app reads the folder. During a
  sign-in, a random nonce sits in session storage until Google answers.
  After the app reloads for a folder that needs a newer app, session storage
  keeps the name of the build it reloaded to (`update-tried`) while the tab is
  open, so the tab does not reload for that build by itself again.
- **Read-only, except requests.** The app writes only requests into
  `_requests/` (to refresh, and to mark a bill paid or undo that), and deletes
  only requests it made (a cancel or an undo). A payment's request holds the
  person's and the bill's ids, the day and the amount. medrec is the only
  writer of records.
- **Records stay in the browser.** Nothing from the folder is sent anywhere
  but back to Drive. Error messages carry no record content. Download CSV
  on the costs screen builds the file in the page and saves it to the
  device; nothing is uploaded.
- **A paper's file is read only when someone taps View.** Its bytes come from
  the folder then, are held in memory while the paper is open, and are dropped
  when it is closed or its page left. Nothing of it goes to browser storage or
  anywhere else. Nothing in a paper runs: see [Viewing a paper](#viewing-a-paper).
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

### Viewing a paper

A document's page, and each paper on a visit's page, has **View** beside Open in
Drive. It shows the paper in the page (`src/paper/`), larger or smaller with two
fingers or the buttons. Above 10 MB the button says the size first; above 60 MB,
and for a type no browser shows (TIFF, Word), there is only Open in Drive. A
paper filed under someone else that is private is not shown on this person's
visit. What it is goes by its first bytes, as a portal's own type may be wrong.

| Paper | How it is shown |
|---|---|
| PDF | Drawn on canvases by pdf.js, in a worker, with its words over them to select. Forms are drawn as they are filled in. Its scripts, forms, links and XFA are off: the app uses none of pdf.js's layers for them. A page is drawn when it comes near, so a long one holds few. A part of a page that does not read is left out, and said. |
| PNG, JPEG, GIF, WebP | As a picture, from a blob URL that ends when it is closed. |
| HTML, C-CDA XML | As headings, text, lists and tables built from text by the app. The file is never given to the browser to parse: the app reads it (`src/paper/markup.ts`), keeps a fixed set of parts and no attribute but a cell's span, and leaves out scripts, styles, frames, objects and forms' controls. A link is its words and its address, not a link. A picture outside the file is named and never loaded. |
| RTF | Its text only, which the page says. |
| Plain text, other XML | As text. |

A sandboxed frame was the other way for HTML. It would need `frame-src` opened,
an inherited policy strips the styles a provider's page relies on anyway, and a
frame with no script can be neither sized to its content nor put in the app's
colours and type.

The page's policy has three lines for this and no more:

- `img-src blob:` for pictures.
- `worker-src blob:` for pdf.js. A worker started from an address is under that
  address's own headers, and GitHub Pages sends none, so it could connect
  anywhere. One started from a blob is under the page's policy, so it connects
  to nothing but the app's own site and Google.
- `trusted-types oyh-pdf-worker`, the one policy that may start a worker, which
  passes only the address the app just made from its own file.

`connect-src`, `script-src` and `style-src` are as before, and no WebAssembly or
eval is allowed: pdf.js reads JPEG 2000 and JBIG2 pictures with its JavaScript
readers. The privacy page keeps the policy without these lines.

pdf.js (`pdfjs-dist`, pinned to one version) is the app's one dependency. Its code
is in the app's own files, loaded with the first PDF. The build copies its two
picture readers, also loaded then, and the fonts and character maps a page may
need to `pdfjs/<version>/`. Where one of these does not load, the page says so and
is not shown without it. They come with their licences: pdf.js is Apache-2.0; the maps, the Foxit fonts, OpenJPEG and PDFium's
JBIG2 reader are BSD; the Liberation fonts are GPL-2.0 with its font exceptions
(unchanged, their sources at https://github.com/liberationfonts).

### Google permissions, and why

| Scope | What the app does with it |
|---|---|
| `drive.readonly` | Reads the records folder, which medrec wrote, so the app did not create it. |
| `drive.file` | Creates and deletes its own requests in `_requests/`: to refresh, and to mark a bill paid. |

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
- The app follows medrec's contract up to 0.9.10 (`follows` in
  `src/medrec-contract.json`, `FOLLOWS` in `src/model/views.ts`). Views whose
  `reader` in `views/views.json` (medrec 0.9.11 and later; where it is absent,
  the `medrec` that wrote them) is newer, compared part by part as numbers, or
  is no `MAJOR.MINOR.PATCH`, need a newer app. On opening, and in the sample,
  nothing of the folder is then read past `views.json`, `household.json` and
  the list of answered requests. An open folder has its status and requests
  looked at (and the app's handled requests tidied) on each poll, as before,
  ahead of the read that finds this. In every case nothing of the folder is
  shown afterwards (its sheets and toasts closed too), because the rules the
  app does not know may hold more private. A folder with a higher `format`
  takes the same path.
- Such a folder stays chosen, so the updated app opens it. The app first asks
  its site for its page, giving up after 10 seconds, and reloads to a newer
  build there: by itself once per build in the tab, and again whenever **Look
  for an update** is pressed. Else it says "These records were written by a
  newer medrec. Update the app to see them.", with that button, and **Choose
  a folder** when signed in to Drive. It adds that there is no newer app yet,
  or that the site could not be reached. Focus moves to its heading, which
  reads with the text.
- The site says which contract it follows at
  `https://own-your-health.github.io/app/medrec-contract.json`, for a script
  that needs no sign-in (medrec's install, before it writes views a newer
  contract governs): `{"schema":"own-your-health-app/medrec-contract/v1",
  "follows":"0.9.10"}`, `src/medrec-contract.json` as it is. GitHub Pages
  lets a cache keep it for up to 10 minutes.

## Development

Node 22 or newer.

```sh
npm ci
npm run dev        # http://localhost:5173/app/ (sample: /app/?demo)
npm run verify     # lint, typecheck, unit tests, build
npm run e2e        # browser tests at phone and desktop sizes: the sample, and signed in through a stand-in for Google and Drive
```

- Plain TypeScript, built by Vite. Its one dependency is pdf.js, for
  [viewing a paper](#viewing-a-paper).
- The browser tests serve the build on port 4317. `E2E_PORT=<port> npm run e2e`
  moves it when another project's preview holds that port.
- The sample folder in `public/demo/` is what medrec 0.9.10 writes of the
  invented records in `scripts/sample/`: raw FHIR that stand-ins for the
  provider CLIs serve, papers and images. `scripts/demo-folder.mjs` puts those
  where medrec reads them and sets no field medrec writes.
  `MEDREC=<path to medrec 0.9.10> node scripts/demo-folder.mjs <a new folder>`
  writes it to a folder that does not exist yet; move `public/demo` away, that
  folder into its place, and commit it with what changed. Another medrec writes
  the sample differently, so the script refuses it. medrec runs under a scratch
  home and profile with only the variables it needs, so the machine's own
  medrec setup is never touched. The time zone is `America/New_York`, the clock
  stands still at each step's moment, and medrec's ids come from the step
  (`scripts/sample/moment.c`, built with `cc`), so the same sources give the
  same bytes on every machine. CI runs 0.9.10's Linux build, checked against its
  SHA-256, and compares. Only `views/views.json` and each person's
  `events.json`, `bills.json`, `private.json`, `code-names.json`,
  `providers.json` and `standing.json` are kept. medrec keeps the code names from the committed
  files, so they need the published table only when someone gains a code or
  their id changes, and the script then says so: set `ICD10CM_ZIP` to the zip
  `medrec tables list` names, downloaded, for that run. `manifest.json` gives
  each file's MD5, as Drive would, for the store's freshness check. The READMEs
  in the folder are medrec's own, written for a real household. Everything there
  is invented, and nothing is put into it by hand, `inbox/` included.
- What the tests read besides the sample is medrec's too: the cases laid over
  it (`test/fixtures/private/`, `test/fixtures/bills/paid/` with payments
  marked, and `test/fixtures/labels/said/` with providers labelled from an
  invented directory), made by `node scripts/private-fixtures.mjs`,
  `node scripts/bill-fixtures.mjs` and `node scripts/label-fixtures.mjs` once
  the sample is in place, and the records
  that give each reading rule a case (`test/fixtures/rules/`, from
  `scripts/sample/rules.mjs`), made by `node scripts/rule-fixtures.mjs`.
  `test/fixtures/labels/medrec/` is medrec's own fixture for readers of its
  labels, as it is. Every National Provider Identifier in the sample and these
  begins with 0, which CMS never issues. The scripts
  delete nothing: medrec works in a new temporary folder, and a file no longer
  part of a case is named for a person to remove. CI runs all seven scripts.
  `test/fixtures/standing/medrec/` is medrec's own fixture for readers of
  `standing.json`, as `tests/fixtures/standing/` of its 0.9.9 has it, and
  `test/fixtures/errors/medrec/` is its fixture of what is entered in error
  (`tests/fixtures/errors/`, with the `household.json` of the other).
  `test/fixtures/parts/medrec/` is its fixture for readers of `parts` in
  `private.json`. No script here writes these, and they are copied again when
  medrec's change.
  `test/fixtures/errors/views/` is what medrec 0.9.9 writes of `errors/medrec/`, by
  `node scripts/error-fixtures.mjs` with `MEDREC` set to that release.
  `test/fixtures/results/medrec/readings.json` is medrec's own fixture of a
  result's shapes (`tests/fixtures/fhir/readings.json` of its 0.9.10), and
  `test/fixtures/results/views/` the folder medrec 0.9.10 writes of it, with a
  heading and a report as medrec's own test lists them, and invented beside
  them a visit's results and headings, a blood pressure sent as a panel of its
  two numbers, and two tests sent in two units, by
  `node scripts/result-fixtures.mjs` with `MEDREC` set to that release.
  Written by hand are only Drive's answers, the app's own requests, and files
  medrec never writes: malformed ones, and ones of a later format.
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
  comes along. Another person's paper (a child's from before their birth, in
  the parent's visit: X2) opens under them. It is judged as theirs: one that
  is private, or that nothing can say is not, is in none of the visit, on the
  pages of the visit's own person too, and its own person's Papers says which
  visit it is with. A place a visit has from another person's (the hospital
  stay a newborn was born in: X1, `place_from` is `linked`) is left out, with
  nothing in its place, where that visit is private, holds a private item of
  theirs, or nothing can say it does not; medrec 0.9.9 and later name the visits
  it can be shown from (`clear_events`). A place
  whose `place_from` is `alias` is there because a paper in the file's
  `aliases` says the clinician works at it: when any paper that says so is
  private, a shared screen leaves the place out. An event's address is medrec's id
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
  record before a claim's word for any drug ("Medication"). A
  vaccine is named for its dose, and a day of several doses for how many.
  A day whose claims are all for vaccines is a vaccine visit, with medrec's
  events or without; its claim names the vaccine, not the line for giving it.
  Billing descriptors in capitals ("NEW VISIT LEVEL FOUR") are never
  a headline; they show only in the visit's Details (`src/model/words.ts`).
  The portal's record of a visit is titled the same way, on its own page and
  wherever it is named: its name, else its reason, else "Visit". Where its
  event or a claim lists it as a row, the last is "The portal's record of the
  visit", as "Visit" would not say which. Search finds it by the source's own
  name too.
  A portal platform's name ("Example Records (all practices)") is never a
  place; a visit that names no other is at its sign-in's practice
  (`src/model/practices.ts`), and has no place when that is
  not known. Only the person's own sources name their practices. Where
  several of them share one organization, CLI and FHIR base under different
  names, which is all a record says of its source, they name none, and two
  visits of a day that came that way are one only when they name one place.
  A place medrec gives that is only another person's source's name, or one
  of several the visit's sign-in has, is dropped unless the visit or a claim
  names it. A store's number is said once. People go by their first name,
  or their full name where two share one, except in Settings and on the
  doctor's sheet (`src/model/people.ts`).
- **Home** (`src/next/homeView.ts`) leads with three cards, each with a count,
  the most urgent rows and a link to the rest, so its length does not grow
  with how much waits: two screens of a 390 px phone at most, with 50 things
  waiting too (`e2e/home.spec.ts`). A card with nothing in it is not there,
  and with none of them Home says that nothing listed needs you.
  - **Do now**: what is overdue or due today, but for bills: vaccine doses
    the CDC schedule places by now that the records don't show, this season's
    flu dose, refills whose last fill's days' supply runs out today or has run
    out, and a sign-in that needs a person. Three rows.
  - **Bills**: two rows, those past due first, then those worth a call (one
    that asks something other than what the claims say you owe, or that no
    claim in these records backs; `src/next/money.ts`), then the others by due
    date. The bills of one visit share a row, but for those worth a call. One
    past its due date says "No payment on file", with "unless it was paid
    elsewhere" beside the claim's verdict, or "Not all paid" and what is paid
    of it, and has **Mark paid**. The card's head gives how many are open and
    what they ask. One whose payment is marked, or that a receipt whose amount
    could not be read may be for, is counted in a line of its own and asked
    for no more.
  - **Coming up**: refills from two weeks before the last fill runs out, and
    the doses coming up within 90 days. Three rows.

  One person's refills of one week share a line, and so do their doses; a
  private refill shares with none that is not (`src/next/ahead.ts`). **Where
  everyone stands** follows, a line a person: their last visit, and the most
  urgent thing. Then **Recently**, two events, and one line each for the
  year's money and how fresh the records are. A person's own Health (vaccines
  and refills) and Money (bills) list the same needs, private ones marked.

  **Ahead** (`#/calendar?view=ahead`) lists every line of Do now and Coming up
  by month, for everyone or one person, with how the schedule and the refills
  are judged. The schedule is CDC's of July 2, 2025, which CDC restored after
  a court stayed its January 2026 changes on March 16, 2026; Ahead and the
  person's page name that version and date.
- **Money** (`#/money`, a tab, and Home's line for the year) opens on the year: the
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
  under the list. Totals, months and limits count private care without naming
  it: everyone's view gives no claim's day for a limit, and no row for a plan
  that only private claims name. Its lists leave private visits off. Costs
  (`#/costs`), which names every claim it adds up, leaves private claims out of
  its totals too on everyone's view, and always says so; one person's counts
  theirs.
- **Bills** (`#/money/bills`, from Home, Money and each visit's bills): the
  open bills that ask what their claims say you owe, due date first; those
  to check before paying; the shares the claims say you owe with no bill or
  receipt from the provider yet (a pharmacy's are paid at the counter); and
  the bills paid, by a receipt ("receipt Apr 20, 2025") or by a payment the
  household marked ("Marked paid, Nov 20, 2026"). **Worth a call**
  (`#/money/calls`) gives each bill that asks more than the claims, or that no
  claim backs, its figures and the words to say on the phone. It then lists
  the bills that ask less, the payments at a visit above what its claims say,
  and the lines the plan left out of a claim's totals in the last year, which
  need nothing. A bill no insurer is billed for (medrec's `self_pay`, 0.9.6 and
  later) is to pay and not worth a call, says "No claim expected", and stands
  for no share of its visit's, whoever sent it. Everyone's view leaves private bills off, and a share whose
  only bill is private is listed there as any with no bill listed. One
  person's view lists them, marked.

  What is paid, what is left, which later statement stands for a bill and
  what is worth a call come from `views/<person id>/bills.json` (medrec 0.9.1
  and later; `src/model/bills.ts`), when the MD5s in `views/views.json` are
  the folder's, the person's `marks.json` too. A settled bill is never open,
  overdue or worth a call, whatever the list's `worth_a_call` says. Payments
  in another currency are named, and not taken off. The list alone says
  whether a bill is settled. A receipt whose amount medrec could not read is
  not in it, so a bill that receipt can be for (same provider or account,
  dated in the 120 days before it) with no known payment **may be paid**: it
  says "Receipt filed Apr 20, 2025; its amount could not be read", stays open
  in a group of its own, and is never overdue, "No payment on file" or worth a
  call. Without the list, the newest statement of each provider and account is
  open until receipts whose amounts read cover it, its visit's claims say
  whether it is worth a call, and a line on Home and Money says why the list
  is not used, for each person with a bill, open or not (on a shared screen, a
  bill that is not private). A list medrec is still writing is read for again,
  as code names are.

  **Mark paid** is beside each bill with something left to pay: on Bills, on
  Worth a call, on the visit, on the bill itself, and on Home past its due
  date. It asks for the day and the amount (the day starts from a receipt whose
  amount could not be read; a day to come is refused, since a scheduled payment
  is not paid yet) and writes a request, which the Mac records on its next pass
  (medrec 0.9.1 and later; `src/next/markPaid.ts`). Until then the bill is
  marked, not settled: it is listed under Marked paid, out of Ready to pay,
  Worth a call and Home's totals when the payment covers what is left, and
  **Undo** takes the request back. A pass reads every request when it begins,
  so one taken back is looked for until no pass that read it can still be at
  work, and a payment filed after all says so. medrec answers a request before
  it writes the list that shows it, so a recorded payment is kept until that
  list does, for a quarter of an hour at most; so is one another device asked
  for that was answered after the records here were read. The folder is looked
  at once more before a request is written: when what is left to pay is no
  longer what the form was opened on, nothing is sent. Each request is created
  under an id Drive gives first, so one whose answer is lost is sent again as
  the same file, and where Drive still does not answer it is looked for; the
  same asked again is that one, and counts once. A filed payment is undone from
  the bill's page with medrec 0.9.7 and later, and before with the command that
  page gives. What the Mac could not record says so beside the bill. Which
  medrec answers requests is the status's `refresher.medrec_version`. An account
  that may only view the folder has no Mark paid, and neither has a bill whose
  payments medrec's list does not give now.
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
  `views/<person id>/code-names.json` (`src/model/codeNames.ts`). The source's
  words lead where they are plain, and the title is second, in Details: a
  condition's and a claim's Technical details, a visit's Details, and beside
  the code on the doctor's sheet. The title leads only where the source gives
  no words, a bare code, billing wording in capitals (`isDescriptor`, as
  for visits), or one word in capitals of 5 letters or fewer, an
  abbreviation, which is shown beside it: "Essential (primary) hypertension
  (HTN)". A longer word in capitals is the source's own: it leads, in
  sentence case. The source's exact words are in Details. The title is not
  given where the two differ only in case, punctuation or "unspecified". Search, sorting and
  grouping use the source's words alone. A title only private items' codes
  have (`private_codes`) is given to a private record alone. The file is used
  only when the MD5s in `views/views.json` are the folder's, the person's
  `marks.json` and `provider-state.json` too, as for private items. Without one, or for a code it does
  not name, the source's words show, and nothing says so. While a file
  `views/views.json` lists is not there yet, is stale or could not be read,
  the records are read again with the same waits as after a Refresh; one the
  app refuses (a newer layout, say) is not waited for.
- **What is current.** medrec 0.9.9 and later say what is current among a
  person's conditions, allergies and medicines by what each of their sources
  says, in `views/<person id>/standing.json` (`src/model/standing.ts`,
  `src/ui/standing.ts`). No source's word wins: a record is current while any
  of them says so. A row says what each source says, with the day it was read,
  and is marked Sources differ where they do and Not every source heard where
  one's word is not known. A condition's or an allergy's records of one code
  are one line, named by the newest. Each prescription is its own row, and
  those of one medicine are a group under its name, with its last fill.
  Medicines on hold, and those ended by their date, have groups of their own:
  the date ended a prescription no source says is stopped, and a fill after it
  is shown and changes nothing. The rest is under All, a tap away: every record
  by itself with what it is (ended, ruled out, a draft, a diagnosis from a
  visit, a medicine known by its fills alone). A list says how many were
  entered in error, which it leaves out, and names a source that sends no
  problem list. A record's page says the same of it. Health, its sheet for a
  doctor, the refills and the care team use these lists. A record that may not
  be shown is left out before the rest is worked out: its word, its fill and
  its source are not shown, and it makes no line current or differ. A refill
  whose medicine has a private record stays off shared screens, since a private
  fill can be its newest. The file is made from the records alone, so what the
  household marked or said never makes it stale; it is used, and read for
  again, as code names are. Without one the lists go by each record's own
  status, and nothing is said of sources that differ but on what is entered in
  error (below). Where medrec's views list one that is stale, still to come or
  refused, the lists, Health (everyone's too) and the sheet say why; a folder
  of an earlier medrec has none, and they say nothing.
- **About another person.** A chart can hold what is about somebody else: a
  screening a parent answers about themselves, or a result its source says is
  another's. medrec 0.9.9 and later name those items by id (`about_another` in
  `views.json`, `src/model/aboutAnother.ts`). They are left out when the index
  is read, with every link to them, so no list, total, search, sheet or page
  has one; an item whose own `key` begins with `about|` is left out too,
  whatever the list says. Their person's own results and papers say how many
  there are, and nothing else of them. No shared screen, sheet or list of
  everyone's says it. The list is applied even when the folder's files have
  changed since `views.json` was written. Results, a test's page and Papers
  then say that some may be about another person and why, as they do where
  `views.json` or its list does not read; so does the sheet for a doctor. What
  was named since the app opened the folder stays out until a list of its files
  reads, also when an earlier medrec on another computer writes the views
  again; nothing is kept once the app is closed. The first read after that of a
  folder whose views an earlier medrec wrote last names none, and nothing is
  said.
- **Entered in error.** A source can say that a record or a paper is entered in
  error. medrec 0.9.9 and later say of each item that every one of its sources
  does (`in_error` in `views.json`, `src/model/inError.ts`), and it is taken
  out of the index when that is read: it is in no list, search, visit, bill,
  total or doctor's sheet. A statement whose first paper is in error is its
  next copy's, and a study has no report of one. Results, a test's page,
  conditions, allergies and medicines (on Health and the sheet for a doctor
  too), immunizations, Papers, the claims under Costs, the calendar's list, a
  visit and search say how many they leave out ("1 entered in error, not
  shown"), on everyone's view of those that are not private (medrec's private
  list names those too). Costs also leaves out a claim of a private visit, as
  it does of those that stand, and one whose visit is not there to judge; the
  calendar counts only visits that are not private. Bills says so of bills,
  with how many have a payment the household marked, and which, since money may
  be owed back. One opened by its id says that it is entered in error, what
  each source says and when that was read, and what the household decided of
  it, which medrec keeps and does not apply (`not_applied` in `events.json` and
  `bills.json`, `applied` in `providers.json`). So does a visit that is none
  without it. One that some source
  still stands by stays, with **Sources differ** and what each says. A source
  whose word is not kept is not heard, and does not say so.
  Where `views.json` does not read, or was made from another index, what the
  index itself keeps of each source says it, by the same rule. The views of an
  earlier medrec are made of the whole index, so beside those nothing is taken
  out: as before, a record whose own status says so is treated as withdrawn,
  and none of the counts and cards above is of it.
- **Labels for providers.** medrec 0.9.7 and later say who the providers are
  that a person's items print, in `views/<person id>/providers.json`
  (`src/model/providerLabels.ts`): a name, a practice, what they are, a phone,
  how sure that is and why. The source's own words lead, and the label is
  under them (`src/next/labelView.ts`): on the page of a visit's record, a
  claim, a medicine, a vaccine, another record and a paper, at the head of a
  visit and of a provider's page, and in a few words on a visit's rows. What
  the printed words say already is not said again. A phone says where it is
  from: the directory and its date, the paper, or the household. One that is
  not sure is marked Likely and says why, and its number is no link to call.
  What the household said of a name is said too: that the label was wrong, or
  that two names are or are not one provider. A bill worth a call that gives no
  number has its organization's, unless it is only likely.
  A label is no item of its own: search, the other lists and their order do not
  use it. On a provider's page one of the household's, or a sure one, can put
  names together, with their items and totals on one page, and names the
  household said are not one provider stay apart (above). The doctor's sheet
  and the care team keep the sources' words. A label only private items have is
  on those items and their own person's pages. On a shared screen a label is
  without what a paper says of it that everyone's Papers does not list, and a
  likely one with no other reason is not there. No label holds a National
  Provider Identifier. The file is used, and read for again, as code names are,
  and nothing says so when there is none.
- **Papers** (`#/papers`, a tab, also from each
  person's Health): every paper in the Drive folder but those about another
  person or entered in error (both above), newest first by year, each with the visit it belongs to as a
  link. A paper is with a visit when the visit holds it, when a record of
  the visit links it (an explanation of benefits names its claim), or when
  it is the receipt for a bill the visit holds (or the only one it can be
  for); a child's paper in a parent's visit (medrec's X2) is with that
  visit, unless that visit is private or nothing can say it is not. A paper
  with none says
  why: it fits several visits, which it names (medrec's `pending`), it is a
  kind about no one visit (an explanation of benefits whose claim is in no
  visit, an insurance card, a vaccine record), it has no date, or no visit
  is near its date. All, With a visit and With none filter the list, and so
does the kind of paper (bills, lab reports and so on); each row gives its
page count. Papers took the place of each person's list of documents. A
  person's own (`#/papers?who=`) shows their private papers, marked;
  everyone's leaves them off, and places the others as if no private visit,
  record or bill were there. A paper is private when medrec lists it, when a
  private record links it, when it is a copy of a private statement, when it
  is with no visit and could be part of a private one, or when its visit is
  private and medrec did not judge the two together (the app's own grouping).
  A paper the household marked not private shows.
- **Calendar** (`#/calendar`, and Recently on Home): the household's
  events a month at a time, with a lane per person (a dot for a visit or
  tests, a ring for a pharmacy trip or vaccine, a bar across the days of an
  emergency room visit or a hospital stay) and the month's events listed
  below with one number each; or every event as one list, by month; or what
  is ahead. A day opens its own list. The list shows twelve months at a time.
- **Private items.** medrec 0.9.1 and later list each person's private
  records, papers and events, by area, in
  `views/<person id>/private.json`, from their codes and the household's own
  marks. From 0.9.5 the list has two more rules: a paper that a private
  record links is private, whatever else links it, and an imaging study is
  as private as its report (`studies`), or judged by nothing without one
  (`unreported_studies`). One whose report is entered in error has none in the
  app; medrec looks for another report of it, so a study in neither is not
  private. medrec 0.9.6 also judges the papers tied to a private one. The app judges the first two, and the copies of one statement,
  the same way where an earlier medrec wrote the list (`medrec` in
  `views.json`). The household's own mark on a paper wins; an earlier list
  shows one only on a paper in a private visit, so a paper it took out that a
  private record links stays off until medrec is 0.9.5, and a copy of a private
  statement until 0.9.6. The app decides nothing else itself, but for two
  things no list judges:
  - a fill or a vaccine is as private as the record it is named for;
  - with the app's own grouping, a visit is private when a record or paper
    in it is.

  A private item shows on its person's own pages, marked Private, and is
  kept off every shared screen: Home, the Everyone calendar, Money, Papers,
  Health, Costs and everyone's search. Home, Money, Papers and Costs say so in
  a line that is the same whether or not anything is private, and so is every
  other word there about an item that is private whole: a list reads as it would
  without those items in the folder, and an empty one always says that nothing
  is listed. Only Money's totals, months and limits count them. An open item
  with a private part is the exception: it says how much it leaves out, and its
  amounts count, in Costs too (below). A visit that is not private can have
  private items in it: there it is named, placed and priced by the others.
  medrec's words for it and its place show, unless a private paper says the
  place or, from medrec 0.9.9, the visit's entry in `parts` gives others or none
  (below), and a bill says nothing of a private claim
  (`withoutPrivate`, `sharedEvents`, `sharedOpen`). `e2e/private.spec.ts`
  compares each
  screen with the same folder's, its private items renamed and on other days
  of the month, or gone. Search never looks at private items and always says
  so, with how many imaging studies it leaves off because no report judges
  them. The calendar and Health say how many they left off, without naming
  them; the calendar gives the areas, and Show them brings the events back
  there until the calendar is left or the page reloaded. Nothing about it is
  stored. While anything is left off, an empty list on either says that nothing
  is listed there, not that there is nothing. The doctor's sheet
  leaves private items off until they are included. A section it left
  something out of says "None listed here", never that nothing is known.

  **An open item can have a private part.** A claim of several services, a
  bill and a visit stay open when only part of them is private, and medrec 0.9.9
  and later say which (`parts` in `private.json`, `src/model/parts.ts`): a
  claim's private lines, diagnoses and payer's notes by their place in its
  lists, and a paper's private lines by their bytes in its text. A shared screen
  leaves those out, names the item by the rest, and says how much it left out in
  medrec's words ("1 service not shown"). For a visit, `parts` gives what its
  open members alone say (kind, title, words, place and where that is from, what
  is expected) where that differs, and a shared screen goes by it. Where the app
  groups the records itself, a shared screen goes by the lines that are left for
  a visit's kind and what its claims were for, and the app counts the services
  left out. Amounts stay, on their days: in Costs a claim's private lines are
  one line for each day, "Not shown here". The app judges no line. A list that
  its places are not of shows nothing of itself. Neither does a person's text
  where the `text.json` read, by its own MD5 (`src/md5.ts`), is not the one the
  list was made from: everyone's search says so. Their own pages show all of it,
  say how much stays off shared screens, and mark each part that does "Not on
  shared screens", in the words that line begins with: a claim's line,
  diagnosis and payer's note; on an open visit, a line its plan left out, where
  its claim is private or leaves it out, and on one of claims alone also what
  it was billed for and its diagnoses, where every claim that names one leaves
  it out or is private; a line of a paper's text, where the text is the one the
  list was made from; and a line in that person's Costs and Worth a call. A
  list of before 0.9.9 has no `parts` and judged none.

  **Without a current list, everything of that person's stays off.** The
  list is used only when the MD5s in `views/views.json` are the folder's:
  the same files as for events, and the person's `marks.json` and
  `provider-state.json` (a `views.json` that names no `provider_state` was made
  from none, so one beside it is newer; `src/model/private.ts`,
  `src/data/store.ts`). A list that is missing, behind, still arriving,
  unreadable or from a newer medrec, one a medrec before 0.9.7 made beside a
  newer one's `provider-state.json`, or one that says the household's marks
  could not be read (`marks_unreadable`) or that what a provider directory gave
  is gone or does not read (`labels_unreadable`, medrec 0.9.7 and later), holds
  back all of that person's items from every shared screen, which says so in a
  line with the reason. So does a `views.json` in a layout newer than the
  app knows whose `reader` is one the app follows, which says to update the
  app, or one that does not read. Their own pages still show everything.
  Views that need a newer app open nothing at all (Limits). Settings gives each person's reason. While
  someone's items are held back, the app reads the records again each time it
  comes to the front and, where the list is behind, arriving or unread, with
  the same waits as after a Refresh, so the hold ends once medrec has written.
  When a medrec before 0.9.7 made the list and a `provider-state.json` from a
  later one sits beside it, the hold also says to update medrec on every computer
  that writes the folder if it stays.

  The app says this is discretion, not security: everyone the Drive folder
  is shared with can still read the files. Money's totals count private care
  without naming it, and the Sources screen names every sign-in, a private
  one's practice included.
- A visit's address names a record in it. Any record or paper of the visit
  opens it, so a saved address still works after records arrive and the
  visit is led by another one.
- The sample's Sam had an upper endoscopy: claims from three providers, a line
  the plan left out of its totals, and a bill that matches its claim. Sam also
  has a clinic visit that medrec's list makes private by its provider, and its
  claim by its codes, whose copay is not billed yet; a prescription it makes
  private by the medicine; and a famotidine refill due.

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
