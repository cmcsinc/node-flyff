# Git Workflow

## Commit Message Format
```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: To disable co-author attribution on commits, set `"includeCoAuthoredBy": false` in `~/.claude/settings.json` (Claude Code appends `Co-Authored-By` by default; ECC does not ship this setting).

## Branch-First Workflow (MANDATORY)

**Never commit directly to `master`.** Every task begins by creating a branch and ends with a PR.

1. **Before any work**, create a branch off up-to-date `master`:
   ```bash
   git checkout master && git pull
   git checkout -b <type>/<short-description>   # e.g. feat/trade-handler, docs/branch-first-pr-workflow
   ```
2. Do the work, commit in logical chunks on that branch.
3. Push with `-u` and open a PR (see below). Never merge your own PR unless the user says so.

Branch name = `<type>/<kebab-description>`, using the same `<type>` set as commit messages.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).
