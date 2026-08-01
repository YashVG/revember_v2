# Security Policy

Revember is local-first and should not require credentials, tokens, or private learning content to be committed to the repository.

The supported release surface is currently macOS. The renderer stays sandboxed and context-isolated; filesystem and local Ollama access cross the validated Electron main-process boundary.

## Dependency Audit Status

As of 1 August 2026:

- the root production dependency audit reports no known vulnerabilities;
- the MCP production dependency audit also reports no known vulnerabilities.

Revember's MCP server uses `StdioServerTransport` only and does not expose an HTTP transport. Treat any future HTTP transport as a security-boundary change and repeat both production audits before shipping it.

## Reporting a Vulnerability

Do not post suspected vulnerabilities, personal learning data, or local file paths in a public issue. Use GitHub's private security advisory flow for this repository when it is available. If it is not available, contact the repository maintainer privately before opening a public issue.

Include a minimal reproduction, affected revision, impact, and any safe mitigation you identified. Please remove secrets and personal data from all reports.
