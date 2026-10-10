# Introducing HaiKIT

HaiKIT's introduction, built with [HaiKIT](https://github.com/wfoxd/haikit):
what an elicitation app is, and how HaiKIT builds whole apps with an LLM. This
folder is a complete, self-contained app: copy it anywhere, install, and run.
It depends only on the published `@haikit/*` packages.

The introduction is a HaiKIT conversation. It opens on a welcome screen that asks
where to begin, lesson 1.1 or the course map. Before the question, it shows the
HaiKIT logo, a diagram of how a HaiKIT app works, and three short sections: why
build a product on HaiKIT, what the LLM brings to the app, and what HaiKIT gives
you, each with an illustration. It ends with the place to start, beside a
Tutorial panel whose steps open HaiKIT's tutorials right here. The text lives in
`src/server/course/index.ts`, and the illustrations are drawn as SVG in
`public/illustrations.js`.

From there a guide opens lessons with tools: each lesson is a `display`
surface, and each checkpoint question is an `elicit` surface that parks the
turn until the learner answers. After an answer, the next lesson waits behind a
button the learner clicks when they're ready. Learners use elicitation while
they read about it, and the model context drawer (**Context** in the header)
shows what the model received the whole time.

| Part | Lessons |
| --- | --- |
| 1. The elicitation app, explained | Why asking in prose fails, the parked turn, the dual channel, modes and actions, `query_ui` and `cap`, the life of a parked turn |
| 2. How haikit implements it | The packages, the contract, the server half, tools, the registry, wiring, the compile-time guarantees, the runtime's pending state |

## The menu

A menu bar under the header has **Home** (the welcome screen), **Tutorial**
(both tutorials' steps) and **Lesson** (every lesson, by part). The menu isn't a
surface, so a choice reaches the server the way typing does: it sends a message
such as “Open lesson 1.3”, and the guide shows what was asked for. The menu's
contents come from `/menu.json`, built from the course and the tutorials when
the server starts.

## The tutorials

HaiKIT's two tutorials are built in:

| Tutorial | Pages | What it builds |
| --- | --- | --- |
| *Build a haikit app* | `intro`, `01`–`10`, `next-steps` | Hello, World! in whichever language the world picks |
| *Tell them later* | `2-intro`, `2-01`–`2-09`, `2-next-steps` | the same app, speaking up after the request is over: progress, notices, wake turns and live updates |

Each page is one the visitor reads in the app, with the tutorial's code (each
file labelled, numbered lines linked to their notes), callouts, and Previous /
Next buttons; the first tutorial's last page leads on to the second. Each page
is a HaiKIT surface: the browser holds the whole page, and the model gets a
short digest of it. The welcome screen's Tutorial panel lists the first
tutorial's steps and offers the second after it, and the course map lists
both.

`content/tutorial.md` and `content/tutorial-2.md` are copies of
`docs/tutorial.md` and `docs/tutorial-2.md` from the haikit repository, so the
app stays self-contained. The server parses them when it starts
(`src/server/tutorial.ts`), and stops with the line it couldn't read if a
tutorial ever uses Markdown the parser doesn't know. To pick up the latest:

```bash
npm run tutorial:update   # fetches both tutorials from GitHub, then runs npm test
```

## Run it

Needs Node 22.18 or later (it runs TypeScript directly, with no build step).

```bash
npm install
npm start                # http://localhost:5180
```

With no API key it uses a scripted guide, so anyone can take the course at no
model cost. To use Claude as the guide:

```bash
ANTHROPIC_API_KEY=… npm start
```

The guide runs Claude Haiku 5.5 (`claude-haiku-5-5`) at low effort: fast and
cheap, and suited to a guide's short replies and quick tool calls. Set
`HAI_MODEL` to use another model, for example `HAI_MODEL=claude-sonnet-5-5`.

`npm run dev` restarts the server when a file changes.

## Test it

```bash
npm test
```

That runs two checks:

- **`npm run typecheck`** compiles the server and the browser components
  against the shared contract. It also compiles `test/guarantees.ts`, which
  breaks haikit's rules on purpose; if a haikit release ever stopped
  rejecting one of those lines, the typecheck fails.
