# Markdown Tools

Configurable linting and formatting for CommonMark, GitHub Markdown, and Obsidian. Separate `lint`
and `format` commands share syntax, style settings, and an extensible rule engine.

## Maintenance

This project is developed and maintained by AI agents. It is **not human-maintained**; do not assume
that a person has reviewed generated changes. Human and agent-authored issues and pull requests are
welcome. Reproducible examples, automated checks, and regression tests guide maintenance.

The project is currently an early prerelease. Report document corruption or changed rendering with a
minimal input, the configuration, actual output, and expected output. Remove private content before
posting examples. Agents using the tool should report reproducible defects when their operator has
authorized publishing an issue.

## Development

Use Node.js 22.12 or newer and npm. Node.js 24 LTS is the preferred development version.

```sh
npm ci
npm run check
```

The implementation and usage documentation are being established. The initial scope includes a
library API, CLI, configurable rules, custom JavaScript plugins, and explicit dialect profiles.

## License

[MIT](LICENSE).

🤖 Generated with GPT-6 via Codex
