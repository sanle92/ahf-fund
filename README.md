# Aminia Hope fundraising page — Supabase + Cloudflare

The public design and logo are retained. This version adds the foundation’s vision and mission, a public phone number, and donor acknowledgements. The administrator can edit these, manage named or anonymous acknowledgements, and choose whether to publish them. It has not been connected to your own Supabase or Cloudflare account yet.

## Updating your existing Supabase fundraising website

1. Back up your existing project files and database. Keep your current `public/supabase-config.js`; the new ZIP contains placeholders and would otherwise replace your settings.
2. In your **existing** Supabase project, open SQL Editor and run the entire **`supabase_upgrade_donors.sql`** file from this package. It uses your existing administrator permissions and preserves the current fundraising totals. Do not paste an administrator UID into the upgrade file. If it reports unexpected existing policies, triggers or columns, stop and review the project instead of deleting them.
3. Extract the new ZIP separately. Copy your existing configured `public/supabase-config.js` into the new project's `public` folder, or keep your existing Cloudflare Git build environment settings. Redeploy the new public files using the method below.
4. Sign in to `/holyghost/`, enter a public phone number under **Foundation details**, and manage acknowledgements under **Donor acknowledgements**. Verify the public page in a private browser. Do not put real donor details in the page until you have permission to display them.

For a **new** Supabase project, follow the full setup below and run `supabase_setup.sql` instead of the upgrade file. Do not run the old version of the setup SQL from a previous ZIP.

## Run the website on your computer

