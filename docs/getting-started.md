# Getting started

This app shows a household's medical records on a phone or in a browser. It
does not collect them. [medrec](https://github.com/own-your-health/medrec-cli),
a command-line tool, does that on a computer at home:

- medrec files the records into a folder in the household's Google Drive;
- this app reads that folder;
- nothing goes through a server of ours, because there is none.

This guide goes from nothing to the records on a phone, in order. The first
pass takes about an hour, most of it in steps 5 and 6.

## What you need

- **A Mac, or a Linux computer, with a terminal.** medrec runs there. Scheduled
  loads and the app's **Refresh** button need a Mac, because
  `medrec refresh --install` sets up a macOS LaunchAgent. On Linux,
  `medrec refresh` loads when you run it.
- **A Google account with room in its Drive** for the records folder: scans,
  PDFs and the records themselves.
- **Your sign-ins** at the providers, insurers and pharmacies you want records
  from.

## 1. Install medrec and the tools it runs

medrec ships as a release for macOS (Apple silicon or Intel) and Linux. The
steps are in medrec's README,
[Install](https://github.com/own-your-health/medrec-cli#install). On a Mac
with [Homebrew](https://brew.sh), the tools it runs are:

```sh
brew install rclone poppler tesseract
```

- rclone reaches Google Drive.
- poppler and tesseract read the text of PDFs and scans, on your computer.

On Linux, your package manager has `rclone`, `poppler-utils` and
`tesseract-ocr`.

## 2. Connect rclone to your Google Drive

```sh
rclone config
```

Add a new remote, name it `gdrive`, and choose **Google Drive**. When it asks
for a scope, choose full access (`drive`): medrec creates the folder and
writes in it. rclone opens a browser for Google's sign-in, then keeps and
renews its token itself.

## 3. Create the records folder and its people

```sh
medrec profiles add home                        # one profile per records folder
export MEDREC_PROFILE=home                      # or --profile home on each command
medrec init "gdrive:Medical Records"            # the folder and its layout
medrec people add "<Name>" --birth-date <YYYY-MM-DD> --adult
medrec people add "<Child's name>" --birth-date <YYYY-MM-DD> --guardian "<Name>"
medrec doctor                                   # checks this computer and the folder
```

The folder now holds `household.json`, which is what the app looks for.

## 4. File the documents you already have

This is the quickest way to something useful, and it needs no provider tool.
Lab reports, visit summaries, bills and statements as PDFs or photos all work:

```sh
medrec intake ~/Downloads/lab-report.pdf        # one file
medrec intake --inbox                           # everything dropped in the folder's inbox/
medrec review list                              # what medrec could not place on its own
```

medrec reads each document on your computer, decides whose it is and what kind
it is, and files it. What it cannot decide waits in `medrec review list` for
you to file with `medrec review file`.

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

## 6. Create your household's Google client

The app signs in to Google through an OAuth client that your household
creates and owns, so no one else's app holds access to your Drive. It takes
about ten minutes in Google Cloud and is free:
[registration.md](registration.md).

## 7. Open the app

1. Open https://own-your-health.github.io/app/ and paste the client id.
2. Sign in with the Google account that holds the records folder, or one it
   is shared with, and allow both permissions.
3. Choose the records folder.

For the household's other phones and computers, use **Settings**, then
**Setup link for another device**. The link carries the client id, so nobody
types it. Send it only to your household: see
[registration.md](registration.md#6-set-up-your-other-devices-with-a-link).

## 8. Keep the records current

On the Mac, set each source up for refresh, then install the schedule:

```sh
medrec people show "<Name>"                     # each source's s_… id
medrec refresh add --source <s_… id> --provider-profile <login>
medrec refresh --install                        # a pass every 5 minutes
```

The Mac then loads each source on its schedule, and when someone taps
**Refresh** in the app. When a sign-in needs a person, the app says so and
shows the one command to run on the Mac: `medrec refresh sign-in <s_… id>`.

## Try it first

https://own-your-health.github.io/app/?demo shows invented records for an
invented household, with a simulated Mac that answers Refresh. It reads no
Drive and needs no client.
