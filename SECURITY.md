# Security Policy

Revember is local-first and should not require credentials, tokens, or private learning content to be committed to the repository.

The supported release surface is currently macOS. The renderer stays sandboxed and context-isolated; filesystem and local Ollama access cross the validated Electron main-process boundary.

## Dependency Audit Status

As of 6 September 2026:

- `npm audit` reports zero known vulnerabilities in the app dependency tree, including development dependencies;
- `npm --prefix mcp-server audit` reports zero known vulnerabilities in the MCP dependency tree.

These are advisory checks, not a guarantee that the application has no vulnerabilities.

## Account and Vault Boundaries

The renderer receives account identity, never session tokens. Main-process vault IPC requires a signed-in account.
Each account has separate local settings, progress, and a starter vault. An upgrade reserves the existing vault for its previously saved account.
Signing out unloads that account's workspace and stops review notifications. Email callbacks require a pending local signup and a server-verified matching email.

Local files and session tokens rely on OS permissions; they are not encrypted by Revember. A process running as the same OS user can read them.
MCP is a separately authorized local file tool. Signing out of the desktop app does not revoke an already running MCP process.
New MCP connections record the selected vault and progress paths. Reconnect after changing the selected vault.

Cloud uploads compare the server revision with the revision last uploaded or successfully downloaded on this device.
Downloads validate paths, JSON, topics, progress, and planner data before replacing files. They preserve excluded attachments and backup folders.
A failed commit attempts to restore the previous files. The backup remains under `.revember-cloud-backups/`; abrupt process termination or power loss may require manual recovery.

Regression coverage includes account switching, signed-out IPC, token rotation, callback substitution, stale uploads, symlink traversal, malformed archives, and restore rollback.
Default Electron and package tests use mocked Supabase responses with the real client and IPC code. They do not verify hosted RLS, email delivery, or provider outage behavior.

The 6 September 2026 hosted check separately verified own-account reads, denied
cross-account reads, and denied anonymous table access in a read-only transaction.
The deployed hardening migration removes excess table privileges and public
execution of the administrative RLS event-trigger helper. The remaining hosted
advisor warning is disabled [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
which requires Supabase Pro or above. No plan upgrade was made.

Revember's MCP server uses `StdioServerTransport` only and does not expose an HTTP transport. Treat any future HTTP transport as a security-boundary change and repeat both production audits before shipping it.

## Reporting a Vulnerability

Do not post suspected vulnerabilities, personal learning data, or local file paths in a public issue. Use GitHub's private security advisory flow for this repository when it is available. If it is not available, contact the repository maintainer privately before opening a public issue.

Include a minimal reproduction, affected revision, impact, and any safe mitigation you identified. Please remove secrets and personal data from all reports.
