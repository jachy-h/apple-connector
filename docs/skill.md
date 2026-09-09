# Skill workflow

Install the directory reported by `apple-connector skill path --json` using the host's documented Agent Skills mechanism. The Skill uses standard `name` and `description` frontmatter and does not depend on a particular host.

If the host cannot persist Skills, the Agent may read `SKILL.md` for the current session and state that limitation honestly. It must retain the `onboardingId` from `agent init`, return the user-facing URL as a Markdown link, wait for the user's reply without polling, then use `init-status` and a bounded read-only query. Updating means installing the desired CLI version, resolving `skill path` again, and refreshing the host's Skill import.
