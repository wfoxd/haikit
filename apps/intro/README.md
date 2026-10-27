# Introducing HaiKIT

HaiKIT's introduction, built with [HaiKIT](https://github.com/wfoxd/haikit):
what an elicitation app is, and how HaiKIT builds whole apps with an LLM. This
folder is a complete, self-contained app: copy it anywhere, install, and run.
It depends only on the published `@haikit/*` packages.

The introduction is a HaiKIT conversation. It opens on a welcome screen that asks
where to begin, lesson 1.1 or the course map. Before the question, it tells the
story of HaiKIT for someone meeting it for the first time, a junior developer or
a product manager, in five numbered sections under the lede, "AI drives the
software. You steer.":

1. **The idea.** Software today, which people drive through screens of menus,
   forms and buttons, beside software HaiKIT builds, where you say what needs
   to be done and the AI does the steps. Each side has a drawing.
2. **Not a chatbot.** A chatbot added beside an app's screens against an app
   built with HaiKIT: the same request in each, then a row for each
   difference (who works the app, how the AI answers, how you answer back,
   what the AI reads, when it speaks).
3. **How it works.** The [Rebook](https://rebook.haikit.app/) demo in six
   steps on a timeline. Each step's scene draws what you'd see: the AI's
   words, your clicks, and Rebook's own components, drawn small under the
   tool that rendered them (the trip card, the options, the seat map, the
   night's question, the boarding pass; `src/client/drawings/Minis.tsx`). Then a link to
   try it, and, for developers, the diagram of how a HaiKIT app works.
4. **Fewer tokens.** How HaiKIT keeps the AI's bill small: a meter for two
   measured examples (a flight search's 47 results, about 1,958 tokens on
   screen and 67 for the AI; Rebook's 14 options, about 665 and 135), the six
   ways it saves tokens, and a pointer to the Context drawer, which counts this
   page's tokens.
5. **Why it matters.** What you get, for the people who use the software and for
   the team that builds it.

It ends with **Start here**: three ways in, side by side where there's room.
**Course** names its two parts and starts lesson 1.1 or opens the course map;
**Tutorials** lists HaiKIT's three tutorials in order, each opening right
here; **Reference** has a button for each page of HaiKIT's reference manual. The text lives in
`src/server/course/index.ts`, and the drawings are SVG, drawn by React
components in `src/client/drawings/`: the illustrations, the architecture
diagram, and Rebook's components, drawn small. A welcome saved before this
layout (version 10 or earlier), before the chatbot comparison (version 11), or
before the tokens section (version 12) still renders as it was; one saved
before the walkthrough drew Rebook's components (version 13) shows its four
steps, words only, on the same timeline.

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

## The contents

A rail beside the chat lists the whole introduction: the welcome screen and
the course map, every lesson by part, every page of each tutorial, every page
of the reference manual, and apps built with HaiKIT. The page on screen is
marked, and its group opens with it; every page the conversation has shown
has a tick, and each group counts them. That comes from the conversation
itself, from the surfaces it has shown, so a page opened by typing or by a
button on another page is ticked too, and **New chat** starts with none.

The rail isn't a surface, so a choice reaches the server the way typing does:
it sends a message such as “Open lesson 1.3”, “Open tutorial page 3-intro” or
“Open reference page surfaces”, and the guide shows what was asked for. A
demo is the exception: it's a site of its own, such as
[Rebook](https://rebook.haikit.app/), so its item is a link that opens it in a
new tab, and nothing reaches the conversation. The rail's contents come from
`/menu.json`, built from the course, the tutorials, the manual and the list of
demos in `src/server/course/index.ts` when the server starts.

mountChat draws the page's shell, so `src/client/main.tsx` gives the rail a
column at the start of the shell's grid, and its **Contents** button a place
at the start of the header (`src/client/contents.tsx`). On a screen 1100px or
wider the rail sits beside the chat, open until the reader closes it, which
the browser remembers under `intro:contents`. On a narrower one it's a
shadcn/ui sheet that slides over the chat from the left: a choice, Escape or
a click outside closes it.

## Who's reading

The header shows how many people have the introduction open right now:
*12 reading now*. It's HaiKIT's presence and signals at work. The server
hears the count from `hai.onPresence`, which counts conversations with an
events stream open, on every server sharing the store. It sends the count at
most every few seconds, as the `online` signal (`src/shared/signals.ts`), to
every open tab. A signal is never stored and never reaches the guide's
context or the transcript: the page reads it with `chat.subscribe` and shows
the latest count (`src/client/online.tsx`). A tab that closes still counts for a few seconds, so a
reconnect doesn't make the number flicker. A server that has just started
waits ten seconds before sending its first count, until it has heard the
other servers', so it never shows every tab a number that leaves theirs out.
Behind a corporate proxy that holds the events stream back (Netskope, Zscaler),
the page polls instead, so the count still arrives, a little later.

## Signing in

Given a Google client, the introduction lets a reader sign in with Google,
and only if they want to: signed out, it's as it is without one. **Sign in**,
at the end of the header, goes to Google and back. Signed in, the header
names the reader and offers **Sign out**, the welcome greets them by name,
and the conversations they start are theirs alone: to anyone else who has
one's id, signed out or signed in as someone else, it doesn't exist. A
conversation started signed out is anyone's who has its id, as every
conversation is without sign-in, and the reader can carry on in it once
they've signed in. Signing in or out leaves the page, so the conversation
after it is a new one. A sign-in that comes back without one, cancelled at
Google say, says why beside **Sign in**.

It's `@haikit/auth`, with `google()` from `@haikit/auth/oidc`, as the third
tutorial's step 10 builds it, but with a gate of the intro's own
(`src/server/auth.ts`), since the tutorial's turns away anyone who isn't
signed in. A request without a token is let in as anyone. One with a token
goes to auth's own gate, which checks it, and where it came from. A
conversation no one owns is anyone's, and one started signed in is claimed
for its reader.

The intro asks Google for `openid` and `profile`: the reader's Google id and
name, and no email address. Signed in, the reader is `google:<sub>`, and
their name is in their token. The gate notes it as their requests arrive,
and the welcome looks it up by the conversation's owner. The guide never
sees it: the welcome's digest leaves it out.

With `DATABASE_URL`, who owns which conversation is kept in Postgres beside
the conversations, with `@haikit/auth/postgres`. In memory, a restart would
forget the owners and leave the conversations in the database open to anyone
with their ids. A deployment with a database that loses its Google client
keeps those conversations closed, until there's a client again for their
readers to sign in with. The variables are in [Deploy](#deploy). Locally, a Google
client whose redirect URI is `http://localhost:5180/auth/google/callback`
is all it takes:

```bash
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm start
```

## The tutorials

HaiKIT's three tutorials are built in:

| Tutorial | Pages | What it builds |
| --- | --- | --- |
| *Build a haikit app* | `intro`, `01`–`10`, `next-steps` | Hello, World! in whichever language the world picks |
| *Tell them later* | `2-intro`, `2-01`–`2-09`, `2-next-steps` | the same app, speaking up after the request is over: progress, notices, wake turns and live updates |
| *Who's asking* | `3-intro`, `3-01`–`3-10`, `3-next-steps` | the same app, signed in with `@haikit/auth`: a login, a gate that keeps each person to their own conversations, sign out everywhere, and sign in with Google |

Each page is one the visitor reads in the app, with the tutorial's code (each
file labelled, numbered lines linked to their notes), callouts, and Previous /
Next buttons; each tutorial's last page leads on to the next. Each page is a
HaiKIT surface: the browser holds the whole page, and the model gets a short
digest of it. The welcome screen lists the three tutorials, and the course
map and the contents rail list every page of each.

`content/tutorial.md`, `content/tutorial-2.md` and `content/tutorial-3.md` are
copies of `docs/tutorial.md`, `docs/tutorial-2.md` and `docs/tutorial-3.md`
from the haikit repository, so the app stays self-contained. The server parses them when it starts
(`src/server/tutorial.ts`), and stops with the line it couldn't read if a
tutorial ever uses Markdown the parser doesn't know. To pick up the latest of
the tutorials and the reference manual:

```bash
npm run docs:update   # fetches them from GitHub, then runs npm test
```

## The reference manual

HaiKIT's reference manual is built in too: all 19 pages of `docs/reference/`,
from the contents (`index`) to *Configuration and limits*, in the order the
contents lists them. Each page is a `reference_page` surface, like a tutorial
page: the browser holds the whole page, about 8,000 tokens for *Surfaces*,
and the model gets a digest of about 165: the page's title, how it opens, its
sections, and a `find` query for the rest. Each answer from `query_ui` names
the section it comes from, so the guide can answer an exact API question from
the manual itself.

A page waits for the reader, as a tutorial page does. A link to a section of
the same page scrolls there in the browser. A link to another page, or
Previous, Next or Contents at its foot, is the page's answer: the guide shows
the page it names, opened at the section the link points to. A page goes only
where its own links and buttons lead, and once the reader has moved on, its
links to other pages are plain text again. The welcome screen's Reference,
the contents rail, and typing “reference” or “reference page tools” open a page
too.

`content/reference/` is a copy of `docs/reference/`, refreshed by
`npm run docs:update` with the tutorials. The server reads it when it starts
(`src/server/reference.ts`), rewriting each link into a target the browser
follows without resolving a path, and checks every link. A link to a page or
a section that doesn't exist, or Markdown the parser doesn't know, stops the
server with the page, the line and the link.

## The page

The browser half is React with [shadcn/ui](https://ui.shadcn.com), as the
tutorials build theirs. Each surface is a React component, registered in
`src/client/components.tsx` with `reactSurface` from `@haikit/react`; lesson
2.5 quotes the checkpoint's from there. The pages of a lesson, a tutorial
and the manual are drawn from the same blocks (`src/client/blocks/`), and
the welcome screen and the rest from `src/client/surfaces/`. Every one of
them writes the guide's payloads as text, never as HTML.

The buttons, cards, badges, the sheet, tables, callouts and the compare picker are
shadcn/ui components in `src/client/components/ui/`, from
`npx shadcn@latest init -b radix -p lyra` and `npx shadcn@latest add`, and
`components.json` is there so `add` works in this folder. They're the app's
code now, to read and change.

`src/client/globals.css` is the whole stylesheet: Tailwind with its preflight,
the default UI's stylesheet through `@haikit/client/tailwind.css`, and
shadcn's. It sets the course's palette as HaiKIT's `--hai-*` tokens, a value
for light and one for dark, and points shadcn's colours at them, so the
surfaces follow the chat into light and dark, and `dark:` follows the chat's
`data-hai-theme` pin. The palette follows the dual channel: the accent (cobalt)
is what the model receives, good (teal) is what stays in the browser, warn
(amber) is a turn parked on a person.

## Run it

Needs Node 22.18 or later. The server runs its TypeScript directly, with no
build step; the page is built with Vite and Tailwind.

```bash
npm install
npm start                # http://localhost:5180
```

`npm start` runs Vite inside the server, on the same port, so a change to the
components, the contents rail or the styles shows at once. To run the built page, as
the container does: `npm run build`, then `NODE_ENV=production npm start`.

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

That runs three checks:

- **`npm run typecheck`** compiles the server and the browser components
  against the shared contract. It also compiles `test/guarantees.ts`, which
  breaks haikit's rules on purpose; if a haikit release ever stopped
  rejecting one of those lines, the typecheck fails.
- **`npm run clienttest`** mounts every surface in the registry with React in
  a DOM (jsdom), from the props the server builds and from the shapes older
  versions saved (welcomes back to version 2, course maps back to 1). It
  checks each click sends its declared action and value, that a frozen
  surface offers nothing, that every kind of block draws, and that markup in
  a payload stays text. It mounts the contents rail too, wide and narrow:
  what it lists, the message each choice sends, and which page it marks. And
  the header's sign-in: signed out, signed in, and back from a sign-in that
  failed.
- **`npm run smoke`** builds the page, boots the server on it as the container
  does, and drives the course the way a learner does: the welcome screen on start and both of its choices, the course map,
  opening a lesson, answering a checkpoint, typing instead of answering, a
  glossary lookup through `query_ui`, every lesson rendering, and every page
  of every tutorial, reached from the welcome screen, the map, the rail and by
  typing. For the reference manual: every page rendering with nothing in its
  Markdown lost, every one of its links leading to a page and a section that
  exist, a page going only where its links lead, and `find` naming the
  section of each answer. Then it boots a second server with a Google client
  and signs in as Google would leave a reader, with tokens it makes itself:
  the welcome greets them by name, their conversation is no one else's, one
  started signed out is anyone's, and a token the server didn't sign, or a
  cookie sent from another site, is refused. Nothing reaches Google.

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

Any container host works: point it at this folder's `Dockerfile`. It builds
the page with Vite in a first stage, and the image serves what that wrote to
`dist/`. The server listens on `PORT` (8080 in the image), and `GET /healthz`
returns `ok`.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `5180`, or `8080` in the image | Port to listen on |
| `ANTHROPIC_API_KEY` | unset | When set, Claude is the guide. Unset, the scripted guide is |
| `HAI_SCRIPTED` | unset | `1` uses the scripted guide even when a key is set |
| `HAI_MODEL` | `claude-haiku-5-5` | Which Claude model guides. Empty means the default |
| `DATABASE_URL` | unset | Postgres connection string. When set, conversations are stored with `@haikit/postgres` and survive restarts, and with sign-in, who owns which with `@haikit/auth/postgres`. Their tables are created on startup |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | A Google Cloud OAuth client, of type Web application. When both are set, a reader can sign in with Google (see [Signing in](#signing-in)). Unset, no one signs in, and there are no `/auth` routes |
| `GOOGLE_REDIRECT_URI` | `http://localhost:<PORT>/auth/google/callback`, and none in production | This site's `/auth/google/callback`, exactly as registered with the client, such as `https://intro.example.com/auth/google/callback`. Required in production with a Google client: the server won't start without it |
| `HAIKIT_AUTH_SECRET` | a new random one each run, and none in production | Signs the readers' tokens: at least 32 bytes, such as `openssl rand -base64 32`. With a random one, every sign-in ends when the server stops. Required in production with a Google client: the server won't start without it |

Without `DATABASE_URL` the course uses `memoryStore()`, which is meant for
development: conversations are lost on restart and never evicted, and every
page view starts one. For a public deployment, give it a database.

## Redeploy

How to ship a new version to a server that runs the image with Docker, beside
a Postgres container. The names below are examples. Use your own server, and
the folder and Docker network your deployment already uses. Here the app lives
in `/opt/haikit-intro`, and its database is a container on the network
`haikit-intro_default`.

**1. Prepare the release**, on your machine, in this folder. Move to the newest
haikit, and pick up the latest tutorials and reference manual if they changed.
Each command runs `npm test` when it finishes; commit what changes.

```bash
npm run haikit:update
npm run docs:update
```

**2. Copy the folder to the server.** `node_modules` is installed in the image,
and the server keeps its own `.env`, so leave both out. `--delete` removes
files deleted here, but never the ones excluded, so the server's `.env` stays.

```bash
rsync -avz --delete --exclude node_modules --exclude .env ./ user@your-server:/opt/haikit-intro/
```

**3. Rebuild the image and replace the container.** Tag the running image
first, so a bad release can be rolled back. The conversations are in Postgres,
so replacing the container keeps them.

```bash
cd /opt/haikit-intro
docker tag haikit-intro haikit-intro:previous
docker build -t haikit-intro .
docker rm -f haikit-intro
docker run -d --name haikit-intro --network haikit-intro_default --restart unless-stopped --env-file .env -p 8080:8080 haikit-intro
```

**4. Check it.** The startup line names the haikit version, the model and the
store, and should end with `store=postgres`. `/healthz` answers `ok`, and
`/version.json` has the version the server is running.

```bash
docker logs haikit-intro
curl -s http://127.0.0.1:8080/healthz
```

To roll back, run the same `docker run` with `haikit-intro:previous` as the
image, after `docker rm -f haikit-intro`.

### The server's `.env`

The settings in the table above live in `/opt/haikit-intro/.env`, one
`NAME=value` per line, and reach the app through `--env-file`. The app doesn't
read `.env` itself, so a container started without `--env-file` runs the
scripted guide on `memoryStore()`.

- **`DATABASE_URL`** names the database by its container or Compose service
  name on the shared network, such as `postgres://intro:<password>@db:5432/intro`,
  not `localhost`: inside the app's container, `localhost` is the app itself.
  The app container must join that network (`--network`).
- **`--env-file` doesn't expand `${…}`.** Write each value out in full, the
  database password in `DATABASE_URL` included.
- **Keep each value on one line.** A key broken across two lines is read only
  up to the break.
- **It holds secrets**: the API key, the database password, the Google
  client's secret and `HAIKIT_AUTH_SECRET`. Keep it out of
  the repository, and don't print it to share a problem. Check a setting is
  there with `grep -c '^DATABASE_URL=' .env`, which prints a count, not the value.

If the deployment runs the app as a service in a Compose file, run
`docker compose up -d --build` in its folder instead of step 3's `docker rm` and
`docker run`.

## Layout

```
src/shared/surfaces.ts     the contract: welcome, course_map, lesson, checkpoint, next_lesson,
                           tutorial_step, reference_page
src/shared/signals.ts      the online signal: how many people are reading now
src/server/surfaces.ts     digests, the action handlers, the glossary and find queries
src/server/tools.ts        welcome (init), show_welcome, show_course_map, show_lesson,
                           ask_checkpoint, offer_next_lesson, show_tutorial_step,
                           show_reference_page
src/server/scripted.ts     the scripted guide, a ModelAdapter
src/server/course/         the lessons, the introduction, the glossary and the answer key
src/server/excerpts.ts     reads the code the lessons quote
src/server/tutorial.ts     reads content/tutorial.md, tutorial-2.md and tutorial-3.md into the tutorials' pages
src/server/reference.ts    reads content/reference/ into the manual's pages, and checks its links
src/server/auth.ts         signing in with Google, when there's a Google client, and the gate that
                           lets anyone in and keeps a signed-in reader's conversations theirs
src/server/main.ts         createHai, routes, the page: through Vite while developing, from dist/
                           in production
index.html                 the page
src/client/main.tsx        mounts the chat, the contents rail, the reading-now chip and the sign-in
src/client/components.tsx  the registry: a React component for each surface, the checkpoint's here
src/client/surfaces/       the welcome screen, the course map, a lesson, a tutorial page, a
                           reference page and Up next
src/client/blocks/         the blocks those pages are made of: text, code, notes, tables, the
                           compare picker and the sequence diagram
src/client/drawings/       the HaiKIT logo, the welcome screen's diagram and illustrations, and
                           Rebook's components drawn small
src/client/contents.tsx    the contents rail
src/client/online.tsx      the reading-now chip
src/client/account.tsx     the header's sign-in: Sign in, or the reader's name and Sign out
src/client/components/ui/  shadcn/ui's components
components.json            where `npx shadcn@latest add` puts a component, and the style it's in
src/client/globals.css     Tailwind with its preflight; the default UI, through
                           @haikit/client/tailwind.css; shadcn's; the course's palette
public/icon.svg            the icon, copied into dist/ as it is
vite.config.ts             the page's build
test/guarantees.ts         what haikit refuses to compile, quoted by lesson 2.7
test/clienttest.mjs        every surface, the contents rail and the sign-in in a DOM, from today's props
                           and older saved ones
test/smoke.mjs             the end-to-end check
content/tutorial.md        HaiKIT's tutorials, copied from the haikit repository
content/tutorial-2.md
content/tutorial-3.md
content/reference/         HaiKIT's reference manual, copied from the haikit repository
scripts/update-docs.mjs    refreshes those copies
```

## Adding a part

Write `src/server/course/part3.ts` in the shape of `part2.ts`, add it to
`PARTS` in `src/server/course/index.ts`, and add any new terms to `GLOSSARY`.
The scripted guide learns lesson ids from the course map's digest, so it needs
no changes. Quote code with `excerpt` blocks rather than pasting it, so the
lesson stays true to the code.
