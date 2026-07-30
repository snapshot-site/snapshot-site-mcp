# Security Policy

## Reporting a vulnerability

Please report security issues privately to **contact@snapshot-site.com**.

Do not open a public issue or pull request for a suspected vulnerability.

Include as much of the following as you can:

- the affected version of `@snapshot-site/mcp`
- what an attacker can do with the issue
- steps to reproduce, or a minimal proof of concept
- any logs or request IDs, with API keys redacted

## What to expect

- We acknowledge reports within **5 business days**.
- We will tell you whether the report is accepted, and give you an expected fix window.
- We will credit you in the release notes if you want to be credited, and keep you anonymous if you do not.
- Please give us a reasonable window to ship a fix before disclosing publicly.

## Supported versions

Only the latest published release of [`@snapshot-site/mcp`](https://www.npmjs.com/package/@snapshot-site/mcp) receives security
fixes. Upgrade before reporting an issue against an older version.

## Out of scope

- Vulnerabilities in the Snapshot Site API itself rather than this client
  — still send those to contact@snapshot-site.com, they are in scope for the
  product, just not tracked in this repository.
- Findings that require a leaked or shared API key. Rotate the key in the
  [console](https://console.snapshot-site.com) instead.
- Reports produced only by an automated scanner, with no demonstrated impact.

## Rotating a leaked API key

If you have exposed a Snapshot Site API key, revoke it yourself in the
[Snapshot Site console](https://console.snapshot-site.com) and issue a new one.
Treat any key that has been committed, logged, or pasted into a third-party
tool as compromised.

## Hosted MCP server

Issues affecting the hosted endpoint at `https://mcp.snapshot-site.com/mcp`
— OAuth flow, token validation, scope handling — are in scope for this policy
even though the deployment is not in this repository.
