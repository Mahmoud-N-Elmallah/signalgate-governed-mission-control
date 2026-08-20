# SignalGate evaluation suite

This suite evaluates the installed plugin as an operational workflow. It does
not compare one model answer with a fixed paragraph. It checks invariants:

- bounded input handling and trust classification;
- scope behavior for factory, quality, maintenance, material-flow, and utility
  records;
- deterministic action binding;
- plan-ticket and approval boundaries;
- atomic outbox, reread, duplicate, denial, and malformed-state behavior;
- adversarial injection paraphrases, forged approval claims, unbound action
  fields, and hostile durable state;
- registration and native/fallback evidence parity.

The records are production-shaped evaluation records, not Magna data. They are
derived from public manufacturing themes and public dataset schemas. Every
record carries source metadata and an explicit `data_status` so generated
values cannot be mistaken for private or live plant telemetry.

Sources used for the record shapes:

- Magna manufacturing AI themes:
  https://www.magna.com/stories/blog/2026/ai-at-work--5-ways-magna-is-reimagining-manufacturing
- UCI SECOM semiconductor manufacturing data:
  https://archive-beta.ics.uci.edu/dataset/179/secom
- NASA C-MAPSS multivariate degradation data:
  https://data.nasa.gov/dataset/cmapss-jet-engine-simulated-data
- UCI AI4I 2020 Predictive Maintenance Dataset:
  https://archive.ics.uci.edu/dataset/601/ai4i%2B2020%2Bpredictive%2Bmaint

The suite includes a row-derived subset of the AI4I dataset. The dataset is
public and synthetic, licensed CC BY 4.0. It is used to exercise the
maintenance and condition-monitoring scope boundary; it is not Magna data.

Run the keyless evaluation with:

```powershell
pnpm eval
```

The command prints a JSON report and exits non-zero when an invariant fails.
Failures are recorded manually in `bugs/bug-book.md` after the run. Browser
evaluation is kept as a Playwright CLI runbook because the DSH preview owns the
browser session and native approval UI.
