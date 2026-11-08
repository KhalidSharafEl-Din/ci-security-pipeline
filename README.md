# ci-security-pipeline

A reusable GitHub Actions workflow that runs three security scanners on every pull request and ends in one pass or fail check:

- **SAST** with [Semgrep](https://semgrep.dev) finds risky code, such as user input reaching a shell command.
- **SCA** with [OSV-Scanner](https://google.github.io/osv-scanner/) finds dependencies with known vulnerabilities.
- **Secret scanning** with [Gitleaks](https://github.com/gitleaks/gitleaks) finds credentials committed to git, including ones deleted in a later commit.

On full scans (pushes, scheduled runs and manual runs), each scanner also uploads its results to GitHub code scanning. A final `gate` job fails the pull request when the change adds a high or critical finding, so you only need to make one check required. Findings that were already on the target branch don't block the pull request.

I built this to show how I set up pipeline security: pinned and verified tools, least-privilege tokens, a gate that fails closed, and a required reason on every `nosemgrep` comment, `.gitleaksignore` block and `osv-scanner.toml` entry.

## See it work

[Pull request #1](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/pull/1) adds lodash to the demo app and calls `_.template`. Each commit has a real run:

| Commit | lodash | Gate | Why |
| --- | --- | --- | --- |
| [9d93bc0](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42478643163) | 4.17.20 | fail | CVE-2021-23337 (CVSS 7.2) and CVE-2026-4800 (CVSS 8.1) in `_.template` |
| [1aa03af](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42479203940) | 4.17.21 | fail | CVE-2026-4800 is still open in 4.17.21 |
| [8093b98](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42479443404) | 4.18.1 | pass | No advisories left |

Open a run and scroll to the job summaries to see the table each scanner writes. [Is that CVE reachable? Triaging a lodash finding](docs/lodash-reachability.md) explains how I triaged it and why 4.17.21 wasn't enough.

[Pull request #2](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/pull/2) plants a finding for the other checks and stays closed: a command injection and `shell=True` for Semgrep, a randomly generated fake API key for Gitleaks, and a `nosemgrep` comment with no reason. The gate blocked all of them.

## Quick start

Add this workflow to the repository you want to scan, for example as `.github/workflows/security.yml`:

```yaml
name: security

on:
  pull_request:
  merge_group: # only needed if you use a merge queue
  workflow_dispatch: # run a full scan by hand
  push:
    branches: [main]
  schedule:
    - cron: "17 4 * * 1" # weekly, to catch advisories published after a merge

permissions: {}

jobs:
  security:
    uses: KhalidSharafEl-Din/ci-security-pipeline/.github/workflows/security.yml@de0ad3980b079dc66cd341664b0e0186d1f9a7f4 # v1.0.0
    permissions:
      contents: read # check out the code
      security-events: write # upload SARIF to code scanning
      actions: read # code scanning reads the run metadata on private repos
```

The SHA above is the [v1.0.0 release](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/releases/tag/v1.0.0). Use the SHA of the latest release. Pin to the SHA, not the tag, because a tag can be moved to different code. Dependabot's `github-actions` updates understand this format and keep the SHA and the comment current.

Then make the `security / gate` check required, under Settings, Rules, Rulesets, "Require status checks to pass". The scanner jobs don't fail on findings, so the gate is the only check you need to require.

On a private repository without GitHub Code Security, code scanning won't accept uploads. Add `with: { upload-sarif: false }`, and keep the permissions block as it is: GitHub refuses to start the run if the caller grants less than the jobs declare. The gate works the same, pull requests still get annotations on the diff, and each run keeps the reports as artifacts for 14 days.

The jobs run on GitHub-hosted `ubuntu-24.04` runners, and the runner can't be changed.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `severity-threshold` | `high` | Lowest severity that fails the gate: `high` or `critical`. Secrets always fail it. |
| `semgrep-config` | `p/default` | Space-separated Semgrep configs: registry rulesets, URLs or paths in your repo. |
| `semgrep-extra-rules-repo` | empty | An `owner/repo` with extra Semgrep rules, such as a team rule pack. |
| `semgrep-extra-rules-ref` | empty | Commit SHA of the extra rules repo. Required when the repo is set. A tag works but triggers a warning. |
| `semgrep-extra-rules-path` | `.` | Folder of rules inside the extra rules repo. |
| `sca-paths` | `.` | Space-separated paths that OSV-Scanner searches for lockfiles. |
| `upload-sarif` | `true` | Upload full-scan results to code scanning. |
| `name` | empty | Suffix for artifact names and code scanning categories. Set a different one for each call when you call the workflow more than once in a run, for example once per service. |

The workflow has one output, `blocking-findings`, with the number of findings that failed the gate. A job that reads it after a failed gate needs `if: always()`.

To add a team rule pack kept in its own repository, pass it next to the default rules:

```yaml
    with:
      semgrep-extra-rules-repo: your-org/semgrep-rules
      semgrep-extra-rules-ref: <commit-sha>
      semgrep-extra-rules-path: rules
```

The checkout uses the caller's `GITHUB_TOKEN`, which can't read other private repositories, so the rules repo must be public. For private rules, keep them in a folder of the scanned repo and add that path to `semgrep-config`.

## How the gate decides

The scope depends on the event:

| Event | Scope |
| --- | --- |
| `pull_request` | Only what the change adds. The checkout is GitHub's merge commit, and its first parent is the target branch, so that parent is the baseline. |
| `merge_group` | Only what the queued group adds, against the base commit GitHub sends with the event. |
| `push`, `schedule`, `workflow_dispatch` | Everything in the repository and, for Gitleaks, the full history of the checked-out commit. |

Within that scope, a finding blocks when:

| Scanner | Blocks when |
| --- | --- |
| Semgrep | The rule's severity is `ERROR`, `HIGH` or `CRITICAL` (only `CRITICAL` with `severity-threshold: critical`). `WARNING` and `INFO` results are reported but don't block. |
| OSV-Scanner | The advisory is new and its CVSS score is 7.0 or more (9.0 or more for `critical`). Malicious-package advisories (`MAL-` IDs) have no score and always block. Advisories with no score are reported as "unknown" and don't block. |
| Gitleaks | Always. A leaked secret needs rotating whatever its type. |

Some results that aren't findings also block, because each one means a clean result can't be trusted:

- A `nosemgrep` comment, `.gitleaksignore` block or `osv-scanner.toml` entry without a written reason. On pull requests, only the lines and ignore files the pull request changes are checked.
- A Semgrep timeout or crash, which leaves part of the code unanalysed. Parse errors in single files are reported but don't block. An incomplete scan also skips the code scanning upload, so existing alerts don't show as fixed.
- A merge commit with three or more parents (an octopus merge), because Gitleaks can't see what such a merge added. A pull request that adds one is blocked. In a full scan, an octopus merge already in history blocks until someone checks it by hand and records that in `.gitleaksignore` as `# reviewed-merge <full SHA> <reason>`. Until then, the Gitleaks report doesn't upload to code scanning.
- A pull request that removes every lockfile OSV-Scanner found on the target branch.
- A scanner job that failed, timed out or was cancelled. The gate never reads a missing result as "no findings".

The baseline for "new" findings is different for each tool. Semgrep uses `--baseline-commit`. OSV-Scanner scans the baseline in a separate git worktree and compares advisories per lockfile and package. Gitleaks scans only the commits the pull request adds, which also catches a secret that was added and deleted again inside the same pull request. It also reads the changes a merge commit makes while resolving conflicts (`git log --remerge-diff`), which plain `git log -p` leaves out.

On pull requests, new findings show up as annotations on the diff and in the job summaries. Only full scans upload to code scanning. A pull request scan holds only the new findings, so uploading it would make code scanning mark every existing alert as fixed.

## Suppressing a false positive

Each tool keeps its own suppression format. The workflow requires a reason on each inline comment and ignore entry. Changes to whole-path config files get a reviewer warning instead.

**Semgrep.** Put the comment on the line of the finding, with the rule ID and a reason after ` -- `. Separate several rule IDs with commas:

```js
exec(cmd, cb); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- cmd is a constant
```

Semgrep accepts the marker in many spellings: any letter case, with or without a space or comment marker before it, on the line itself or the line above. The check doesn't copy those rules. It treats any text containing `nosem` as a marker, so no spelling gets past it. A bare `nosemgrep`, `#nosemgrep`, `NOSEMGREP` or `// TODO nosem`, or any marker without both a rule ID and a reason, fails the gate. A word that merely contains `nosem` gets flagged too, so reword it. The check only reads files Semgrep scanned, so paths in `.semgrepignore` are skipped. To skip whole paths, such as generated code or test fixtures, add a `.semgrepignore` file and explain each path in a comment.

**OSV-Scanner.** Add an entry to `osv-scanner.toml` next to the lockfile. Both `reason` and `ignoreUntil` are required, so the decision comes back for review when it expires. A `[[PackageOverrides]]` entry, which can hide every advisory for a package, needs a `reason` and an `effectiveUntil` date:

```toml
[[IgnoredVulns]]
id = "GHSA-r5fr-rjxr-66jc"
ignoreUntil = 2026-12-31
reason = "Only called with constant templates and no options. Upgrade needs the template tests rewritten first."
```

**Gitleaks.** Copy the fingerprint from the Gitleaks job summary into `.gitleaksignore`, under a comment that says why. One comment covers the block of lines below it, up to the next blank line. The summary prints two forms:

- For a real secret, rotate it first, then use the form with the commit SHA. It covers that one commit, so the same value committed again still fails.
- For a false positive that stays in the code, use the form without the commit. It keeps working after a squash or rebase merge changes the commit SHA. It also silences any future match of that rule on that line, so keep these entries few.

On repositories that rebase-merge, a rotated secret that stays in history gets a new commit SHA on `main`, so add a second entry from the full scan on `main` after the merge.

```
# Rotated on 2026-11-08, the key in this commit no longer works.
3f2a9c1e7b4d8a6f0e5c2b1a9d8c7e6f5a4b3c2d:config/app.yml:generic-api-key:12

# Example value in the parser tests, not a credential.
tests/fixtures/sample.yml:generic-api-key:3
```

The workflow runs Gitleaks with `--ignore-gitleaks-allow`, so inline `gitleaks:allow` comments have no effect. Every exception goes through `.gitleaksignore`, where it needs a reason.

**Scanner configuration.** `.gitleaks.toml`, `.semgrepignore` and `osv-scanner.toml` can switch rules off for whole paths, and the workflow can't judge whether that's justified, so on pull requests it adds a warning to every changed one. Changes to `.gitattributes` get the same warning. A `-diff` line there can't hide content, because the scan reads every text file as text. Put these files under a `CODEOWNERS` entry that requires a security reviewer.

## Hardening choices

- Every action is pinned to a full commit SHA with the version in a comment. In March 2026 an attacker force-pushed 76 of the 77 version tags of `aquasecurity/trivy-action` to malicious code ([CVE-2026-33634](https://github.com/advisories/GHSA-69fq-xp46-6x23), [Aqua's timeline](https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know)). Workflows pinned to a SHA kept running the code they had reviewed.
- The scanners are pinned too. The Semgrep container is pinned by digest, and the OSV-Scanner and Gitleaks downloads are checked against the SHA-256 checksums published with each release before they run.
- Dependabot updates the pinned actions weekly, with a 7-day cooldown before it proposes a new release. Dependabot can't see the scanner pins, so `scripts/update-tool-pins.sh` refreshes them and verifies the checksums, and a weekly job in this repo warns when they're behind.
- The workflow starts with `permissions: {}`, and each job asks only for what it uses. The gate job has no token permissions at all.
- It runs on `pull_request`, never `pull_request_target`, so code from a fork never runs with a write token or secrets. Called from `pull_request_target` or `workflow_run`, it fails instead of quietly scanning the base branch. Fork pull requests get a read-only token. That's enough, because pull request scans never upload to code scanning, and the gate doesn't depend on the upload.
- Checkouts use `persist-credentials: false`, so the token isn't left in `.git/config` for later steps to read.
- Inputs and event data reach shell scripts through environment variables, never through `${{ }}` inside `run:`, which closes off script injection.
- Gitleaks runs with `--redact`, so secret values stay out of logs, SARIF and artifacts.
- This repository lints its own workflows with [actionlint](https://github.com/rhysd/actionlint) and [zizmor](https://docs.zizmor.sh) in pedantic mode on every pull request.

## Why OSV-Scanner and not Trivy

Both are good scanners. I picked OSV-Scanner for this job for three reasons:

- It does one thing, lockfile scanning, which is all this job needs. Trivy also scans container images, IaC and cluster configuration, which a separate job would handle better.
- Its ignore file has `reason` and `ignoreUntil` fields, so a suppression carries its justification and an expiry. That matches the suppression policy above.
- Its JSON output groups aliases (CVE, GHSA) per advisory and includes a computed CVSS score, which makes the "new and high" comparison against the baseline a short `jq` program.

Trivy's March 2026 compromise wasn't the reason. The fix for that risk is pinning, and the workflow pins every tool either way.

## Limitations

- It runs on `ubuntu-24.04` x64 runners. It uses Docker for Semgrep and Linux binaries for the other scanners.
- It fetches the full git history (`fetch-depth: 0`) so it can compare against the baseline and scan every commit. Very large repositories will notice the checkout time.
- `p/default` uses Semgrep's free community rules, which match within a single file. Cross-file taint tracking needs Semgrep's paid engine.
- A pull request blocks on any octopus merge it brings in, for example when merging `main` into a release branch. The `reviewed-merge` override only applies to full scans, so an admin has to bypass the check for that pull request.
- Merge queue support hasn't run for real. Merge queues need an organization repository, and this one belongs to a personal account. The `merge_group` path uses the base commit GitHub documents for the event.
- Generic secret rules have gaps. In [pull request #4](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/pull/4), Gitleaks' generic API key rule skipped a random test key that contained the word "PUSH", and Semgrep's generic secret rule caught it. Running both is deliberate, and neither replaces GitHub's push protection.
- A full scan blocks on every finding in the repository that meets the threshold. See "Adopting it on an existing codebase" below.

## Adopting it on an existing codebase

Pull requests only see new findings, so they work from day one. Runs on `push` and `schedule` scan everything, and they stay red until the existing findings are fixed or suppressed. To get there:

1. Run the workflow once with `workflow_dispatch` and read the three job summaries.
2. For secrets, rotate each one. Then paste the fingerprints from the Gitleaks summary into `.gitleaksignore` as one block under a comment such as `# Historical findings, all rotated on 2026-11-08`.
3. For dependencies, upgrade what's cheap. Add an `osv-scanner.toml` entry with a reason and an `ignoreUntil` date for the rest.
4. For code, fix the blocking Semgrep findings or suppress them with a reason. Use `severity-threshold: critical` for a while if the list is long, and lower it once the backlog is gone.
5. If Semgrep times out on large generated or minified files, add them to `.semgrepignore` with a comment. A timeout blocks the gate, because those files were never analysed.
6. Migrate existing suppressions. The first run lists every `nosemgrep` comment without a rule ID and reason, `.gitleaksignore` entry without a comment, and `osv-scanner.toml` entry without a reason or an expiry. Inline `gitleaks:allow` comments stop working, so move those to `.gitleaksignore`.

## Repository layout

| Path | What it is |
| --- | --- |
| `.github/workflows/security.yml` | The reusable workflow. |
| `.github/workflows/ci.yml` | This repository's CI. It calls the workflow on itself, lints the workflows and tests the demo app. |
| `demo/` | A small Node.js app that renders emails with lodash templates. |
| `docs/lodash-reachability.md` | The triage write-up for the demo finding. |
| `scripts/update-tool-pins.sh` | Updates the scanner versions, checksums and digest. |

## License and security

MIT, see [LICENSE](LICENSE). To report a vulnerability in this workflow, see [SECURITY.md](SECURITY.md).

Built by [Khalid Sharafeldin](https://khalidsharafeldin.com).
