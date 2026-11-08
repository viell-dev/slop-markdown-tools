# Reachability example

Start at the [guide](guide.md). All destinations in this example exist, but the
two documents under `archive/` form a separate cycle.

From this directory, run:

```sh
mdrefine audit reachability --entry README.md
```

The command names `archive/appendix.md` and `archive/index.md` and exits with
code 1. To treat that separate group as intentionally accessible, supply its
entry too:

```sh
mdrefine audit reachability --entry README.md --entry archive/index.md
```

The second command exits with code 0. Neither command changes a document.
