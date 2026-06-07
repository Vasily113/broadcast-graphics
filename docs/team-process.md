# Team Process

This project uses a simple PR-based MVP workflow.

## Branches

- `MVP` is the integration branch.
- Nobody commits directly to `MVP`.
- Work happens in short-lived branches:
  - `feature/sergey/<task>`
  - `feature/vasily/<task>`
  - `feature/lead/<task>`
  - `fix/<owner>/<task>`
  - `foundation/lead/<task>`

## Recommended GitHub Branch Protection For `MVP`

Enable in GitHub repository settings:

- Require a pull request before merging.
- Require approvals: `1`.
- Require status checks to pass before merging.
- Required check: `Typecheck and build`.
- Require branches to be up to date before merging.
- Restrict who can push directly to `MVP` if available.
- Allow squash merging and prefer squash merge.

## Daily Async Status

Each developer posts:

```text
Branch:
Task:
Files/zones I am touching:
What changed today:
Blockers:
Could affect:
PR link:
```

## Weekly Planning

Once per week:

- choose 3-5 MVP tasks;
- assign an owner;
- list shared files that must not be edited in parallel;
- decide whether a refactor PR is needed before feature work;
- confirm the demo-critical path.

## Review Rules

- Team lead reviews every PR.
- Shared contract changes require explicit review.
- Backend/renderer/timeline/package changes require extra care.
- UI PRs should include screenshots or a short video.
- Foundation PRs must pass `docs/baseline-checklist.md`.

## Definition Of Done

- PR is scoped to one task.
- Diff does not include accidental files.
- `npm run typecheck` passes.
- `npm run build` passes.
- Manual scenario is checked.
- Contract changes are documented.
- Team lead review is complete.
