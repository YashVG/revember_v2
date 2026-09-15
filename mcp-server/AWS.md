# Hosted Revember MCP

Revember's MCP server runs on AWS Lambda behind an HTTPS API Gateway endpoint:

```text
https://18qlbsjghb.execute-api.eu-north-1.amazonaws.com/mcp
```

The service uses your signed-in Revember account and its private Supabase cloud
snapshot. It does not read files directly from your Mac. The existing local MCP
connection remains available and does not need AWS.

## Connect step by step

1. Use an account-enabled Revember build. The older v0.2.0 DMG predates cloud
   accounts; build the current source with `npm run install:app` if your app has
   no sign-in or **Cloud Vault** settings.
2. Open Revember and sign in. Leave it open while using hosted MCP so it can
   refresh your account session.
3. Open **Settings → Cloud Vault** and choose **Upload**. If the app reports a
   newer cloud copy, download and review that copy first; do not overwrite it.
4. In this repository, prepare the small connection helper:

   ```bash
   npm --prefix mcp-server ci
   npm --prefix mcp-server run build
   ```

5. Add a separate MCP server named `revember-cloud` to your desktop AI client's
   configuration. Use the absolute path to `node` from `command -v node` and
   replace `/absolute/path/to/revember_v2` below with your checkout's path:

   ```json
   {
     "mcpServers": {
       "revember-cloud": {
         "command": "/absolute/path/to/node",
         "args": ["/absolute/path/to/revember_v2/mcp-server/dist/remote.js"],
         "env": {
           "REVEMBER_MCP_URL": "https://18qlbsjghb.execute-api.eu-north-1.amazonaws.com/mcp"
         }
       }
     }
   }
   ```

   This is Claude Desktop's JSON format. For a client that exposes individual
   fields, use the same command, argument, and environment variable. Merge the
   entry into existing settings instead of replacing other servers. Use the
   direct `node` command, not `npm run remote`, because npm prints non-protocol
   text to stdout. Node.js 22 or 24 is recommended.

6. Restart the AI client. Ask it to list the tools on `revember-cloud` and read
   your learner brief. The server exposes the same 13 tools as local MCP.
7. After the AI changes your cloud vault, select **Download** in Revember to
   bring those changes onto your Mac. After local edits, select **Upload**
   before asking hosted MCP to use them. Avoid editing both copies at once.

The built-in **Connect Codex / Connect Claude** buttons still configure **local**
MCP. Do not enable local and cloud writers for the same work without deliberately
syncing between them. This hosting change does not publish a new DMG or switch
your existing client configuration.

The helper reads the app-owned session at
`~/Library/Application Support/Revember/supabase-session.json`; it sends only the
access token, never the refresh token. `REVEMBER_SESSION_PATH` can override the
path for development. Never copy session tokens into client settings or chat.
Only point the helper at an MCP deployment you trust: it receives your account
access token to operate on your cloud vault.

## What this connection supports

- Streamable HTTP with buffered JSON responses, through the supplied stdio
  helper. No persistent SSE subscription is required.
- Per-account access enforced by Supabase row-level security. No Supabase
  service-role key is used or deployed.
- Short-lived encrypted MCP credentials, bound to this endpoint and limited to
  15 minutes or the account token's remaining lifetime, whichever is shorter.
- Revision-checked writes. A concurrent cloud change returns a conflict instead
  of silently replacing someone else's work.

This is **not an OAuth-discovery server**. Pasting the URL into a generic hosted
MCP connector that requires browser OAuth login is not supported. The supplied
desktop helper performs the account-to-MCP token exchange at `/connect`.

## Cloud snapshot limits

Snapshots include supported JSON/Markdown files from `topics`, `notes`,
`captures`, `capture-enrichments`, `capture-segmentations`, and `sessions`, plus
progress and planner data. They exclude binary attachments and local backups.
The maximum snapshot size is 7.5 MB; MCP requests are limited to 1 MB, and large
responses are rejected before exceeding Lambda's response limit.

Each request restores one account's snapshot into a separate temporary folder,
runs the normal MCP tools, and removes that folder afterward. Successful write
tools save the snapshot only if its cloud revision still matches. Progress and
planner data are preserved, not rewritten by MCP. Local tool backup files are
not uploaded; keep your normal desktop backups.

If a request times out, read the cloud state before retrying a write: a timeout
does not prove the write failed. Sync is manual, not continuous.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Connection expired / sign in again | Open Revember, sign in, then reconnect the AI client. |
| Upload your vault first | Upload once in Settings → Cloud Vault for this account. |
| Cloud revision conflict | Read the latest cloud state, then retry deliberately. Download it in the app before uploading again. |
| Cloud snapshot differs from local notes | Use the Upload/Download workflow above. |
| HTTP 429 | The shared endpoint is rate-limited; wait briefly before a read retry. |
| Health works but sign-in fails | Check the Supabase project status; a paused project must be restored. |

