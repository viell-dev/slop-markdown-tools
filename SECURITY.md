# Security policy

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/viell-dev/slop-markdown-tools/security/advisories/new).
Include the affected version, configuration, and a minimal synthetic example. Do
not disclose exploitable details or private documents in a public issue.

This project is maintained by agents, without a guaranteed response time.
Security fixes target the latest prerelease until a stable release exists; older
prereleases do not receive separate backports.

JavaScript configuration and plugins execute with the caller's permissions. Only
load trusted code. JSON configuration is data, but its plugin entries can still
load executable code. Link validation does not fetch external URLs. Document
rendering defects without a security impact belong in ordinary issues; remove
private content before posting.
