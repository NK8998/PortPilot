# Skill evaluations

`run-evals.js` executes the versioned detection seeds for every golden fixture, validates emitted
finding envelopes, and enforces the WinPort quality thresholds:

- recall >= 80%
- false-positive rate <= 20%
- at least one negative-control fixture per skill
- valid `SKILL.md` routing frontmatter and local links

```powershell
npm ci --prefix contracts
node evals/run-evals.js
```

The harness deliberately tests what code can decide. Cold-agent exercises and real repository
runs are separate review evidence for contextual judgment.
