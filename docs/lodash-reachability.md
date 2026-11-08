# Is that CVE reachable? Triaging a lodash finding

The short answer for this demo: the vulnerable lodash function is reachable, but an attacker can't control the input it needs. I upgraded anyway, because the upgrade was cheap. Along the way the gate showed that 4.17.21, the version most people remember as "the lodash fix", is no longer enough.

This write-up walks through the finding on [pull request #1](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/pull/1) and the questions I ask before I fix, accept or suppress a dependency finding.

## The finding

The pull request moves the demo's email renderer (`demo/src/mail/render.js`) to `_.template` and adds lodash 4.17.20. The gate failed on the first commit ([run](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42478643163)). OSV-Scanner reported four advisories, and two of them crossed the "high" threshold:

| Advisory | CVE | What it is | CVSS | Gate |
| --- | --- | --- | --- | --- |
| GHSA-35jh-r3h4-6jhm | CVE-2021-23337 | Code injection through `_.template`'s `variable` option | 7.2 | blocks |
| GHSA-r5fr-rjxr-66jc | CVE-2026-4800 | Code injection through `_.template`'s `options.imports` key names | 8.1 | blocks |
| GHSA-xxjr-mmjv-4gpg | CVE-2025-13465 | Prototype pollution in `_.unset`, `_.omit` and `_.pullAt` | 6.9 | reported |
| GHSA-29mw-wpgm-hmr9 | CVE-2020-28500 | ReDoS in `_.toNumber`, `_.trim` and `_.trimEnd` | 5.3 | reported |

## Three questions before I touch the lockfile

A scanner tells you a vulnerable version is installed. It doesn't tell you whether your code is exposed. I answer three questions in order and stop as soon as one answer is "no".

**1. Does the package ship?** lodash is a runtime dependency in `package.json`, not a dev dependency, so it ends up in production. Yes.

**2. Does our code call the vulnerable function?** Both blocking advisories are in `_.template`, and `render.js` calls `_.template(source)`. Yes, the function is reachable.

**3. Can an attacker control the input that reaches the dangerous part?** Both bugs live in options that `_.template` passes to the `Function()` constructor. CVE-2021-23337 needs control of `options.variable`. CVE-2026-4800 needs control of the key names in `options.imports`, or a polluted `Object.prototype`. Our call passes no options at all, and the template strings are constants in the file. Users only supply the values in `data`, which `<%- %>` escapes. No, not today.

So the honest status is "reachable, not exploitable as written". That's a real distinction. It's also fragile: one future change that passes user input as options turns it into remote code execution.

## Fix, accept or suppress

When the fix is a patch or minor upgrade and the tests pass, I upgrade, even when the finding isn't exploitable. That costs a few minutes now and removes the question for every later change.

I suppress only when the upgrade is expensive, for example a major version with breaking changes, and the answer to question 3 is "no". The suppression goes in `osv-scanner.toml` next to the lockfile, with the reasoning and an expiry date, so it comes back for review instead of living forever:

```toml
[[IgnoredVulns]]
id = "GHSA-r5fr-rjxr-66jc"
ignoreUntil = 2026-12-31
reason = "render.js calls _.template with constant templates and no options. Upgrade to 4.18 needs the template tests rewritten first."
```

The workflow rejects an ignore entry that has no `reason` or no `ignoreUntil`, and a rejected entry counts as a blocking finding.

## The surprise: 4.17.21 is not the fix any more

The second commit bumped lodash to 4.17.21, the release that fixed CVE-2021-23337 in 2021. The gate still failed ([run](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42479203940)) with one blocking finding: CVE-2026-4800.

The 2021 fix added validation for the `variable` option but left the `imports` key names unchecked, and both reach the same `Function()` call. The advisory was published on 2026-04-01 and the fix shipped in lodash 4.18.0. 4.17.21 also still carried the moderate CVE-2025-13465, fixed in 4.17.23.

The third commit bumped lodash to 4.18.1, and the gate passed ([run](https://github.com/KhalidSharafEl-Din/ci-security-pipeline/actions/runs/42479443404)) with no advisories left.

The lesson is about memory, not lodash. "Upgrade to the version in the advisory I remember" goes stale. The scanner checks against today's advisory data on every run, which is also why this repo runs a full scan every week: an advisory published after a merge still shows up.

## Why the gate doesn't use reachability

The gate blocks on the CVSS score of each new advisory and ignores reachability. That's a deliberate choice.

OSV-Scanner's call analysis covers Go and Rust, not JavaScript, so the tool can't answer question 2 for this app. Even where call analysis exists, it can't answer question 3, which is the one that matters. A gate that guesses at reachability would pass findings it shouldn't.

So the gate stays simple and strict, and a person answers the three questions. When the answer is "accept the risk for now", the suppression file records why and until when, git history records who, and code review sees it in the diff.
