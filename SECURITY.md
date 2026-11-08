# Security policy

## Reporting a vulnerability

Email security@khalidsharafeldin.com with a description of the issue and the steps to reproduce it. Please don't open a public issue for a vulnerability.

I'll reply within 5 working days. This is a personal project, so there's no bug bounty.

## What counts

Report anything that could let the workflow run code an attacker controls, leak a token or secret, or report a pass when a scanner found a blocking issue or didn't run.

The `demo/` app ships a vulnerable lodash version on purpose in the demo pull request. That isn't a vulnerability in this project.

## Supported versions

Fixes ship in a new release. Pin the workflow to the SHA of the latest release.