In a terminal, open the folder containing `package.json`, then run:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:8000/** for the website and **http://127.0.0.1:8000/holyghost/** for its dashboard. Leave the terminal open; press **Ctrl+C** to stop. If port 8000 is busy, run `PORT=8001 npm run dev` and use the links printed in the terminal. This local preview serves the `public` folder and does not deploy your site.

To sign in and save real figures, first complete the Supabase steps below and enter your public project URL and publishable/anon key in `public/supabase-config.js`. The local preview uses that file; Cloudflare build settings do not automatically configure your computer. Updates made locally after connecting to Supabase affect that same project's real public figures.

## What you need

- A Supabase project and a Cloudflare account.
- The Supabase **Project URL**, and either the **publishable** key (`sb_publishable_…`) or the older **anon** key. These are public web configuration. The newer publishable key is preferred.
- A Supabase **application user** created under the project's **Authentication > Users**, and that user's UID. This can be different from the account used to sign in to the Supabase dashboard.

Never put a Supabase secret key (`sb_secret_…`), `service_role` key, database password, or an administrator password in a website file, build setting or ZIP. Secret keys can bypass database protections. If one has already been exposed, rotate it in Supabase.

## 1. Create or identify the administrator

1. In the correct Supabase project, go to **Authentication > Users**. Create the administrator with an email and a strong password, or identify an existing application user who should manage the page. Confirm the email as appropriate.
2. Copy that user's **UID**, a UUID such as `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` in shape. Copy your real user's UID, not the example and not the email address. Do not share the password.
3. Copy the project's URL and **publishable key** from its Connect dialog or Settings > API Keys. A legacy `anon` key also works. If you use the newer key, it must start with `sb_publishable_`, not `sb_secret_`.

If this Supabase project also serves another app, its Auth settings and users are shared. Do not change project-wide signup settings without checking those other apps. RLS in the next step restricts updates to the UID you choose.

## 2. Run the SQL setup or repair

1. Open `supabase_setup.sql`. Find `REPLACE_WITH_ADMIN_USER_UUID` and replace that text with the real UID from Step 1. Keep the surrounding single quotes. This placeholder appears once in the executable SQL.
2. In the **same** Supabase project, open **SQL Editor**, create a query, paste the entire edited file and run it. It should finish successfully. The script checks that the UID belongs to an existing application user.
3. The script creates the progress, site-content and donor tables if needed, sets the administrator and applies the Row Level Security policies. **Running it again preserves existing AHF figures, acknowledgements and latest-update timestamps.** For an already working installation, the shorter `supabase_upgrade_donors.sql` is sufficient.

The SQL intentionally stops if it finds unexpected columns, extra policies or extra triggers on the AHF tables. Do not delete these to force it to run; review the existing project and back up its data first. Other application tables are not modified. If you change administrators, replace the UID in this file and rerun it; existing progress is retained.

## 3. Configure and deploy on Cloudflare Pages

Choose **one** of these methods.

### Method A — Direct upload, including from a phone

1. Extract the downloaded project ZIP. Open `public/supabase-config.js` in a text editor. Replace the URL and key placeholders with your project's public values. Keep the quotation marks:

   ```js
   export const supabaseUrl = 'https://YOUR_PROJECT.supabase.co';
   export const supabasePublishableKey = 'YOUR_PUBLISHABLE_OR_ANON_KEY';
   ```

   The examples are not real values. Do not put a password or secret key in this file.
2. In Cloudflare, open **Workers & Pages**, create a **Pages direct upload / drag-and-drop** project, and upload the `public` folder or a ZIP containing its contents. The upload root must contain `index.html`, `admin/`, `vendor/`, `supabase-config.js` and the other website files.
3. **Do not upload the complete project ZIP as your website.** It contains the `public` folder one level down, so the site and `/holyghost/` may not be found. On a phone, you can open the extracted `public` folder in Files, select its contents and compress those contents into a new ZIP for upload. Make that ZIP after editing the config.
4. Deploy and open the assigned `your-project.pages.dev` address. No custom domain is required.

### Method B — Cloudflare Pages connected to Git

1. Put the extracted project contents in a Git repository and connect it to a Cloudflare Pages project.
2. Use build command **`npm run build`** and build output directory **`dist`**. Use Node.js 22 or newer (set `NODE_VERSION` to `22` if needed).
3. In Cloudflare Pages build environment settings, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. For a legacy `anon` key instead, set `SUPABASE_ANON_KEY`. These public values are included in the built website. Redeploy after changing them. The build refuses missing or elevated keys.

`.env.example` is included as a checklist. Neither direct-upload pages nor the build automatically load `.env` files: use `public/supabase-config.js` for Method A or Cloudflare build environment settings for Method B.

## 4. Sign in and verify

1. Open `https://YOUR-PROJECT.pages.dev/holyghost/` on your phone. Sign in with the application user's email and password from Step 1.
2. Enter only verified totals and a contact that may be published. Save. Cash received, pledges and donated items are shown separately. A blank amount means “not yet reported”; `0` means a confirmed zero.
3. Open the public page in a private browser and verify the figures. Test that a different signed-in user cannot update them. Sign out on shared devices.

If the previous Firebase or D1 version was used, its figures are not migrated automatically. Record and verify them and re-enter them in this Supabase dashboard. If you already used the preceding **Supabase** version, the repaired SQL preserves its current figures.

## Managing donors, phone, vision and mission

- Under **Foundation details**, enter the vision, mission and public phone number. The starting vision and mission match the latest AHF proposal. No phone number is prefilled. Use the country code, such as `+256`, and save. Leave the phone blank to hide it.
- Under **Donor acknowledgements**, enter a name or select **Anonymous**, the amount received in USD and an optional public comment. New entries are drafts until you choose to publish them.
- Publish only after the donor agrees to the exact name or anonymity, amount and comment being shown. Check both the publication and permission boxes. When editing a published acknowledgement, confirm permission again. Drafts are restricted to the authorized administrator by the included database policies; test this with your own project before sharing.
- Use **Edit** to change or unpublish an acknowledgement and **Delete** to remove it permanently. Do not put private information in the public comment. Keep separate records of each donor's permission.
- Acknowledgements are separate from the manually entered **Money received** total. Adding, editing or deleting a donor does not automatically change that total. Update and reconcile the verified total yourself; pledges and in-kind donations remain separate. This site is not an accounting ledger.

## If the administrator page does not work

| What you see | What to check |
| --- | --- |
| `/holyghost/` is 404 | The deployed website root must contain `index.html` and `admin/`. For Direct Upload, upload the contents of `public`, not the full project ZIP. For Git, use build output `dist`. |
| A message asks for the Supabase URL or key | Complete Method A or Method B above and redeploy. The project URL and key must be from the same project where the SQL ran. |
| Sign-in fails | Create or check the application user under **Authentication > Users**. Verify its email is confirmed and use its email and password, not necessarily your Supabase dashboard credentials. |
| “This account is not authorized” | Compare the UID shown on the dashboard with the UID in your edited SQL. Rerun the complete SQL with the correct existing user's UID. The figures are retained. |
| “Database setup was not found” | Run the correct setup SQL in the right project, and check that Supabase's Data API exposes the `public` schema. |
| Foundation details or acknowledgements are unavailable | In an existing AHF project run `supabase_upgrade_donors.sql`, then reload the admin page. For a new project use the complete setup instead. |
| “Not saved” or “Save could not be confirmed” | Use **Discard edits and reload**, check the latest figures, then enter the update again. A newer edit or a connection problem may have occurred. |

If you still need help, provide the website URL and the exact error text or a screenshot. **Do not send your password, secret key or service_role key.**

## Optional Google sign-in

Email and password are the default. To enable Google, configure the Google provider in Supabase and its Google OAuth client, add the exact `https://YOUR-PROJECT.pages.dev/holyghost/` to Supabase Authentication redirect URLs, then set `googleSignInEnabled` to `true` in `public/supabase-config.js` for Direct Upload, or set `ENABLE_GOOGLE_SIGN_IN=true` for Git builds and redeploy. Google provider secrets stay in Supabase, not in `public`. Confirm that the Google identity uses the same authorized Supabase UID. See https://supabase.com/docs/guides/auth/social-login/auth-google.

## Scope and local tests

The public progress, update, contact, phone, vision, mission and published donor acknowledgements are visible to everyone. Never enter bank details or private donor information in public fields. Donor drafts are private only when the included security rules are correctly installed. This page does not collect payments, provide an accounting ledger, a dual-approval process, or app-level MFA. Keep receipts and a separate ledger. Review the statement that the foundation is not yet registered before publication and update it if its status changes.

For local checks on a computer with Node.js 22 or later: run `npm ci`, `npm run check`, and `npm test`. Tests cover SQL grants/RLS for donor drafts and publication using PGlite, previous-version upgrade, concurrent edits, the actual bundled Supabase SDK against simulated Auth/Data API endpoints, dashboard behavior and Cloudflare build configuration. **They do not verify your live Supabase project, real user accounts, Google provider or Cloudflare deployment.** Test those after setup.

Supabase JavaScript client version 2.119.0 is bundled; its license notices are in `THIRD_PARTY_NOTICES.txt`.
