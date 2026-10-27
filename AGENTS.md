# Agents

Instructions for coding agents working in this repository. People should read
[CONTRIBUTING.md](CONTRIBUTING.md) first; everything there applies to agents
too.

## Before you open a pull request

```bash
npm test          # typecheck, typetest, storetest, authtest, reacttest, uitest, pgtest, smoke
npm run packtest  # when you touch files, exports, types or any public signature
```

A change to a published package needs a changeset (`npx changeset`). The eight
packages are version-locked (`fixed` in `.changeset/config.json`). A new
package's first version is published by hand: see Releasing in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## Keep the reference manual current

`docs/reference/` is the reference manual: the exact behaviour of every
public function, type and option, checked against the source. It is only
useful while it is true, so **every pull request that changes what the
packages do updates the manual in the same pull request.**

A change needs a manual update when it changes anything a user of the
packages can observe:

- a public signature, type, option or default;
- an error, a refusal, or the exact text of a message, including the text
  HaiKIT writes into the model's history or a tool result;
- a limit, a timing, a retry or backoff, a page size;
- a wire event, a route, a query parameter, a header or a status code;
- a stored shape, a schema, an id format, a channel or storage key name;
- what is validated, and what happens when it fails.

How to update it:

1. **Find every page that describes what changed.** One change often touches
   several: a new `HaiConfig` option belongs on [The server](docs/reference/server.md),
   on the page for its feature, and in
   [Configuration and limits](docs/reference/limits.md). Search the manual
   for the names, numbers and strings you changed.
2. **Write what the code now does,** following the conventions in
   [docs/reference/index.md](docs/reference/index.md): signature copied from
   the source, defaults as values, every refusal with its exact message.
   Copy values from the code, never from another document.
3. **A new export gets an entry on its page and a row in the symbol index**
   at the bottom of `docs/reference/index.md`. A removed export loses both.
4. **Check the links** between pages still resolve, and that every exported
   name is still in the symbol index.

If the README of a package, a tutorial or a code comment says something the
change makes untrue, fix it too. Where a document and the code disagree, the
code is right and the document is fixed.

**Say what you did in the pull request description,** under a
**Reference** heading: the pages you updated, or "No reference changes" with
a word on why (tests only, internal refactor, docs only). A pull request
that changes observable behaviour without updating the manual isn't ready.

## Other documents that must move together

- `docs/tutorial.md` is runnable: change `examples/hello` with it.
  `docs/tutorial-2.md` goes with `examples/hello-notices`, and
  `docs/tutorial-3.md` with `examples/hello-auth`.
- `apps/intro/content/` holds copies of the three tutorials and of the reference
  manual, and the intro shows them as pages. After changing a tutorial, and
  when the intro moves to a new release, run `npm run docs:update` in
  `apps/intro` once the change is on `main`; it runs that app's `npm test`,
  which stops on Markdown the intro's parsers don't know and on a reference
  link that leads nowhere.
- The four type guarantees are asserted in
  `packages/core/test/types/guarantees.ts`: change a guarantee and its test
  together.
