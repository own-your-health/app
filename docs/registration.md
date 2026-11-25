# Creating your Google client

The app signs in to Google through an OAuth client that your household creates
and owns. Nobody else's app gets access to your Drive, and you can turn the
client off at any time. It is free and takes about ten minutes.

You need a Google account that can create a Google Cloud project. It does not
have to be the account that holds the records: the client only identifies the
app, and each person still signs in with their own account.

medrec 0.6.0 and later signs in to Drive through a client of its own, a
Desktop app client in the same project. [getting-started.md](getting-started.md#2-create-your-households-google-cloud-project)
has the order, and why the two share a project.

## 1. Create a project

1. Open https://console.cloud.google.com/projectcreate.
2. Name it, for example "Own Your Health", and create it. Make sure it is the
   selected project before you go on.

## 2. Turn on the Google Drive API

1. Open https://console.cloud.google.com/apis/library/drive.googleapis.com.
2. Click **Enable**.

## 3. Set up the consent screen

Open **Google Auth Platform** (https://console.cloud.google.com/auth/overview)
and click **Get started** if it asks.

1. **App information:** app name "Own Your Health" (or your own), and a
   support email.
2. **Audience:** **External**.
3. **Contact information:** your email.
4. Finish, then open **Audience** again. Its publishing status decides who
   can sign in. A household app needs no Google verification in either.
   - **Testing**, the default: only the accounts under **Test users** can sign
     in, up to 100. Add the Google account of everyone who will sign in: the
     account that holds the records folder, and anyone it is shared with.
     Google ends each person's grant after 7 days, and the app then asks for
     consent again. medrec's sign-in ends the same way, and its scheduled
     loads stop until someone signs it in again, so a household that loads
     from a computer publishes the app.
   - **In production**, after **Publish app**: grants no longer end after 7
     days, and the test users list no longer limits who signs in. Any Google
     account can sign in, after Google's warning that it has not verified the
     app. That account reaches only its own Drive and what is shared with it,
     so it sees none of your records. Google limits an unverified app to 100
     users, and every account that signs in counts toward it. Google asks, on
     **Branding**, for a home page and a privacy policy on an authorized
     domain: the app's are `https://own-your-health.github.io/app/` and
     `https://own-your-health.github.io/app/privacy.html`.

   Either way, give the setup link (step 6) only to your household.
5. Open **Data access**, click **Add or remove scopes**, and add these two:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`

   Save. See [Scopes](#scopes) for why these two.

## 4. Create the web client

1. Open **Clients** and click **Create client**.
2. **Application type:** **Web application**. Name it, for example
   "Own Your Health web".
3. **Authorized JavaScript origins:** `https://own-your-health.github.io`
4. **Authorized redirect URIs:** `https://own-your-health.github.io/app/`
   (with the trailing slash).
5. To run the app from a local checkout as well, add the origin
   `http://localhost:5173` and the redirect URI `http://localhost:5173/app/`.
6. If you host your own copy, use its origin and its `/app/` address instead.
7. Click **Create**.

Copy the **Client ID**. It looks like
`123456789012-abc123def456.apps.googleusercontent.com`.

Do not copy or download the client secret. A browser app cannot keep a secret,
and this one never uses it.

## 5. Sign in

1. Open https://own-your-health.github.io/app/ and paste the client id. The app
   keeps it in this browser only.
2. Click **Sign in with Google** and choose the account that holds the
   records folder (a test user's, while the client is in Testing).
3. Google says it **hasn't verified this app**. That is expected for a
   household's own client that asks for a Drive permission, in Testing or
   published. Click **Continue**.
4. Allow both permissions.
5. Choose the records folder. If it is someone else's, they share it with this
   account in Google Drive first: as **Viewer** to read the records, or as
   **Editor** to refresh and mark bills paid as well.

Each browser and phone you use needs the client id once. The browser keeps
the client id, the folder, the email of the account that signed in, a theme
if you choose one, and the month your plan year starts if you set it. None is
a secret. The app gives the email to Google as a
`login_hint` on the next sign-in, so a browser signed in to several Google
accounts goes straight in, with no account chooser, and the hourly renewal
happens without you. **Use a different account** on the sign-in screen forgets
it; signing out and changing the client do too.

## 6. Set up your other devices with a link

Once one device is signed in, open **Settings**, then **Setup link for
another device**. **Copy** (or **Share**, on a phone) gives the app's address
with your client id in it:

```
https://own-your-health.github.io/app/#/setup/123456789012-abc….apps.googleusercontent.com
```

Opening it on another phone or computer stores the client id, takes it out of
the address, and goes straight to Google's sign-in, so nobody types the id. A
browser sends no server what comes after `#`. A link made before, with
`?client=` and the id before the `#`, still opens.
If that browser already uses a different client, the app asks before replacing
it. A link whose id is not a Google client id opens the paste field instead.
The paste field also takes the whole link: that is how an app added to an
iPhone's Home Screen, which has no address bar, gets the client.

Send the link to the people in your household, and only to them. A client id
is not a secret: Google shows it to everyone who signs in. While the client is
in Testing, only the test users listed on its consent screen (step 3) can sign
in through it. A published client lets any Google account sign in: that
account reaches only its own Drive, but it counts toward Google's limit of 100
users for an unverified app.

Open a setup link only when someone in your household sent it. A link can name
any Google client, and on a device that has none yet the app goes straight to
Google's sign-in for it. Google's screen shows the client's developer email (the
support email from step 3): if it is not your household's, stop there.

## Scopes

The app asks for two Drive scopes, and no others:

| Scope | Why |
|---|---|
| `drive.readonly` | To read the records folder and everything in it. medrec wrote those files, so the app did not create them. |
| `drive.file` | To create its own requests in `_requests/` (to refresh, and to mark a bill paid), and to delete them when you cancel or undo. |

These were settled by testing, with a client in Testing mode against an
invented records folder that rclone created, as medrec did before 0.6.0:

| Signed in with | Read the folder | Create a file in `_requests/` | Delete that file |
|---|---|---|---|
| `drive.readonly` and `drive.file` | yes | yes | yes |
| `drive.file` only | no (404 notFound) | yes, given the folder's id | yes |

`drive.file` can add a file to a folder the app did not create, but it cannot
read that folder or its records, so it needs `drive.readonly` beside it. Full
`drive` is never needed.

medrec 0.6.0 and later makes the folder with its own client. When that client
is in the app's project, `drive.file` reaches the folder from either client:
[cli-common's test](https://github.com/piekstra/cli-common/blob/main/crates/pk-cli-drive/docs/google-drive.md#scope-drivefile-or-full-drive)
read a Desktop client's folder and files from the project's Web client. The
app still asks for `drive.readonly`, which reads a folder whichever client
made it. Google's sign-in script and its file Picker were not
used: the page loads no third-party script.

You can repeat the test with your own client from a local checkout: run
`npm run dev`, create a folder named `oyh-app-scope-test` in your Drive with an
empty `_requests` folder inside it, and open
`http://localhost:5173/app/?scope-test=1&client=<your client id>`.

## Turning it off

- To remove one account's access, open https://myaccount.google.com/connections
  as that account and remove "Own Your Health". Google keeps one grant for the
  whole project, so this signs medrec out of that account as well.
- To turn the app off for everyone, delete its web client in Google Cloud.

## When something goes wrong

| Google says | What it means |
|---|---|
| `redirect_uri_mismatch` | The redirect URI is not on the client exactly as the app sends it, trailing slash included. |
| `access_denied`, or "has not completed the Google verification process" | The client is in Testing and the account is not one of its test users. Add it under **Audience**. |
| `invalid_client` | The client id was mistyped, or the client was deleted. |
| "This browser or app may not be secure" | Google refuses sign-in in automated browsers. Use an ordinary browser. |
