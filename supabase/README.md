# Supabase setup

Revember's cloud login uses Supabase email/password authentication. It keeps the
session in Electron's private app-data directory; the renderer never receives a
session token or a Supabase secret key.

1. In the Supabase dashboard, enable **Email** under Authentication → Providers.
2. Add `revember://auth/callback` to Authentication → URL Configuration →
   Redirect URLs. Hosted projects require email confirmation by default.
3. Apply `migrations/20260904000000_initial_vault_snapshots.sql` in the SQL
   Editor, or through a linked Supabase CLI project. It creates the private
   `vault_snapshots` table and its row-level security policies.
4. This app build is configured for the current Revember Supabase project. To
   point a development build at another project, override the URL and
   **publishable** key:

   ```bash
   REVEMBER_SUPABASE_URL=https://your-project.supabase.co \
   REVEMBER_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example \
   npm run dev
   ```

Never use a `service_role` or secret key in Revember. The next sync slice will
write the local topic, note, capture, planner, and review-progress data to the
authenticated user's `vault_snapshots` row.
