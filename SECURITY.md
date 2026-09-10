# Security

Report vulnerabilities privately to the platform owner. Do not open a public
issue that includes an exploit, a secret, or a bypass of a guard.

This repository's enforcement surface is attested in `lifecycle/integrity.json`.
A change to a hook, policy file, or `lifecycle.mjs` that is not re-attested is
a CI failure, not a silent drift.