The [health endpoint](https://18qlbsjghb.execute-api.eu-north-1.amazonaws.com/health)
checks AWS liveness only, not account login or database availability.

## Deployment and operation (maintainers)

Infrastructure is defined in [`aws/template.yaml`](aws/template.yaml) and the
private artifact bucket in [`aws/artifacts.yaml`](aws/artifacts.yaml). The
current stacks are `revember-mcp` and `revember-mcp-artifacts` in `eu-north-1`.
The Lambda uses Node.js 24, Arm64, 512 MB RAM, and a 28-second timeout. Its IAM
role can only write its own CloudWatch logs. No VPC, NAT gateway, load balancer,
or always-running container is needed.

To deploy an update from the repository root:

1. Sign in to the intended AWS account with a deployment role, verify
   `aws sts get-caller-identity`, then run:

   ```bash
   npm --prefix mcp-server ci
   npm --prefix mcp-server run check
   npm --prefix mcp-server audit --omit=dev
   node mcp-server/aws/package.mjs
   ```

   The packager prints a ZIP path under `.aws-build/`. It includes compiled MCP
   code, production dependencies, and shared topic-authoring code, not your
   vault, app session, Electron app, or project test suite.
2. Upload that ZIP to the artifact bucket using a **new key for every build**.
   Keep old keys available for rollback. The existing bucket is
   `revember-mcp-artifacts-artifacts-fw8bvd0tgouw`.

   ```bash
   aws s3 cp /absolute/path/to/revember-mcp.zip \
     s3://YOUR_ARTIFACT_BUCKET/mcp/UNIQUE_BUILD_ID.zip --sse AES256
   ```

3. Validate and prepare the update. Use the Supabase URL and **publishable** key
   for the same project configured in the desktop app, never its service-role
   key. Existing parameters can be retained on this deployed stack:

   ```bash
   aws cloudformation validate-template \
     --template-body file://mcp-server/aws/template.yaml --region eu-north-1
   aws cloudformation create-change-set \
     --stack-name revember-mcp --change-set-name YOUR_UPDATE_NAME \
     --change-set-type UPDATE --region eu-north-1 --capabilities CAPABILITY_IAM \
     --template-body file://mcp-server/aws/template.yaml \
     --parameters \
       ParameterKey=ArtifactBucket,UsePreviousValue=true \
       ParameterKey=ArtifactKey,ParameterValue=mcp/UNIQUE_BUILD_ID.zip \
       ParameterKey=SupabaseUrl,UsePreviousValue=true \
       ParameterKey=SupabasePublishableKey,UsePreviousValue=true
   ```

   For a new account, create the artifact stack first, then use a `CREATE`
   change set with explicit values for all four parameters. Its output URL will
   differ from the one documented above.
4. Inspect `describe-change-set` and `describe-events`, including IAM/resource
   replacements, before executing. Run `cfn-lint` and your organization's
   `cfn-guard` policies when available. The initial deployment used AWS template
   validation and change-set checks; those local tools were unavailable.

   ```bash
   aws cloudformation describe-change-set --stack-name revember-mcp \
     --change-set-name YOUR_UPDATE_NAME --region eu-north-1
   aws cloudformation describe-events --stack-name revember-mcp \
     --change-set-name YOUR_UPDATE_NAME --region eu-north-1
   aws cloudformation execute-change-set --stack-name revember-mcp \
     --change-set-name YOUR_UPDATE_NAME --region eu-north-1
   ```

5. Confirm the stack completes, check `/health`, verify an unauthenticated
   `/mcp` request is rejected, then run the connection guide with a test account.
   Test cloud writes on a disposable test vault, not a learner's real data.

   A signed-in, synced desktop account can run the **read-only** live check:

   ```bash
   REVEMBER_MCP_URL=https://18qlbsjghb.execute-api.eu-north-1.amazonaws.com/mcp \
     npm --prefix mcp-server run test:remote
   ```

   This launches the same helper as an AI client, lists tools/resources, and
   reads the learner brief without printing notes, tokens, or account identity.
   It is separate from offline `check`, which uses isolated fixture vaults.

API Gateway is throttled to 2 requests/second with a burst of 5 across this
deployment. This is a small shared deployment, not a high-traffic service or a
hard spending cap. Logs retain status/timing for seven days; request bodies,
authorization headers, and vault contents must not be logged. The Lambda error
alarm has no notification subscription and does not count application errors
returned as HTTP responses; monitor API error rates as well.

Costs are usage-based for Lambda, API Gateway, logs, and artifact storage, plus
one Secrets Manager secret (currently about US$0.40/month before API calls,
taxes, or credits). See [Lambda pricing](https://aws.amazon.com/lambda/pricing/),
[API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), and
[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/).
Supabase billing and free-project pausing are separate; a free project can be
paused again. No Supabase plan upgrade or AWS budget alert is included.

Deleting the `revember-mcp` stack stops the endpoint but **retains the encryption
secret**. Deleting the artifact stack **retains its versioned S3 bucket**. Those
retained resources can continue to incur charges until deliberately removed.
The Supabase project and its vault data are not deleted by either AWS stack.
When rotating the encryption secret, also update/redeploy the Lambda environment;
rotation is not automatic and invalidates outstanding MCP credentials.
