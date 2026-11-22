# Own Your Health: records

A web page that shows a household's medical records from the household's own
Google Drive. It reads the records folder that
[medrec](https://github.com/own-your-health/medrec-cli) keeps, and shows:

- each person's records: a timeline, results over time, medicines,
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
   ends in `.apps.googleusercontent.com`).
2. Sign in with the Google account that holds the records folder, or one it is
   shared with. Google warns that it has not verified the app: your client is
   in Testing mode, which is expected. Allow both permissions.
3. Choose the records folder. The app lists the folders with a
   `household.json` that the account can see; you can also paste a folder link.

Every person and record has its own address, such as `#/p/<person id>` and
`#/p/<person id>/r/<record id>`, so a bookmark or another app can link
straight to it. `#/hh/<id>` opens the person whose
`links.huishouden_health_person` is that id.

The sign-in lasts an hour. When it ends, the app asks Google again without a
prompt, and asks you only if Google needs you.

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

- **No server, no third parties.** The page loads only its own files. Its
  Content-Security-Policy lets it connect only to itself and Google's OAuth
  and Drive endpoints (`www.googleapis.com`, `oauth2.googleapis.com`). There
  are no analytics, fonts or CDNs, and the page refuses to run inside a frame.
- **Google sign-in by redirect.** The app uses Google's OAuth 2.0 flow for
  client-side apps: a full-page redirect to Google, which returns an access
  token. It loads no Google script and uses no client secret.
- **The token stays in memory.** It is gone when the tab closes. Signing out
  revokes it with Google.
- **Browser storage holds two settings, nothing else:** your client id
  (`own-your-health-app.client_id`) and the chosen folder's id and name
  (`own-your-health-app.folder`). During a sign-in, a random nonce sits in
  session storage until Google answers.
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
npm run e2e        # browser tests on the sample, phone and desktop sizes
```

- Plain TypeScript, built by Vite, with no runtime dependencies.
- The sample folder in `public/demo/` comes from `scripts/demo-folder.mjs`.
  Run `node scripts/demo-folder.mjs` after changing it, and commit both.
- `http://localhost:5173/app/?scope-test=1&client=<client id>` runs a check of
  the two Drive permissions against a folder named `oyh-app-scope-test`. It
  exists only in the dev server and is left out of production builds.
- Tests use invented data only. Never commit a real record, account, client
  id or folder id.

Unofficial. Not affiliated with or endorsed by Google.

## License

MIT
