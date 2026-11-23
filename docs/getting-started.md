# Getting started

This app shows a household's medical records on a phone or in a browser. It
does not collect them. [medrec](https://github.com/own-your-health/medrec-cli),
a command-line tool, does that on a computer at home:

- medrec files the records into a folder in the household's Google Drive;
- this app reads that folder;
- nothing goes through a server of ours, because there is none.

This guide goes from nothing to the records on a phone, in order. It is for
medrec 0.6.0 and later. The first pass takes about an hour, most of it in
steps 2 and 5.

## What you need

- **A Mac, or a Linux computer, with a terminal.** medrec runs there. Scheduled
  loads and the app's **Refresh** button need a Mac, because
  `medrec refresh --install` sets up a macOS LaunchAgent. On Linux,
  `medrec refresh` loads when you run it.
- **A Google account with room in its Drive** for the records folder: scans,
  PDFs and the records themselves.
- **A Google account that can create a Google Cloud project.** It can be the
  same account.
- **Your sign-ins** at the providers, insurers and pharmacies you want records
  from.

## 1. Install medrec and the tools it runs

medrec ships as a release for macOS (Apple silicon or Intel) and Linux. The
steps are in medrec's README,
[Install](https://github.com/own-your-health/medrec-cli#install). On a Mac
with [Homebrew](https://brew.sh), the tools it runs are:

```sh
brew install poppler tesseract
```

They read the text of PDFs and scans, on your computer. On Linux, your package
manager has `poppler-utils` and `tesseract-ocr`. medrec reaches Google Drive
itself.

## 2. Create your household's Google Cloud project

medrec and the app each sign in to Google through an OAuth client. Both
clients belong to one Google Cloud project that your household creates and
owns, so no one else's app holds access to your Drive. It is free and takes
about fifteen minutes.

1. Create the project, turn on the Google Drive API and set up the consent
   screen: [registration.md](registration.md), steps 1 to 3.
2. On **Audience**, click **Publish app**, so the project is **In
   production**. In **Testing**, Google ends every sign-in after 7 days: the
   app asks for consent again, and medrec stops loading until someone signs it
   in again.
3. Create medrec's client: **Clients**, **Create client**, application type
   **Desktop app**, then download its JSON.
   [cli-common's Drive guide](https://github.com/piekstra/cli-common/blob/main/crates/pk-cli-drive/docs/google-drive.md#registering-the-oauth-client)
   has the details.
4. Create the app's client, a **Web application**:
   [registration.md](registration.md#4-create-the-web-client), step 4. Keep
   its client id for step 6.

Both clients must be in the same project. medrec asks Google for `drive.file`,
which reaches only the files a client of its own project made, so it sees the
app's refresh requests only when the app's client is in that project.

Google keeps one grant per account for the whole project, so a revoke ends
both sign-ins on every device. `medrec drive logout --revoke` signs the app out
too, and removing the app from a Google Account's connections signs medrec out
too. **Sign out** in the app revokes nothing.

## 3. Sign medrec in and create the records folder

```sh
medrec drive login --drive-profile home-drive --client-file ~/Downloads/client_secret.json
medrec drive folder create "Medical Records" --drive-profile home-drive
# prints the folder's spec: gdrive:home-drive/<folder id>
```

`home-drive` names the Google account on this computer; choose any name. The
login opens a browser for Google's consent: sign in with the account that will
hold the records. medrec keeps the client and its tokens in its vault, sealed
with one key in the Keychain, so the downloaded JSON can be deleted.

Then the records folder's profile and its people:

```sh
medrec profiles add home                        # one profile per records folder
export MEDREC_PROFILE=home                      # or --profile home on each command
medrec init gdrive:home-drive/<folder id>       # the folder's layout
medrec people add "<Name>" --birth-date <YYYY-MM-DD> --adult
medrec people add "<Child's name>" --birth-date <YYYY-MM-DD> --guardian "<Name>"
medrec doctor                                   # checks this computer, the Drive sign-in and the folder
```

The folder now holds `household.json`, which is what the app looks for.

## 4. File the documents you already have

This is the quickest way to something useful, and it needs no provider tool.
Lab reports, visit summaries, bills and statements as PDFs or photos all work:

```sh
medrec intake ~/Downloads/lab-report.pdf        # one file
medrec intake --inbox                           # everything in the inbox medrec can see
medrec review list                              # what medrec could not place on its own
```

medrec reads each document on your computer, decides whose it is and what kind
it is, and files it. What it cannot decide waits in `medrec review list` for
you to file with `medrec review file`.

medrec does not see a file that another app put in Drive: one uploaded in the
Drive web app, or copied in through Drive for desktop. Give such files to
`medrec intake` from your computer, or point the inbox at a local directory, as
medrec's README says under
[Google Drive](https://github.com/own-your-health/medrec-cli#google-drive).

## 5. Add your providers

Each provider, insurer or pharmacy has its own small command-line tool. It
signs in as you and hands medrec your records. Install each one you need as
its README says. What each needs before its first sign-in:

| Before the first sign-in | Tools |
|---|---|
| A free developer registration with the vendor, made once. Its README walks through the vendor's form. | [mychart](https://github.com/own-your-health/mychart-cli) (any Epic MyChart organization), [athena](https://github.com/own-your-health/athena-cli) (athenahealth practices), [kp](https://github.com/own-your-health/kaiser-cli) (Kaiser Permanente claims and coverage), [modmed](https://github.com/own-your-health/modmed-cli) (ModMed practices) |
| An API key from the practice's patient portal | [icanotes](https://github.com/own-your-health/icanotes-cli) (ICANotes practices) |
| Only your sign-in to the member site | [uhc](https://github.com/own-your-health/uhc-cli) (UnitedHealthcare), [caremark](https://github.com/own-your-health/caremark-cli) (CVS Caremark), [labcorp](https://github.com/own-your-health/labcorp-cli) (Labcorp), [oneblood](https://github.com/own-your-health/oneblood-cli) (OneBlood), [fertemr](https://github.com/own-your-health/fertemr-cli) (fertility clinics on FERT), [salve](https://github.com/own-your-health/salve-cli) (the Salve fertility app), [peryourhealth](https://github.com/own-your-health/peryourhealth-cli) (PerYourHealth bills), [flywire](https://github.com/own-your-health/flywire-cli) (Flywire patient bills), [embryooptions](https://github.com/own-your-health/embryooptions-cli) (Embryo Options storage bills) |

Then, for each provider:

```sh
medrec providers list                           # the tools medrec finds
<tool> profiles add <login>                     # a name for this sign-in
<tool> auth login --profile <login>             # the tool's own flags are in its README
<tool> patients list --profile <login>          # whose records this sign-in reaches
medrec import --from <tool> --from-profile <login> --patient <who> --person "<Name>"
```

Importing again later files only what changed. Each tool's README says how
long its sign-in lasts. A member site's sign-in can end within the hour, and
nothing renews it: such a source loads only soon after someone signs in.

## 6. Open the app

1. Open https://own-your-health.github.io/app/ and paste the web client's id
   from step 2.
2. Sign in with the Google account that holds the records folder, or one it
   is shared with, and allow both permissions.
3. Choose the records folder.

For the household's other phones and computers, use **Settings**, then
**Setup link for another device**. The link carries the client id, so nobody
types it. Send it only to your household: see
[registration.md](registration.md#6-set-up-your-other-devices-with-a-link).

## 7. Keep the records current

On the Mac, set each source up for refresh, then install the schedule:

```sh
medrec people show "<Name>"                     # each source's s_… id
medrec refresh add --source <s_… id> --provider-profile <login>
medrec refresh --install                        # a pass every 5 minutes
```

The Mac then loads each source on its schedule, and when someone taps
**Refresh** in the app. When a sign-in needs a person, the app says so and
shows the one command to run on the Mac: `medrec refresh sign-in <s_… id>`.

## 8. Ask an assistant (optional)

[connector](https://github.com/own-your-health/connector) lets Claude,
ChatGPT, Gemini and other assistants that take remote MCP connectors answer
questions from the same folder, on the web and on the phone, with the Mac
asleep. You deploy it into your own Cloudflare account, on the free plan.
To stay within that plan, it reads the small views medrec 0.8.0 and later
writes beside each person's files. It signs in with a Web client in the
project from step 2, and admits only the Google accounts you list. Connect
it with the Google account medrec signs in with, which owns the folder. Its
README has the steps.

## A folder made with rclone

medrec before 0.6.0 reached Drive through rclone. medrec 0.6.0 and later
stop on an rclone remote with exit 2 and name the move: medrec's README, under
[Google Drive](https://github.com/own-your-health/medrec-cli#google-drive),
"Moving a folder off rclone", copies the records once into a folder medrec
makes.

The new folder has a new id. On each phone and computer, open **Settings**,
**Choose another folder**, and choose the new one. A device left on the old
folder keeps showing the records as they were at the move.

## Try it first

https://own-your-health.github.io/app/?demo shows invented records for an
invented household, with a simulated Mac that answers Refresh. It reads no
Drive and needs no client.
