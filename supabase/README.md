# Supabase setup

Revember's cloud login uses Supabase email/password authentication. It keeps the
session in Electron's private app-data directory; the renderer never receives a
session token or a Supabase secret key.

1. In the Supabase dashboard, enable **Email** under Authentication → Providers.
2. Add `revember://auth/callback` to Authentication → URL Configuration →
   Redirect URLs. Hosted projects require email confirmation by default.
3. Apply the SQL files under `migrations/` in timestamp order through the SQL
   Editor or a linked Supabase CLI project. They create the private
   `vault_snapshots` table, ownership policies, and least-privilege grants.
   On the existing Revember project, the initial table was created manually;
   do not replay its creation migration. The hardening migration is applied
   and recorded as `20260906183931`.
4. This app build is configured for the current Revember Supabase project. To
   point a development build at another project, override the URL and
   **publishable** key:

   ```bash
   REVEMBER_SUPABASE_URL=https://your-project.supabase.co \
   REVEMBER_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example \
   npm run dev
   ```

Never use a `service_role` or secret key in Revember. Signed-in users can use
**Settings → Cloud Vault** to upload their topics, notes, captures, sessions,
planner, and review progress to their own `vault_snapshots` row. Downloading a
cloud vault first copies the device's current vault into
`.revember-cloud-backups/`, then replaces the syncable local files. Backup
folders and large binary attachments are deliberately not uploaded.

Uploads require the server revision to match this device's last successful sync.
On a new device, download an existing cloud vault before uploading. Downloading
backs up local changes, but does not merge them; recover wanted local edits from
the backup before the next upload.

New accounts use `accounts/<user-id>/` beneath Electron's user-data directory for
their local vault, settings, and progress. Upgrades keep the existing vault for
the previously signed-in account. If no prior account can be identified, existing
files remain untouched; select the folder explicitly in Settings if needed.

Email confirmation must return to the device where signup started within 24
hours. Otherwise, confirm the email and sign in normally with the password.
Callbacks cannot replace an existing signed-in session.
