# `content/shell-prompt`

Reports a code block of shell commands in which every command starts with a
prompt, `$` or `%` followed by blank space, and that shows no output. Such
prompts tell a reader nothing that the block does not, and get in the way of
copying the commands.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

````markdown
```sh
$ npm ci
$ npm test
```
````

Not reported:

````markdown
```sh
npm ci
npm test
```

```console
$ node --version
v24.21.0
```
````

## Edge cases and advanced usage

**Details:** removing the prompts changes the code that readers copy, so the
rule only reports. A block is checked when it names no language, as indented
blocks cannot, or names a shell or a shell session: `sh`, `bash`, `zsh`, `fish`,
`ksh`, `csh`, `tcsh`, `dash`, `shell`, `console`, `terminal`, `shell-session`,
`sh-session`, or `shellsession`, in any letter case. Other languages, `text`
among them, can start a line with `$` or `%`, as TeX's comments and math do.
Blank lines are not commands, nor are lines that a backslash at the end of the
line above continues the command onto.

**Not checked:**

- A block with a line that starts with `#`. Such a line is not a command: it is
  a comment in shell code, and output or a root prompt in a session.
- A block in which any other line shows output, even if some commands show none.
