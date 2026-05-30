---
id: node-22-minimum
kind: decision
status: active
since: 2026-05-30
---

# Decision: Node.js 22 LTS as Minimum Runtime

## Decision

Project requires Node.js 22 LTS or later.

## Why

### Root cause: `node --test` glob expansion

Node 22 has built-in glob expansion for `node --test 'src/**/*.test.ts'`. Node 20 does not — it passes the literal `**` string through and errors with "Could not find ... `src/**/*.test.ts`". CI shells (Linux/macOS bash without `shopt -s globstar`, Windows Git Bash) all pass the literal `**` to node, so the glob must be expanded by the runtime.

Three M2 brief #4 follow-up commits chased this symptom across packages as it migrated from one package's test script to the next:

- `8e2ca6e` — protocol
- `0b38158` — core + rendezvous
- This decision commit — structural fix

Each prior commit addressed the symptom in a single package's test script. Dropping Node 20 support is the root cause fix.

### Other Node 22 features

- Top-level `await` stable (no `--harmony-top-level-await` flag needed).
- `--watch` mode for development.
- Native `fetch` API (stable since Node 18, improved in 22).
- WebSocket client (stable in Node 22).

### Support window

Node 22 LTS is supported through April 2027. The project is 2025-new and expected to reach production well within that window. No external consumers depend on Node 20.

## Implications

- CI matrix simplified from 6 cells (3 OS × 2 Node versions) to 3 cells (3 OS × 1 Node version).
- `engines.node` set to `">=22.0.0"` in root `package.json`.
- All package test scripts can rely on `node --test` native glob expansion — no shell `globstar`, no external loaders, no workarounds.
- Package-level `package.json` test scripts are unchanged because `src/**/*.test.ts` now expands correctly on Node 22.

## Boundaries

- Applies project-wide: all packages (protocol, core, rendezvous, cli, daemon, pi-bridge).
- Re-evaluate at M5 if a Node 22-incompatible distribution target arises.
- Does NOT change browser support — browser-targeted code is unaffected; this covers the Node-side daemon and tooling.

## Reference

M2 brief #4 follow-up commits demonstrating the Node 20 glob expansion failure mode:

- `8e2ca6e` — fix(ci): ...
- `0b38158` — fix(ci): drop empty src glob from protocol test script
- This decision commit — chore: drop Node 20 support, require Node 22 LTS minimum

## Related

- Decision: [windows-first-class.md](windows-first-class.md) — platform support scope
