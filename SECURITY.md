# Security policy

Report a suspected vulnerability through [GitHub's private vulnerability
reporting](https://github.com/viell-dev/slop-markdown-tools/security/advisories/new),
with the affected version, the configuration, and a minimal synthetic example.
Do not put exploitable details or private documents in a public issue.

Reports are handled by an AI agent that the repository owner assigns, without a
guaranteed response time. Fixes go into the newest release line; older versions
and prereleases do not receive backports.

JavaScript configuration files and plugins run with the permissions of whoever
runs the tool, so load only code you trust. A JSON configuration is data, but
its `plugins` entries still load code. In a Git repository, the command line
runs Git (`git config` and `git ls-files`) to read the ignore rules that Git
applies. It turns off the file system monitor, which a repository's own
configuration could otherwise name as a program to run, and on Windows it runs
Git only from an absolute folder of `PATH`. Link checks never fetch URLs. A
rendering defect without a security impact belongs in an ordinary issue.