- **`npm run smoke`** boots the server and drives the course the way a learner
  does: the welcome screen on start and both of its choices, the course map,
  opening a lesson, answering a checkpoint, typing instead of answering, a
  glossary lookup through `query_ui`, every lesson rendering, and every page
  of both tutorials, reached from the welcome screen, the map, the menu and by
  typing.

## Which haikit it runs

**Always run the newest [`@haikit/*`](https://www.npmjs.com/search?q=haikit)
release.** The introduction teaches HaiKIT by running it, so an older release
teaches an older HaiKIT. After every release, update, then deploy:

```bash
npm run haikit:update    # installs @haikit/*@latest, then runs npm test
```

Commit `package.json` and `package-lock.json` together. The lockfile records
the exact versions, and the image installs from it with `npm ci`, so a
deployment runs whatever the lockfile says. The header shows the version the
server is running (also at `/version.json`), and CI's daily `latest` job checks
that the app still passes on the newest release.

Part 2 quotes real code instead of pasting it: this app's own files (between
`#region` markers) and the installed haikit packages, such as `Pending` from
`@haikit/core` and the click checks from `@haikit/server`. The quotes are read
when the server starts, so a lesson always shows the code that is actually
running. If an upgrade moves a quoted region, the server refuses to start and
names the selector to fix in `src/server/course/`.

## Deploy

Deploy on the newest haikit: run `npm run haikit:update` first (see
[Which haikit it runs](#which-haikit-it-runs)). Then build the image from this
folder:

```bash
docker build -t haikit-intro .
docker run -p 8080:8080 haikit-intro
```

Any container host works: point it at this folder's `Dockerfile`. The server
listens on `PORT` (8080 in the image), and `GET /healthz` returns `ok`.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `5180`, or `8080` in the image | Port to listen on |
| `ANTHROPIC_API_KEY` | unset | When set, Claude is the guide. Unset, the scripted guide is |
| `HAI_SCRIPTED` | unset | `1` uses the scripted guide even when a key is set |
| `HAI_MODEL` | `claude-haiku-5-5` | Which Claude model guides. Empty means the default |
| `DATABASE_URL` | unset | Postgres connection string. When set, conversations are stored with `@haikit/postgres` and survive restarts. Its tables are created on startup |

Without `DATABASE_URL` the course uses `memoryStore()`, which is meant for
development: conversations are lost on restart and never evicted, and every
page view starts one. For a public deployment, give it a database.

## Layout

```
src/shared/surfaces.ts     the contract: welcome, course_map, lesson, checkpoint, next_lesson,
                           tutorial_step
src/server/surfaces.ts     digests, the action handlers, the glossary query
src/server/tools.ts        welcome (init), show_welcome, show_course_map, show_lesson,
                           ask_checkpoint, offer_next_lesson, show_tutorial_step
src/server/scripted.ts     the scripted guide, a ModelAdapter
src/server/course/         the lessons, the introduction, the glossary and the answer key
src/server/excerpts.ts     reads the code the lessons quote
src/server/tutorial.ts     reads content/tutorial.md and tutorial-2.md into the tutorials' pages
src/server/main.ts         createHai, routes, static files
public/                    the page, the components, the header menu, the styles, the HaiKIT logo,
                           the welcome screen's diagram and illustrations
test/guarantees.ts         what haikit refuses to compile, quoted by lesson 2.7
test/smoke.mjs             the end-to-end check
content/tutorial.md        HaiKIT's tutorials, copied from the haikit repository
content/tutorial-2.md
scripts/update-tutorial.mjs  refreshes those copies
```

## Adding a part

Write `src/server/course/part3.ts` in the shape of `part2.ts`, add it to
`PARTS` in `src/server/course/index.ts`, and add any new terms to `GLOSSARY`.
The scripted guide learns lesson ids from the course map's digest, so it needs
no changes. Quote code with `excerpt` blocks rather than pasting it, so the
lesson stays true to the code.
