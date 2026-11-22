# Creating your Google client

The app signs in to Google through an OAuth client that your household creates
and owns. Nobody else's app gets access to your Drive, and you can turn the
client off at any time. It is free and takes about ten minutes.

You need a Google account that can create a Google Cloud project. It does not
have to be the account that holds the records: the client only identifies the
app, and each person still signs in with their own account.

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
4. Finish, then open **Audience** again:
   - Leave the publishing status at **Testing**. A household app does not need
     Google's verification, and Testing mode keeps the app to the people you
     list.
   - Under **Test users**, add the Google account of everyone who will sign in:
     the account that holds the records folder, and anyone it is shared with.
     Only these accounts can sign in.
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
2. Click **Sign in with Google** and choose a test user's account.
3. Google says it **hasn't verified this app**. That is expected for a client
   in Testing mode with a Drive permission. Click **Continue**.
4. Allow both permissions.
5. Choose the records folder.

Each browser and phone you use needs the client id once.

## 6. Set up your other devices with a link

Once one device is signed in, open **Settings**, then **Setup link for
another device**. **Copy** (or **Share**, on a phone) gives the app's address
with your client id in it:

```
https://own-your-health.github.io/app/?client=123456789012-abc….apps.googleusercontent.com
```

Opening it on another phone or computer stores the client id, takes it out of
the address, and goes straight to Google's sign-in, so nobody types the id.
If that browser already uses a different client, the app asks before replacing
it. A link whose id is not a Google client id opens the paste field instead.

It is fine to send the link to the people in your household. A client id is not
a secret: Google shows it to everyone who signs in. Only the test users listed
on your consent screen (step 3) can sign in through it.

Open a setup link only when someone in your household sent it. A link can name
any Google client, and on a device that has none yet the app goes straight to
Google's sign-in for it. Google's screen shows the client's developer email (the
support email from step 3): if it is not your household's, stop there.

## Scopes

The app asks for two Drive scopes, and no others:

| Scope | Why |
|---|---|
| `drive.readonly` | To read the records folder and everything in it. medrec wrote those files, so the app did not create them. |
| `drive.file` | To create its own refresh requests in `_requests/`, and to delete them when you cancel. |

These were settled by testing, with a client in Testing mode against an
invented records folder that rclone created, as medrec does:

| Signed in with | Read the folder | Create a file in `_requests/` | Delete that file |
|---|---|---|---|
| `drive.readonly` and `drive.file` | yes | yes | yes |
| `drive.file` only | no (404 notFound) | yes, given the folder's id | yes |

`drive.file` can add a file to a folder the app did not create, but it cannot
read that folder or its records, so it needs `drive.readonly` beside it. Full
`drive` is never needed. Google's sign-in script and its file Picker were not
used: the page loads no third-party script.

You can repeat the test with your own client from a local checkout: run
`npm run dev`, create a folder named `oyh-app-scope-test` in your Drive with an
empty `_requests` folder inside it, and open
`http://localhost:5173/app/?scope-test=1&client=<your client id>`.

## Turning it off

- To remove one account's access, open https://myaccount.google.com/connections
  as that account and remove "Own Your Health".
- To turn the app off for everyone, delete the client in Google Cloud.

## When something goes wrong

| Google says | What it means |
|---|---|
| `redirect_uri_mismatch` | The redirect URI is not on the client exactly as the app sends it, trailing slash included. |
| `access_denied`, or "has not completed the Google verification process" | The account is not a test user of the client. Add it under **Audience**. |
| `invalid_client` | The client id was mistyped, or the client was deleted. |
| "This browser or app may not be secure" | Google refuses sign-in in automated browsers. Use an ordinary browser. |
