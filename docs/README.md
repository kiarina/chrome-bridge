# docs

## Layout

| Directory | Contents | Question it answers |
|---|---|---|
| `concepts/` | Design, public contracts, investigations, and repeatedly referenced fixed values | "How does it work? Why is it this way?" |
| `playbooks/` | Work patterns that require judgment, with reasons and branches | "I am about to do this — how do I decide?" |
| `runbooks/` | Fixed procedures with no decisions left to the reader | "I just want to run the steps" |

### playbooks vs runbooks

- **playbook** — contains selection criteria and branches. Read it and decide as you go.
  Example: `playbooks/adding-tools-and-page-operations.md` (what to build in which
  order, and what each slice must be validated against).
- **runbook** — run it top to bottom. Example: `runbooks/development.md`,
  `runbooks/release.md`.

When in doubt, ask whether the reader is forced to choose something. If yes, it is a
playbook.

## Where else things live

- Entry point, installation, and feature overview: root `README.md`
- Normative protocol and tool specification: root `SPEC.md`
- Completed work, measurements, and past decisions: root `HISTORY.md`
- Unfinished work, blockers, and handoffs: root `tasks/` (index in `AGENTS.md`)
- Public data-handling statement: root `PRIVACY.md`
- User-visible changes per distributed component: each component's `CHANGELOG.md`
- Per-task routing to a single file under this directory: the docs guide in `AGENTS.md`

## Placement rules

- One fact, one canonical location. Indexes and overviews carry only the essentials and
  link to the canonical document.
- In-progress state, blockers, and remaining work belong in `tasks/`, not here. On
  completion, move measurements and decisions to `HISTORY.md` and reusable knowledge here.
- `HISTORY.md` records what was true at a point in time. Do not rewrite it to match the
  present.
- Each subdirectory `README.md` stays limited to the meaning of that category and an
  index of its files.
- `assets/` holds images referenced by these documents and by Store listings.

## Index

- [`concepts/`](concepts/README.md) — design, contracts, investigations, fixed values
- [`playbooks/`](playbooks/README.md) — work patterns that require judgment
- [`runbooks/`](runbooks/README.md) — fixed procedures
