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
  imaging studies, with search over titles and the text of documents;
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
   shared with. Google warns that it has not verified the app: your client is
   in Testing mode, which is expected. Allow both permissions.
3. Choose the records folder. The app lists the folders with a
   `household.json` that the account can see; you can also paste a folder link.

Home lists the household's people, with one line on when the records last
loaded and **Refresh everything**. A sign-in that needs a person shows at the
top until it is made. **Sources** (`#/sources`, the stack icon in the bar,
which carries a dot while a source needs attention) has every source: its
sign-in, its last load and attempt, and when the Mac loads it next.

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

Results are grouped by panel (metabolic, lipid, A1c, liver, blood count,
thyroid, vitamins and iron, urine, vital signs) by each test's LOINC code,
from a table in `src/model/panels.ts`; a test outside the table goes by the
category its source gave, or under Other tests. A panel with a critical
result comes first, then one with any result out of range, and within a
panel the out-of-range tests come first, then the order a lab report uses.
Each test's chart shades the reference range each result came with.

Every person and record has its own address, such as `#/p/<person id>` (the
person's overview; `#/p/<person id>/timeline` is the timeline) and
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
