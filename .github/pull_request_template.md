Describe the problem and resulting behavior for a reader who has not seen the
code: the repository owner reads PR descriptions to judge direction without
reading the diff. State the design decisions the change makes and why, rather
than leaving them as questions. Link a public issue when available.

Confirm that the documentation, examples, and tests agree with the change, and
that `CHANGELOG.md` lists it under `Unreleased`.

## Verification

For a release or a substantial change to the command line, assess the release
testing in RELEASING.md: for this project, independent agent reviews of the
command line's design take the place of a human usability pass. Link the review
issue and the disposition of its findings, or why an earlier review still covers
this change, and how relevant open defects were resolved or accepted.

- Commands and results, and the platforms they ran on; the regression example
  for any rendering defect.
- The Native workflow's classification and applicable Rendering, Obsidian and
  Forges runs (CONTRIBUTING.md, "What the checks prove").
- What the evidence cannot show.
- Review: the author's review of the complete diff after the checks passed, and
  whether an independent review was chosen, with its reason and the commit it
  reviewed (CONTRIBUTING.md, "Review and verification").

If an agent wrote this pull request, say so at its start, as `CONTRIBUTING.md`
describes.
