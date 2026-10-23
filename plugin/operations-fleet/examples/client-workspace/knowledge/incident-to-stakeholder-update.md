---
type: Playbook
title: Incident to stakeholder update
description: Example end-to-end procedure for a production incident that needs a fix, a written record, and a stakeholder notification.
status: stable
---

- Investigate the root cause before proposing or making any change.
- When the investigation finds a code, SQL, or configuration defect, implement and test a focused fix and open a pull request.
- When the incident was stakeholder-facing (affected a production workload or was reported by a stakeholder), write a short RCA document once the cause and fix are established.
- Notify `weekly_stakeholders` using the reviewed RCA document once it passes review. Do not notify before the document is reviewed, and do not skip the notification once one was promised.
- If the investigation finds the incident already recovered with no defect to fix, skip the fix step and record a short closure note instead — do not force a pull request or document that isn't warranted.
- If no stakeholder was ever told to expect an update, the RCA and its conclusion are enough; the notification step does not apply.
