# Contributing

Thanks for taking the time. Bug reports and small, focused pull requests are both
welcome.

## Before you start

- For a **security issue**, do not open an issue or a pull request. Follow
  [SECURITY.md](SECURITY.md) instead.
- For anything that changes the public API surface, open an issue first so we can
  agree on the shape before you write code. This client tracks the Snapshot Site
  API, so a change here usually needs the same change in the other clients.
- Small fixes — a wrong type, a broken example, a typo — go straight to a pull
  request, no issue needed.

## Local setup

```bash
pnpm install
pnpm run build
```

## Before opening a pull request

```bash
pnpm test
```

CI runs the same commands, so a green run locally usually means a green run
there.

Note that `pnpm test` currently runs the TypeScript build, which type-checks the
server. There is no separate unit-test suite yet.

## Pull requests

- One concern per pull request. Two unrelated fixes are two pull requests.
- Keep the existing style of the file you are editing rather than reformatting it.
- Say what you changed and why in the description. "Fixes #12" is enough context
  when the issue already explains it.
- Do not bump the package version or edit the changelog — releases are cut
  separately.

## Reporting a bug

Include the version you are on, what you expected, what happened, and a snippet
that reproduces it. Redact your API key.
