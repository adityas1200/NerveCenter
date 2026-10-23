# Evidence quality

Prefer evidence that is:

- authoritative for the claimed state;
- fresh enough for the decision;
- scoped to the exact target, version, environment, user, or time window;
- independent of the original assertion when possible;
- reproducible or linked by a stable ID;
- complete enough to test both success and important side effects.

Weak evidence includes a screenshot without identity or time, an agent summary with no source, a provider acceptance response, a healthy different environment, a parent job marked green while the relevant data window is wrong, or a ticket state changed by the same action being verified.

Record extraction time, timezone, query or tool used, target identifiers, and known latency. If evidence is eventually consistent, return `INCONCLUSIVE` or `pending` until the bounded observation window expires.
