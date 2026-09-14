## Agent skills

### Issue tracker

GitHub issues via `gh`; external PRs are a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical labels equal their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

### Committing

Commits are signed through 1Password, which needs the repo owner present to
unlock it. An unattended `git commit` blocks and then fails with
`error: 1Password: failed to fill whole buffer`. Nothing is lost when that
happens — the work is still staged — but an agent cannot get past it alone.
Stage the commit, say that it is waiting on the unlock, and let the owner
approve it rather than retrying or reaching for `--no-gpg-sign`.
