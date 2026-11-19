# Apple Connector Agent installation

[中文](install-for-agent_zh.md) · English

Use this guide only on the same Apple Silicon Mac that will access the user's Calendar or Reminders. It requires macOS 14+, Node `>=24.20.0 <25 || >=26.8.1 <27`, and an Agent able to run local commands.

1. Run `uname -m`, `sw_vers -productVersion`, and `node --version`; verify Apple Silicon, macOS 14+, and a supported Node version. Stop and explain any incompatibility.
2. Run `npm ls -g --depth=0 @jachy/apple-connector`; verify it links to the current project through `npm link`. If it does not, run `npm install` in the current project. Do not install a registry package for this workflow. For a source build, create the self-signed signing identity once and run `npm run build` before linking; see [Signing](signing.md). Never use `APPLE_CONNECTOR_ALLOW_ADHOC=1` for an installation the user will keep.
3. Run `apple-connector version --json` and `apple-connector skill path --json`; import the returned directory using the host's documented Skill mechanism. Report if the import cannot persist beyond this session.
4. Tell the user: `Run apple-connector init on this Mac, complete system access and the authorization on the setup page, and paste the generated Agent prompt here.` Do not run `init` as a substitute for the human authorization step.
5. When the user pastes the prompt, load the packaged Skill and read the prompt carefully:
   - Prefer the `Authorization key` / `授权 key` and use `--auth-key <key>`. The CLI resolves the owner-only credential; never read, copy, scan or print token files in the profile directory.
   - If the prompt contains an authorization ID instead, store it in the host Agent's secret store or an owner-only mode `0600` file, then pass it via `APPLE_CONNECTOR_AUTH` or `--auth-file`. Never echo it. An older prompt may contain an explicit `Credential file` path; pass it with `--auth-file` without reading or printing it.
6. Run `apple-connector auth verify --agent '<your name>' --auth-key '<key>' --json` to complete the binding. Tell the user the setup page now shows “Agent bound”; never echo the authorization ID. Run `apple-connector auth show --auth-key '<key>' --json` when you need the authorization name, scope or expiry.
7. Verify with one bounded, read-only query: `calendar list-calendars` or `reminder list-lists` according to the grants. Empty containers still mean onboarding succeeded.

If the prompt is missing, incomplete or expired, ask the user to run `apple-connector init` again. Do not scan the state or profile directory for tokens, reuse an old link, or make business calls before authorization is verified.

The temporary page is for the human user. It requests macOS permission only after a click and lets the user select containers and actions per container. The prompt names **Apple Connector** since v0.17.0; upgrading from v0.16.x requires one new grant. See [System permissions](system-permissions.md). An authorization is immutable after creation; deleting it invalidates its ID immediately. The binding lives in the authorization record, and the page refreshes automatically.

For all guides, see the [documentation index](README.md).
