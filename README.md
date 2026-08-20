# SignalGate

SignalGate is a native DeepSeek Harness plugin for a governed industrial
operations workflow. It accepts a bounded production-flow signal, applies
deterministic security checks, prepares an action plan, requests native DSH
approval, and records one verified local outcome.

The bundled scenario uses synthetic data. The plugin does not contact external
services or live production systems.

## Workflow

```text
operator request
    -> factory assessment (read-only)
    -> security assessment (read-only)
    -> governed mission plan with a server-issued ticket
    -> native DSH approval
    -> exact local outbox append
    -> reread, evidence, and duplicate protection
```

The supported scenario is one unified-factory production-flow bottleneck. The
implementation is intentionally limited to one complete workflow rather than a
general manufacturing system.

## Tools

| Tool | Purpose | Side effect |
| --- | --- | --- |
| `factory_operations_plan` | Assess the bundled factory signal and its uncertainty. | None |
| `security_command_assess` | Classify the request and proposed action with the deterministic security gate. | None |
| `mission_control_plan` | Combine the assessments and issue a short-lived action ticket. | None |
| `mission_control_execute` | Execute the exact planned action after native DSH approval. | One local outbox append |

The execute tool reconstructs the canonical target and message on the server
side. Model-supplied target or message values cannot change the side effect.

## Plugin specification

- The plugin uses DSH tools, the native approval subsystem, and native web
  cards.
- Policy, action identity, authorization binding, idempotency, and durable-state
  verification are deterministic plugin behavior.
- Suspicious instructions, unsupported domains, malformed input, forged
  approvals, expired tickets, and replayed actions fail closed.
- The package contains no credentials, private data, external notification, or
  live production integration.
- The only durable side effect is a local JSONL outbox append followed by a
  post-write reread.

## Requirements

- A current DeepSeek Harness installation. DSH is a developer preview, so
  recheck the current release before using the package in another environment.
- Node.js 22 or newer.
- pnpm.
- A DSH profile with a configured model for interactive use. The keyless unit
  and evaluation suites do not require model credentials.

The artifact was verified locally with DSH CLI `0.1.0-rc.7`, host packages
`0.1.0-rc.8`, and official DeepSeek Harness commit
`141eb6fef83422698aef7a981029e843e8161534`.

## Installation

### Build the bundle

```powershell
git clone https://github.com/Mahmoud-N-Elmallah/signalgate-governed-mission-control.git
Set-Location .\signalgate-governed-mission-control
pnpm install --frozen-lockfile
pnpm test
pnpm eval
New-Item -ItemType Directory -Force .artifacts | Out-Null
pnpm pack --pack-destination .artifacts
```

### Add the bundle to DSH

Install the tarball into the DSH profile. The `web` profile provides
the native DSH interface:

```powershell
$artifact = Get-ChildItem -LiteralPath .artifacts -Filter '*.tgz' |
  Select-Object -First 1
dsh plugin --profile web add $artifact.FullName
dsh --profile web --dump-config
dsh web
```

The configuration output must contain the bundle row for
`@dsh-showcase/governed-mission-control`.

If the Windows DSH preview cannot forward a path containing spaces, stage the
tarball at a path without spaces:

```powershell
$artifact = Get-ChildItem -LiteralPath .artifacts -Filter '*.tgz' |
  Select-Object -First 1
$stagedArtifact = Join-Path ([System.IO.Path]::GetTempPath()) 'signalgate-dsh.tgz'
Copy-Item -LiteralPath $artifact.FullName -Destination $stagedArtifact -Force
dsh plugin --profile web add $stagedArtifact
dsh --profile web --dump-config
dsh web
```

To use an isolated profile, set `DSH_HOME` before the `dsh plugin` command:

```powershell
$env:DSH_HOME = Join-Path (Get-Location) '.dsh-home'
```

The generated tarball is ignored by Git. Build it locally when installing from
this repository.

## Usage

Run the following request in a DSH session:

```text
Use SignalGate to assess the bundled synthetic factory bottleneck. Prepare the governed plan only. Do not execute it.
```

A valid plan includes the factory signal, uncertainty, security decision,
canonical action, approval policy, and a server-issued assessment ticket.
Planning does not write the outbox.

To execute the planned action, provide the exact identifiers returned by the
plan:

```text
Execute the exact action_id and assessment_id returned by the ready SignalGate plan.
```

The native approval request must be approved with `Allow once`. A successful
execution appends:

```text
.dsh-signal-gate/outbox.jsonl
```

The plugin rereads the file before reporting success. Repeating the same action
returns `duplicate`, skips a second approval, and leaves one record.

## Safety properties

- The only accepted action is the bundled synthetic action.
- A ready plan must contain a server-issued ticket bound to the exact action.
- Every approval result other than native `allowed-once` fails closed.
- Blocked plans issue `not-issued` and cannot be executed directly.
- The target and message are reconstructed from the fixture.
- Existing malformed outbox content is never overwritten.
- Atomic version-guarded writes and a post-write reread protect the result.
- Unsupported maintenance, quality, material-flow, and utility records are
  reported as out of scope rather than acted on.

This package is a reference implementation. It is not a production safety
certification or a live factory connector. To adapt it for a real system,
replace the local outbox with an approved adapter while preserving the security
gate, native approval, canonical action binding, idempotency, and external
post-action verification.

## Presentation

There is no separate frontend application. `src/presentation.js` returns
native DSH generic-card descriptors and structured text fallbacks. The DSH web
workspace renders the factory, security, approval, and evidence states.

## Verification

Run the deterministic checks without model credentials:

```powershell
pnpm test
pnpm eval
pnpm pack --dry-run
```

`pnpm eval` uses production-shaped, source-traceable records and invariant
checks. It exits non-zero when an open defect is reproduced. See:

- [`evaluations/README.md`](evaluations/README.md) for the evaluation design;
- [`tests/`](tests/) for unit, contract, and security coverage.

The recorded checks include 39/39 unit tests, 93/93 evaluation checks,
successful package inspection, and installation into an isolated DSH profile.

## Repository layout

```text
src/                 plugin implementation and native DSH presentation
tests/               unit, contract, security, factory, and UI-contract tests
evaluations/         invariant-based evaluation runner and datasets
```

## License

MIT. See [`LICENSE`](LICENSE).
