# Verification patterns

## Access

- exact subject, target, and entitlement;
- direct and effective access;
- requested role present and wider privilege absent;
- expiry and propagation state;
- audit record.

## Data or pipeline recovery

- original failed window now passes;
- the run committed new table versions, and the latest batch marker or keys reached the final layer (a SUCCESS status alone is not evidence);
- expected row counts and control totals;
- duplicates, omissions, and late records;
- downstream freshness and dependent jobs;
- adjacent windows or unaffected cohorts.

## Deployment or code fix

- exact commit or artifact deployed to the target environment;
- health and smoke checks;
- regression test for the original defect;
- business behavior and telemetry;
- rollback readiness.

## Ticket or communication

- exact record or message exists;
- state and fields match the intended change;
- recipients, links, and attachments are correct;
- wording does not overstate the operational result.

## Document

- source totals reconcile;
- formulas or citations work;
- rendered output has no visual defects;
- published bytes match the reviewed file.
