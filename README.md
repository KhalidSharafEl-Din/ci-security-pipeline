# ci-security-pipeline

A reusable GitHub Actions workflow that runs three security scanners on every pull request and ends in one pass or fail check:

- **SAST** with [Semgrep](https://semgrep.dev) finds risky code, such as user input reaching a shell command.
- **SCA** with [OSV-Scanner](https://google.github.io/osv-scanner/) finds dependencies with known vulnerabilities.
- **Secret scanning** with [Gitleaks](https://github.com/gitleaks/gitleaks) finds credentials committed to git, including ones deleted in a later commit.

Each scanner uploads its results to GitHub code scanning. A final `gate` job fails the pull request when the change adds a high or critical finding, so you only need to make one check required. Findings that were already on the target branch don't block the pull request.

I built this to show how I set up pipeline security: pinned and verified tools, least-privilege tokens, a gate that fails closed, and a written reason for every exception.

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
  push:
    branches: [main]
  schedule:
    - cron: "17 4 * * 1" # weekly, to catch advisories published after a merge

permissions: {}

jobs:
  security:
    uses: KhalidSharafEl-Din/ci-security-pipeline/.github/workflows/security.yml@<commit-sha> # v1.0.0
    permissions:
      contents: read # check out the code
      security-events: write # upload SARIF to code scanning
      actions: read # code scanning reads the run metadata on private repos
```

Replace `<commit-sha>` with the full SHA of the [latest release](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/releases). Pin to the SHA, not the tag, because a tag can be moved to different code. Dependabot's `github-actions` updates understand this format and keep the SHA and the comment current.

Then make the `security / gate` check required, under Settings, Rules, Rulesets, "Require status checks to pass". The scanner jobs don't fail on findings, so the gate is the only check you need to require.

On a private repository without GitHub Code Security, code scanning won't accept uploads. Add `with: { upload-sarif: false }`. The gate works the same, and each run keeps the reports as artifacts for 14 days.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `severity-threshold` | `high` | Lowest severity that fails the gate: `high` or `critical`. Secrets always fail it. |
| `semgrep-config` | `p/default` | Space-separated Semgrep configs: registry rulesets, URLs or paths in your repo. |
| `semgrep-extra-rules-repo` | empty | An `owner/repo` with extra Semgrep rules, such as a team rule pack. |
| `semgrep-extra-rules-ref` | empty | Commit SHA of the extra rules repo. Required when the repo is set. A tag works but triggers a warning. |
| `semgrep-extra-rules-path` | `.` | Folder of rules inside the extra rules repo. |
| `sca-paths` | `.` | Space-separated paths that OSV-Scanner searches for lockfiles. |
| `upload-sarif` | `true` | Upload results to code scanning. |

The workflow has one output, `blocking-findings`, with the number of findings that failed the gate.

To add a rule pack, such as [KhalidSharafEl-Din/semgrep-rules](https://github.com/KhalidSharafEl-Din/semgrep-rules), pass it next to the default rules:

```yaml
    with:
      semgrep-extra-rules-repo: KhalidSharafEl-Din/semgrep-rules
      semgrep-extra-rules-ref: <commit-sha>
      semgrep-extra-rules-path: rules
```

The workflow checks the pack out without credentials, so the rules repo must be public.

## How the gate decides

The scope depends on the event:

| Event | Scope |
| --- | --- |
| `pull_request`, `merge_group` | Only what the change adds. The checkout is GitHub's merge commit, and its first parent is the target branch, so that parent is the baseline. |
| `push`, `schedule`, `workflow_dispatch` | Everything in the repository and, for Gitleaks, the full git history. |

Within that scope, a finding blocks when:

| Scanner | Blocks when |
| --- | --- |
| Semgrep | The rule's severity is `ERROR`, `HIGH` or `CRITICAL` (only `CRITICAL` with `severity-threshold: critical`). `WARNING` and `INFO` results are reported but don't block. |
| OSV-Scanner | The advisory is new and its CVSS score is 7.0 or more (9.0 or more for `critical`). Malicious-package advisories (`MAL-` IDs) have no score and always block. Advisories with no score are reported as "unknown" and don't block. |
| Gitleaks | Always. A leaked secret needs rotating whatever its type. |

Every suppression without a written reason also counts as one blocking finding, and so does a scanner that crashed, timed out or was cancelled. The gate never reads a missing result as "no findings".

The baseline for "new" findings is different for each tool. Semgrep uses `--baseline-commit`. OSV-Scanner scans the baseline in a separate git worktree and compares advisories per lockfile and package. Gitleaks scans only the commits the pull request adds, which also catches a secret that was added and deleted again inside the same pull request.

## Suppressing a false positive

Each tool keeps its own suppression format, and the workflow checks that every entry explains itself.

**Semgrep.** Put the comment on the line of the finding, with the rule ID and a reason after ` -- `:

```js
exec(cmd, cb); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- cmd is a constant
```

A bare `nosemgrep` or one with no reason fails the gate. To skip whole paths, such as generated code or test fixtures, add a `.semgrepignore` file.

**OSV-Scanner.** Add an entry to `osv-scanner.toml` next to the lockfile. Both `reason` and `ignoreUntil` are required, so the decision comes back for review when it expires:

```toml
[[IgnoredVulns]]
id = "GHSA-r5fr-rjxr-66jc"
ignoreUntil = 2026-12-31
reason = "Only called with constant templates and no options. Upgrade needs the template tests rewritten first."
```

**Gitleaks.** Rotate the secret first. Then add its fingerprint (from the Gitleaks report) to `.gitleaksignore`, under a comment that says why:

```
# Rotated on 2026-11-08, the key in this commit no longer works.
3f2a9c1e7b4d8a6f0e5c2b1a9d8c7e6f5a4b3c2d:config/app.yml:generic-api-key:12
```

For a known test value, a `# gitleaks:allow` comment on the line also works.

## Hardening choices

- Every action is pinned to a full commit SHA with the version in a comment. In March 2026 an attacker force-pushed 76 of the 77 version tags of `aquasecurity/trivy-action` to malicious code ([CVE-2026-33634](https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know)). Workflows pinned to a SHA kept running the code they had reviewed.
- The scanners are pinned too. The Semgrep container is pinned by digest, and the OSV-Scanner and Gitleaks downloads are checked against the SHA-256 checksums published with each release before they run.
- Dependabot updates the pinned actions weekly, with a 7-day cooldown before it proposes a new release. Dependabot can't see the scanner pins, so `scripts/update-tool-pins.sh` refreshes them and verifies the checksums, and a weekly job in this repo warns when they're behind.
- The workflow starts with `permissions: {}`, and each job asks only for what it uses. The gate job has no token permissions at all.
- It runs on `pull_request`, never `pull_request_target`, so code from a fork never runs with a write token or secrets. Fork pull requests get a read-only token, so the workflow skips the code scanning upload for them. The gate doesn't depend on the upload, so it still decides.
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
- A full scan blocks on every finding in the repository. When you adopt it on a codebase with existing findings, the first `push` and `schedule` runs will fail until you fix or suppress them. Pull requests are unaffected, because they only see new findings.

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
