# Agent maintenance

Read [README.md](./README.md) first for consumer-facing behavior, setup,
maintenance policy, and contribution instructions. Keep that information there
rather than duplicating it here. Public design and API documentation belongs in
`docs/`.

## Repository boundary

This directory is an independent public repository. Its parent directory and
sibling `docs/` are private project material: never stage, copy, quote, or
publish their contents. Use synthetic fixtures; do not copy real vault documents
into tests, issues, or pull requests.

## Implementation and verification

- Preserve source outside enabled rules. Formatting must not change document
  meaning or resolve ambiguous targets by guessing. Unknown constructs must
  survive intact.
- Keep document parsing, workspace resolution, rule execution, and file writes
  separate. Plugins propose diagnostics and edits; the host validates and
  applies them.
- Every defect that changes document rendering needs a minimal regression
  fixture. Test idempotence, semantic preservation, rule isolation, and
  cross-platform paths where applicable.
- Run `npm run check` and inspect the complete diff before committing. Review
  packed files before changing packaging. Verify GitHub CI after pushing; fix
  failures before reporting completion.
- Do not add private source documents or credentials to diagnostic snapshots or
  logs.
- Keep dependencies and generated state inside this repository. Commit the
  lockfile, not caches.
- When updating `typescript-eslint`, recheck its TypeScript support and revisit
  the TypeScript 7 ignore in `.github/dependabot.yml` (PR #3). Remove the ignore
  once the upgrade installs and passes checks without bypassing peer
  constraints.

## Git and attribution

Use focused commits and push completed work. Work on feature branches after
bootstrap; stable releases must be changed through pull requests. Do not rewrite
shared history. Force-add this file when needed because some development
environments globally ignore `AGENTS.md`.

Commit trailers use `Assisted-by: <model> via <harness>`. For issues, pull
requests, and other published prose, end with
`🤖 Generated with <model> via <harness>`, using the actual session identity
rather than literal placeholders. Keep existing authors' voice when editing
prose.

Do not append agent attribution footers to repository documents. The README's
maintenance disclaimer covers them; keep attribution in commits and external
posts.
