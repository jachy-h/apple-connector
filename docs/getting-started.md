# Getting started

The first-time path is Agent-led: check for the current project's `npm link` (or run `npm install` in that project), load its Skill, run `agent init`, complete the loopback page on this Mac, reply to the Agent, and let it perform one bounded read. The page lists visible containers by name and stable ID; select only what the profile needs.

To revoke an Agent, run `apple-connector open --section agents` and revoke its profile. To change macOS access, use System Settings → Privacy & Security → Calendar or Reminders. If the link expires, run `agent init` again. Do not paste credentials into chat, expose loopback ports, or retry an `outcome_unknown` write with a new key.
