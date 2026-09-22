# llamarc42.con working agreements

## Pull requests and merges

- Wait for GitHub Copilot to complete a review of the PR's current head commit
  before merging. A review request, running workflow, summary comment, or review
  of an older commit is insufficient.
- Read the review and its findings. Address actionable findings or record a
  reasoned disposition; do not resolve comments solely to clear a gate.
- After new commits, require fresh CI results and a Copilot review covering the
  new head. Do not bypass required checks or review requirements.
- Review completion is separate from merge authorization. Merge only when the
  user has authorized it and required validation has passed.

## Tool portability

- New supported tool contracts must have the same public inputs, outputs, error
  meanings, and permission behavior on Windows, macOS, and Linux.
- Keep platform-specific implementation details behind handlers. Do not silently
  omit a tool, weaken validation, or substitute a different operation on one OS.
- OS-specific support exceptions require an explicit product decision. The
  current direction is no exceptions for newly supported tools.

## Implementation scope

The user accepted the tool contract and PR validation designs in `docs/design/`.
Implement them incrementally with reviewable PRs. Do not describe proposed gates
as enforced or tools as integrated until their acceptance checks demonstrate it.
