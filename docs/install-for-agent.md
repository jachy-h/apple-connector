# Apple Connector Agent installation

Use this guide only on the same Apple Silicon Mac that will access the user's Calendar or Reminders. It requires macOS 14+, Node `>=24.20.0 <25 || >=26.8.1 <27`, and an Agent able to run local commands.

1. Run `uname -m`, `sw_vers -productVersion`, and `node --version`; verify Apple Silicon, macOS 14+, and a supported Node version. Stop and explain any incompatibility.
2. Run `npm ls -g --depth=0 @jachy/apple-connector`; verify it links to the current project through `npm link`. If it does not, run `npm install` in the current project. Do not install a registry package for this workflow.
3. Run `apple-connector version --json` and `apple-connector skill path --json`; import the returned directory using the host's documented Skill mechanism. Report if the import cannot persist beyond this session.
4. Run `apple-connector agent init --json`; save `onboardingId`, then tell the user: `Open the [authorization link](URL), then reply “done” here once authorization is complete.` Replace `URL` with the loopback URL and include its remaining lifetime.
5. Wait for the user to say they finished, then run `apple-connector agent init-status --id <onboardingId> --json`.
6. For `configured`, use `credentialFile` only for one bounded read: `calendar list-calendars` or `reminder list-lists`. Do not print it. For `pending`, wait; for `expired`, initialize again.

The temporary page is for the human user. Wait for their reply before opening it, polling onboarding status, or making business calls. It requests macOS permission only after a click and lets the user select containers and profile actions. It never needs a token copied into chat.
