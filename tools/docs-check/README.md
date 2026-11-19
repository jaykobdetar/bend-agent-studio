# Markdown path checks

The reusable module is `checks/docs_markdown.mjs`; the repository's canonical
entry point can consume `checkMarkdown(root, options)`. It returns `{issues,
linkTargets}`. Each issue has repository-relative `file`, one-based `line`,
`code`, `target`, and `message`. Link targets contain `file`, `line`, `target`
and `fragment`; their local file has been resolved, but check `issues` before
considering a fragment valid. `anchors`, `slug` and `shellTokens` are exported
for independent testing. No command is executed and no URL is fetched.

Options:

* `files`: explicit Markdown files; otherwise recursively discovers Markdown,
  excluding dependencies, virtual environments and symlinks. Production callers
  should pass tracked files, excluding intentional red/green test fixtures.
* `generated`: exact relative generated-file or directory roots (default `runs`).
  Recognized experiment/batch output positions and shell redirects add generated
  paths within that document only.
* `inlineAllow`: exact exceptions for schema field examples, generated artifact
  basenames, or external installation paths. The caller should document every
  entry rather than suppressing all missing paths.

Inline backticks containing a path or a familiar repository-file extension are
checked against the repository root, then relative to the document. Markdown
links are document-relative, with `/` explicitly repository-relative. Both
missing files and escaping symlinks fail. Headings include duplicate suffixes,
Unicode names, setext headings and explicit HTML IDs. Reference links and image
links are checked; code fences do not create anchors or Markdown links.

Shell fences tagged `sh`, `bash`, `shell`, `console` or `zsh` validate literal
script/config paths for node, python/python3 and bend, without evaluating shell.
The default working directory is the repository root. A preceding directive
`<!-- docs-check: cwd=folder -->` sets the next fence's starting directory;
literal `cd` statements update it inside the fence. Quoted paths and continued
lines are supported. Absolute paths, home paths, variables, globs and uppercase
placeholders such as OUT are external/dynamic and not resolved. This does not
validate command flags, executables installed outside the repository, shell
functions, generated files' contents or remote URLs. It is a bounded syntax
checker for this project's documentation, not a full CommonMark or shell parser.
An exceptional next line can use
`<!-- docs-check: ignore-next-line explain the intentional exception -->`.

Run the small fixture suite with:

```sh
node --test checks/docs_markdown.test.mjs
```

The red fixture intentionally contains broken references. Do not include it in
production document discovery. Tests cover each failure class, line numbers,
working-directory directives, quotes, duplicate/Unicode headings, anchor IDs,
explicit exceptions, symlink escape and isolation of generated-path state.
