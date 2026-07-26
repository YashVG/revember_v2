# Security Policy

Revember is local-first and should not require credentials, tokens, or private learning content to be committed to the repository.

The supported release surface is currently macOS. The renderer stays sandboxed and context-isolated; filesystem and local Ollama access cross the validated Electron main-process boundary.

## Dependency Audit Status

As of 26 July 2026:

- the root production dependency audit reports no known vulnerabilities;
- the MCP production tree reports two moderate npm findings for `@modelcontextprotocol/sdk` and its transitive `@hono/node-server` dependency. Both entries track the same Windows `serve-static` path-traversal advisory.

Revember's MCP server uses `StdioServerTransport` only. It does not start an HTTP server or expose Hono static-file serving, so the affected route is not reachable in the supported configuration. The findings remain monitored rather than dismissed. Re-evaluate the SDK when an upstream patched version is compatible, and treat any future HTTP transport as a security-boundary change.

## Reporting a Vulnerability

Do not post suspected vulnerabilities, personal learning data, or local file paths in a public issue. Use GitHub's private security advisory flow for this repository when it is available. If it is not available, contact the repository maintainer privately before opening a public issue.

Include a minimal reproduction, affected revision, impact, and any safe mitigation you identified. Please remove secrets and personal data from all reports.
