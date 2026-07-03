# google.com automations

## Cloud Console Firebase OAuth client config

`console.cloud.google.com-firebase-oauth-client-config-automation.mjs` drives the Google Cloud Console UI for Firebase/Google OAuth client settings when the needed change is not practical through CLI/API.

It uses the active `mainframe` Browser UI profile by default:

```powershell
C:\Users\<user>\Downloads\mainframe\browserui-account.ps1 use user@example.com
node .\google.com\console.cloud.google.com-firebase-oauth-client-config-automation.mjs --project my-project --origin https://example.com --redirect-uri https://example.com/__/auth/handler --open-only
node .\google.com\console.cloud.google.com-firebase-oauth-client-config-automation.mjs --project my-project --origin https://example.com --redirect-uri https://example.com/__/auth/handler --action apply
```

For an existing OAuth client, pass the client id so the script can open the newer Google Auth Platform URL directly:

```powershell
node .\google.com\console.cloud.google.com-firebase-oauth-client-config-automation.mjs --project my-project --client-id 000000000000-example.apps.googleusercontent.com --origin https://example.com --redirect-uri https://example.com/api/auth/callback/google --action apply
```

After a successful `apply` or `save`, the script closes the automation browser by default. Use `--keep-open` when you want to inspect the Cloud Console page afterward.

The browser session stays in `%APPDATA%\mainframe\accounts\browserui\<email>`. Do not commit browser profile folders, cookies, snapshots with private page content, or tokens.
