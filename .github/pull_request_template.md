## Summary

Describe the user-visible change and the learning or data-contract problem it addresses.

## Validation

- [ ] `npm run check`
- [ ] `npm run test:e2e`
- [ ] `npm run test:package` (when packaging, Vault setup, or MCP runtime changed)
- [ ] `npm --prefix mcp-server run check` (when MCP behavior changed)
- [ ] `git diff --check`

## Data and Privacy

- [ ] No generated backups, personal sessions, secrets, or private learning material are included.
- [ ] Stable authored IDs and revisions are preserved or intentionally migrated.
