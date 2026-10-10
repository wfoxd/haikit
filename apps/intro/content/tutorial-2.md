# Tell them later

> The hello app from the first tutorial, taught to speak up after the request is over: progress while a tool works, a notice when a job finishes, a turn the model starts by itself, and a picker that changes while the user looks at it. Nine steps, annotated line by line.

## Hello, later — the app speaks up after the request is over

Everything in the first tutorial happens inside a request. The user sends something, a turn runs, and the stream closes. Real apps also have things to say *afterwards*: the payment cleared, the parcel arrived, the price moved. haikit has one channel for all of them, and this tutorial adds each kind to the hello app.

Pick a greeting, and the app now mails it as a postcard to your pen pal Sam. A little later the post office confirms delivery, Sam writes back, and translators add a language to a picker you haven't answered yet. None of that is a reply to a request: the server says it on its own, and the browser and the model each hear it their own way.

| What | Who starts it | The browser sees | The model hears |
| --- | --- | --- | --- |
| **progress** | a tool, while it runs | its tool row filling in | nothing |
| **notice** | your code, any time | a notice beside a surface | its text, with the user's next message |
| **wake notice** | your code, any time | the notice, then the model's reply | its text, in a turn of its own, at once |
| **update** | your code, any time | the surface changing in place | which handle replaced which, and the new digest |

You need the app as the first tutorial left it, through step 08: the greeting picker, the greeting card, and the scripted model if you used it. Everything here runs in the same `haikit_hello/` folder.

> [!NOTE]
> **One stream for the browser, one rule for the model**
>
> A request's own stream closes when its turn ends, so the server needs another way to reach the browser. With notices registered, the browser opens a second stream, `GET /hai/events`, and keeps it open. Everything in steps 02 to 08 travels on it.
>
> The model is different. It is never interrupted mid-thought: what the server says joins the history as a user message, so the model reads it exactly when it would read anything else the user said.

## 01 · Show progress while a tool works

Start inside a request. A tool that takes a few seconds leaves the user staring at a row that says *running…*. `ctx.progress` lets the tool say how far it has got. It only touches the browser: the model never sees a progress report, so it costs no tokens.

Pretend asking for the greetings takes a moment, as asking a real translation service would.

**`src/server/tools.ts`** — *edit*

```ts
const BATCHES = 4;                                        // 1

export const listGreetings = defineTool({
  // ...name, description, input and inputJsonSchema unchanged
  async run(_input, ctx) {
    ctx.progress({ message: "Asking the translators", done: 0, total: BATCHES });  // 2
    for (let done = 1; done <= BATCHES; done++) {
      await new Promise((r) => setTimeout(r, 150));       // 3
      ctx.progress({ done });                             // 4
    }

    return ctx.render(greetingPickerServer, { greetings: GREETINGS }, { mode: "elicit" });
  },
});
```

**1** Four batches, so there is something to count. A real tool reports whatever it actually counts: files read, rows fetched, pages scraped.

**2** A message and a bar. `done` and `total` draw the bar; `message` is the words beside it. Every field is optional.

**3** Stands in for the slow part. Nothing about progress needs the work to be async, but a tool that blocks the event loop can't send anything while it does.

**4** Only the fields that changed. Each call is merged into what the row already shows, so the message stays while the count moves.

The runtime does the rest. A tool that reports on every row of a million can't flood the stream: frames go out at most every 100 ms, carrying everything named since the last, and the final one always goes out before the row says the call has finished.

> [!TIP]
> **Checkpoint**
>
> Restart and say *“greet me”*. Before the picker appears, the **list_greetings** row reads *Asking the translators* and its bar fills in four steps. Open **Context**: nothing about translators is in the model's context.

## 02 · Declare the notices

A notice is something the server tells a conversation outside of any request. It is declared like a surface, in a module both halves import: the server implements and sends it, the browser renders it.

**`src/shared/notices.ts`** — *new file*

```ts
import { defineNotice } from "@haikit/core";             // 1
import { z } from "zod";

/** The postcard reached the pen pal. A passive notice: it waits for the user. */
export const postcardDelivered = defineNotice({
  name: "postcard_delivered",                             // 2
  version: 1,
  payload: z.object({                                     // 3
    to: z.string(),
    language: z.string(),
    text: z.string(),
    reference: z.string(),
  }),
});
```

**1** The one constructor this file needs. A notice declares no actions and no queries: nothing in it reaches back to the server.

**2** The registry key, as with a surface. The browser looks the component up by this name in step 05, and the model reads it in step 06.

**3** What the browser gets. It is validated before it is stored, because notices are usually sent from a webhook or a job queue, whose data comes from outside your process.

Notices and surfaces have separate registries, so a notice can share a name with a surface without either noticing.

## 03 · Implement the server half

Like a surface's `digest`, a notice's `model` function is required, and for the same reason: it is all the model ever hears of the notice.

**`src/server/notices.ts`** — *new file*

```ts
import { postcardDelivered } from "../shared/notices.ts";

export const postcardDeliveredServer = postcardDelivered.implement({
  model: (p) => `The postcard to ${p.to} was delivered: "${p.text}" (${p.language}). Reference ${p.reference}.`,  // 1
});
```

**1** Written for the model, from the validated payload. Return `null` for a notice the model has no use for, such as a typing indicator: the browser still shows it, and nothing reaches the model.

Then register it, the way surfaces are registered. A notice that isn't listed is refused when you send it, as an unregistered surface is when you render it.

**`src/server/main.ts`** — *edit*

```ts
import { postcardDeliveredServer } from "./notices.ts";

const hai = createHai({
  // ...model, store, tools and surfaces unchanged
  notices: [postcardDeliveredServer],                     // 1
});
```

**1** Listing any notice does two things: `hai.notify` accepts it, and the `hello` event tells the browser to open the events stream.

## 04 · Send one when the work is done

The post office stands in for a real service with a webhook. Posting a card returns at once; delivery is confirmed later, long after the request that posted it has finished. That is exactly where `hai.notify` is for.

**`src/server/postOffice.ts`** — *new file*

```ts
import type { Notify } from "@haikit/core";
import type { Greeting } from "../shared/surfaces.ts";
import { postcardDeliveredServer } from "./notices.ts";

const PEN_PAL = "Sam";
const DELIVERY_MS = 2_000;

let notify: Notify | null = null;                         // 1

/** Called once at startup with `hai.notify`. */
export function connectPostOffice(send: Notify) {
  notify = send;
}

/** Post `greeting` to the pen pal. Delivery is confirmed beside `handle`. */
export function sendPostcard(conversationId: string, handle: string, greeting: Greeting) {
  const reference = `PC-${Math.floor(1000 + Math.random() * 9000)}`;
  setTimeout(() => {                                      // 2
    notify?.(
      conversationId,                                     // 3
      postcardDeliveredServer,                            // 4
      { to: PEN_PAL, language: greeting.language, text: greeting.text, reference },  // 5
      { handle },                                         // 6
    ).catch((err) => console.error(`delivery for ${conversationId} not sent: ${err.message}`));  // 7
  }, DELIVERY_MS);
  return { to: PEN_PAL, reference };
}
```

**1** Handed in at startup rather than imported, so this module doesn't depend on `main.ts`, which imports it. `Notify` is the type of `hai.notify`.

**2** The webhook arriving. In a real app this is a route your server exposes, or a worker reading a queue; here it is a timer.

**3** Which conversation to tell. Store it next to whatever you asked the outside service to do, so the callback can find it again.

**4** The implementation, not the contract, as with `ctx.render`. The payload's type comes from it, so a misspelt field is a compile error.

**5** Checked against the schema from step 02 before it is stored. A payload that fails is refused, and nothing reaches anyone.

**6** Optional: a surface to show the notice beside. Without it, the notice goes at the end of the transcript.

**7** `notify` returns a promise, and a timer has nobody to hand a rejection to. Catch it, or one bad payload becomes an unhandled rejection.

`hai.notify` takes no lease. It works while a turn is streaming, while one is parked on a question, and with nobody connected: the notice is stored, numbered within its conversation, and delivered whenever someone is listening.

Now post a card when the user picks a greeting. An action handler gets the conversation and the surface's handle, which is everything `sendPostcard` needs.

**`src/server/surfaces.ts`** — *edit*

```ts
import { sendPostcard } from "./postOffice.ts";

export const greetingPickerServer = greetingPicker.implement({
  // ...digest and queries unchanged
  actions: {
    choose(code, { props, handle, conversationId }) {     // 1
      const g = props.greetings.find((x) => x.code === code);
      if (!g) return `Selection failed: unknown code ${code}.`;

      const rank = [...props.greetings].sort(bySpeakers)
        .findIndex((x) => x.code === code) + 1;
      // Posted now; delivery is confirmed later, as a notice beside this picker.
      const sent = sendPostcard(conversationId, handle, g);  // 2
      return (
        `Chose ${g.language}: "${g.text}". ${g.script} script, ` +
        `${g.rtl ? "right-to-left" : "left-to-right"}, ${g.speakersM}M speakers. ` +
        `Rank: #${rank} of ${props.greetings.length} by speakers. ` +
        `Posted it to ${sent.to} as a postcard, reference ${sent.reference}; delivery is not confirmed yet.`  // 3
      );
    },
  },
});
```

**1** Two more fields from the handler's context. `handle` is the picker the user clicked, so the delivery notice lands beside it.

**2** Runs only for the click the turn is waiting for: the first tutorial's step 03 explains why a handler can safely start real work.

**3** Tell the model what happened *and what hasn't yet*. Without the last clause, a model asked “did it arrive?” has every reason to say yes.

Finally, connect the post office at startup, and tell the model how postcards work:

**`src/server/main.ts`** — *edit*

```ts
import { connectPostOffice } from "./postOffice.ts";

const hai = createHai({
  // ...unchanged, then add to the end of `system`:
  system: `...
- Choosing a greeting posts it to the user's pen pal as a postcard. Delivery
  is confirmed later, as an [App notification: postcard_delivered]. Until one
  has arrived, do not say the postcard was delivered.`,
});
connectPostOffice(hai.notify);
```

## 05 · Show it in the browser

Notices have their own registry, an allowlist by notice name, next to the surfaces' one. A notice component looks like a surface component with less in it: it gets its payload and mounts, and it has no `send`, because nothing in a notice reaches back.

**`public/components.js`** — *append, after `registry`*

```js
/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").postcardDelivered.payload>} Delivered */  // 1

export const notices = {                                  // 2
  postcard_delivered: {                                   // 3
    /** @param {HTMLElement} el @param {Delivered} payload */
    mount(el, payload) {                                  // 4
      const text = h("span", "greeting", payload.text);   // 5
      text.dir = "auto";                                  // 6
      const line = h("div", "notice-line");
      line.append(h("span", null, `Delivered to ${payload.to}: `), text, h("span", "lang", payload.reference));
      el.append(line);
    },
  },
};
```

**1** The payload's type, read from the contract, as the first tutorial does for `Greeting`. Rename a field in step 02 and this file stops compiling, once `tsc` checks it: a `tsconfig.browser.json` with `allowJs`, `checkJs` and the `dom` library, as `examples/hello-notices` in the haikit repo has.

**2** A separate export, so the two allowlists never mix. A notice can't be mounted as a surface, or a surface as a notice.

**3** Must match the notice's `name`. An unlisted notice renders a small error card instead, as an unlisted surface does.

**4** Called once, when the notice arrives, with its validated payload. `mount` may return `{ unmount() }` if it sets up anything that outlives the element.

**5** `textContent` again, through `h`. A notice's payload came from outside your process; it never becomes markup.

**6** The greeting may read right to left, and the payload doesn't say. `dir="auto"` lets the browser decide from the text, so Arabic and Hebrew lay out correctly.

The transcript draws the frame: a label saying which notice it is, and a body your component fills. Give the line a little room:

**`public/styles.css`** — *append*

```css
.notice-line { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; padding: 9px 12px; }
.notice-line .greeting { font-size: 14px; }
```

And hand the registry to `mountChat`:

**`public/index.html`** — *edit*

```html
<script type="module">
  import { mountChat } from "/hai-client/app.js";
  import { notices, registry } from "./components.js";

  mountChat({
    root: document.querySelector("#app"),
    registry,
    notices,
    title: "hello",
    suggestions: ["greet me", "did my postcard arrive?"],
  });
</script>
```

> [!TIP]
> **Checkpoint**
>
> Restart, say *“greet me”*, and pick a language. Two seconds later a **postcard_delivered** notice appears under the picker: *Delivered to Sam*, the greeting, and its reference. The request finished long before it arrived.
>
> If the connection drops in the middle of it, nothing is lost: the browser reconnects with the last notice it saw, and the server sends whatever came after.

> [!WARNING]
> **If no notice appears**
>
> Check `main.ts` lists the notice in `notices`. Without any notice listed there is no events stream at all: the browser never opens one, and `hai.notify` refuses the notice with *not registered*, which the post office logs.

## 06 · What the model hears

The browser saw the notice at once. The model hasn't heard it yet, and won't until the conversation's history records something new. The next request that records a user message takes every unread notice in, ahead of what the user typed:

**`user message`** — *what the model receives next*

```text
[App notification: postcard_delivered] The postcard to Sam was delivered: "¡Hola, mundo!" (Spanish). Reference PC-4821.
did my postcard arrive?
```

That is a user message of two text blocks: the notice's `model` text, labelled with its name, then what was typed. Taking a notice in is recorded with the history, so a turn whose save is lost leaves it unread, and the next one takes it in. The model hears each notice exactly once.

A click carries notices too, after its tool results. A notice whose `model` returned `null` is shown and never heard.

If you're using the scripted model from the first tutorial, it reads only plain-string user messages. Teach it the new shape:

<details>
<summary>The scripted model, for notices</summary>

Two changes. The user message can now be blocks, with what they typed last. And a question about the postcard is answered from the notice's text, never from anything the scripted model knows on its own.

**`src/server/scripted.ts`** — *edit*

```ts
// in generate(), replace the line that reads the user's text
const typed = typeof last?.content === "string" ? last.content : (last?.content as any[] | undefined)?.at(-1)?.text;  // 1
const text = String(typed ?? "").toLowerCase();

// The latest notice of this name the history has taken in: its model text.
const latest = (name: string) => {
  const prefix = `[App notification: ${name}] `;          // 2
  const texts = messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as any[]) : []))
    .map((b) => b?.text)
    .filter((t): t is string => typeof t === "string");
  return texts.findLast((t) => t.startsWith(prefix))?.slice(prefix.length);
};

if (/arrive|deliver|postcard/.test(text)) {               // 3
  // the latest postcard posted, and whether its own delivery has arrived
  const posted = [...JSON.stringify(messages).matchAll(/reference (PC-\d+); delivery is not confirmed/g)].at(-1)?.[1];  // 4
  const delivered = latest("postcard_delivered");
  return say(
    delivered && (!posted || delivered.includes(posted)) ? `Yes. ${delivered}` : "Not yet. I'll tell you when it's delivered.",
    onTextDelta,
  );
}
```

**1** Notices ride ahead of what the user typed, as text blocks, so the typed text is the last block. A message with no notices is still a plain string.

**2** The label haikit puts in front of every notice's text, with the notice's name in it.

**3** Put this before the keyword branches, as the first tutorial does with `[ui interaction]`, so the question can't trigger a tool.

**4** Post a second card and ask before it's delivered, and the first card's notice is still in the history. Matching the reference `choose` returned keeps the answer about the card just posted.

And mention the postcard when greeting, from what `choose` returned:

**`src/server/scripted.ts`** — *edit*

```ts
// beside the other patterns at the top of the file
const POSTED = /Posted it to (\w+) as a postcard/;

// in the branch that answers a choice
const to = results.match(POSTED)?.[1];
const posted = to ? ` I've posted it to ${to} as a postcard.` : "";
return say(`${greeting}\n\n— ${where}.${dir}${posted}`, onTextDelta);
```

</details>

> [!TIP]
> **Checkpoint**
>
> Ask *“did my postcard arrive?”* before the notice appears, and the answer is *not yet*: the model has nothing that says otherwise. Ask again after it appears, and the answer quotes the reference. Open **Context**: the last user message starts with `[App notification: postcard_delivered]`.

## 07 · Let the model speak first

A passive notice waits for the user. Sometimes it shouldn't: Sam wrote back, and the model should say so without being asked. That is a **wake notice**: the same declaration, with `kind: "wake"`, and haikit starts a turn for it.

**`src/shared/notices.ts`** — *append*

```ts
/** The pen pal wrote back. A wake notice: the model hears it at once and tells the user. */
export const replyReceived = defineNotice({
  name: "reply_received",
  version: 1,
  kind: "wake",                                           // 1
  payload: z.object({
    from: z.string(),
    language: z.string(),
    text: z.string(),
  }),
});
```

**1** The only difference from step 02. `"passive"` is the default.

**`src/server/notices.ts`** — *append*

```ts
// add `replyReceived` to the existing ../shared/notices.ts import
import { postcardDelivered, replyReceived } from "../shared/notices.ts";

export const replyReceivedServer = replyReceived.implement({
  model: (p) => `${p.from} replied to the postcard, in ${p.language}: "${p.text}"`,  // 1
});
```

**1** Must return a string. A wake notice starts a turn, and the turn is the model's answer to this text, so `null` is a compile error here.

Register it, and send it a few seconds after delivery:

**`src/server/main.ts`** — *edit*

```ts
import { postcardDeliveredServer, replyReceivedServer } from "./notices.ts";

const hai = createHai({
  notices: [postcardDeliveredServer, replyReceivedServer],
  // ...unchanged, then add to the end of `system`:
  system: `...
- Notifications can arrive with no message from the user. Then tell the user,
  in one sentence, what changed for them.`,
});
```

**`src/server/postOffice.ts`** — *edit*

```ts
// add `replyReceivedServer` to the existing ./notices.ts import
import { postcardDeliveredServer, replyReceivedServer } from "./notices.ts";

const REPLY_MS = 5_000;
const THANKS: Record<string, string> = {
  en: "Thank you, lovely to hear from you!",
  zh: "谢谢你的明信片！",
  es: "¡Muchas gracias por la postal!",
  ar: "شكراً على البطاقة!",
  ja: "はがきをありがとう！",
  he: "תודה על הגלויה!",
  cy: "Diolch am y cerdyn post!", // the language the translators add
};

// in sendPostcard, after the delivery timer
setTimeout(() => {
  notify?.(
    conversationId,
    replyReceivedServer,
    { from: PEN_PAL, language: greeting.language, text: THANKS[greeting.code] ?? "Thank you!" },
    { handle },
  ).catch((err) => console.error(`reply for ${conversationId} not sent: ${err.message}`));
}, REPLY_MS);
```

And a component for it, beside the first:

**`public/components.js`** — *append inside `notices`*

```js
  reply_received: {
    // with `/** @typedef {import("@haikit/core").Infer<typeof import("../src/shared/notices.ts").replyReceived.payload>} Reply */` beside `Delivered`
    /** @param {HTMLElement} el @param {Reply} payload */
    mount(el, payload) {
      const line = h("div", "notice-line");
      const text = h("span", "greeting", payload.text);
      text.dir = "auto";                                  // 1
      line.append(h("span", null, `${payload.from} replied: `), text);
      el.append(line);
    },
  },
```

**1** The reply is in the postcard's language, which may read right to left, so it gets `dir="auto"` too.

Nothing else changes. The turn runs where a browser is watching: the events stream, holding the conversation's connection, takes the lease and streams the turn down that same connection. The user message it records carries every unread notice, then a line saying the user hasn't said anything:

**`user message`** — *what the model receives in a wake turn*

```text
[App notification: reply_received] Sam replied to the postcard, in Spanish: "¡Muchas gracias por la postal!"
[The user has not said anything. The notifications above arrived on their own.]
```

A wake notice doesn't start a turn when that would be wrong, and then it rides the user's next message instead, as a passive one does:

- nobody is watching: a browser that connects later starts it
- a question is waiting for an answer: a user message there would arrive before the answer
- the conversation hasn't begun, or is out of date
- it's past `maxWakes`, by default one wake turn a minute per conversation

A tool that sends a wake notice from inside a wake turn can't loop for ever: the limit is what stops it. Raise it, if your app needs to, with `createHai({ maxWakes: { count: 3, perMs: 60_000 } })`.

<details>
<summary>The scripted model, for wake turns</summary>

A wake turn's user message ends with the line above, so the scripted model can tell it from a message the user typed.

**`src/server/scripted.ts`** — *edit*

```ts
// before the postcard question, using `latest` from step 06
if (text.startsWith("[the user has not said anything")) {  // 1
  const reply = latest("reply_received");
  return say(reply ? `Heads up: ${reply}` : "Something changed; nothing you need to do.", onTextDelta);
}
```

**1** Lower-cased, like everything `text` holds.

</details>

> [!TIP]
> **Checkpoint**
>
> Pick a language and wait. Delivery appears after two seconds; after five, a **reply_received** notice appears, and straight under it the model speaks without being asked: *Heads up: Sam replied to the postcard…* While it does, the message box waits, and frees up once the turn has let the conversation go.

## 08 · Change a surface while it's on screen

The last kind of news isn't a new thing to show; it's a change to something already showing. Translators add a language while the user is still looking at the picker. Rendering a second picker would lose the user's filter and leave a stale one behind. `hai.update` revises the picker in place instead.

> [!NOTE]
> **Needs HaiKIT 0.18 or later**
>
> `hai.update` arrived in 0.18. If your project installed an older release, update first: `npm install @haikit/core@latest @haikit/server@latest @haikit/client@latest @haikit/anthropic@latest`. Upgrade all four together, so they share one copy of `@haikit/core`.

**`src/server/translators.ts`** — *new file*

```ts
import type { Update } from "@haikit/core";
import type { Greeting } from "../shared/surfaces.ts";
import { greetingPickerServer } from "./surfaces.ts";

const ADDED: Greeting = { code: "cy", language: "Welsh", text: "Helo, Fyd!", script: "Latin", rtl: false, speakersM: 0.9 };
const TRANSLATE_MS = 6_000;

let update: Update | null = null;                         // 1

/** Called once at startup with `hai.update`. */
export function connectTranslators(revise: Update) {
  update = revise;
}

/** A little after the picker `handle` is shown, add a language to it. */
export function addTranslationSoon(conversationId: string, handle: string, greetings: Greeting[]) {
  setTimeout(() => {
    update?.(conversationId, greetingPickerServer, handle, { greetings: [...greetings, ADDED] }, {  // 2
      model: `Translators added ${ADDED.language}.`,      // 3
    }).catch((err) => {
      // once the user has picked, the picker is answered and can't change
      if (!/was answered/.test(err.message)) console.error(`translation for ${conversationId} not sent: ${err.message}`);  // 4
    });
  }, TRANSLATE_MS);
}
```

**1** Handed in at startup, like the post office's `notify`. `Update` is the type of `hai.update`.

**2** The whole new props, typed and checked against the picker's contract. A revision replaces the props; it doesn't patch them.

**3** Optional: a sentence for the model about why. It goes before what the model always hears of an update: which handle replaced which, and the new digest.

**4** A frozen surface can't be revised: the user answered it at the old data, and the history says so. Picking within six seconds makes this fire, which is fine.

Ask the translators when the picker is shown. `ctx.render` resolves with the picker's handle:

**`src/server/tools.ts`** — *edit*

```ts
import { addTranslationSoon } from "./translators.ts";

// in list_greetings, replace the return with:
const shown = await ctx.render(greetingPickerServer, { greetings: GREETINGS }, { mode: "elicit" });
// the translators add a language to this picker a little later
if (shown.handle) addTranslationSoon(ctx.conversationId, shown.handle, GREETINGS);  // 1
return shown;
```

**1** Only schedules the update. The timer fires six seconds later, by when this request has normally let the conversation go. If a turn holds it then, `hai.update` waits for that turn to finish, up to 30 seconds by default, then revises.

Turn updates on, and connect the translators:

**`src/server/main.ts`** — *edit*

```ts
import { connectTranslators } from "./translators.ts";

const hai = createHai({
  updates: true,                                          // 1
  // ...unchanged, then add to the end of `system`:
  system: `...
- A [UI update] means a component was revised: its new handle and digest
  replace the old ones.`,
});
connectTranslators(hai.update);
```

**1** Required for `hai.update`, even with notices listed. It is also what lets an update sent with `wake: true` start a turn.

Last, the component. By default a revision mounts the component again with the new props, losing whatever the user did to it. Give the picker an `update` method and it keeps its state instead:

**`public/components.js`** — *edit the picker*

```js
  greeting_picker: {
    mount(el, props, ctx) {
      let scriptFilter = null;
      let state = ctx.state;
      let picked = null;

      const render = () => {
        el.replaceChildren();
        const live = state === "live" && ctx.mode === "elicit";
        // worked out from the props each time: a revision can bring a new script
        const scripts = [...new Set(props.greetings.map((g) => g.script))].sort();  // 1

        // ...chips and rows exactly as before
      };

      render();
      return {
        freeze(sel) { state = "frozen"; picked = sel ?? null; render(); },
        // A revision from the server: new rows, and the filter the user chose stays.
        update(next) { props = next; render(); },         // 2
      };
    },
  },
```

**1** Moved inside `render`. Computed once at mount, a script that only a revision brings would never get a chip.

**2** Swap the props and draw again. `scriptFilter` lives in this closure, so the user's filter survives the revision, which is the point of revising in place.

What happens, in order. `hai.update` takes the conversation's lease, as a request does, and stores the new props as a **new surface with a new handle** that supersedes the old one. Then it appends an *update notice*. The events stream sends that to the browser as the revision, and the browser swaps the props into the picker already on screen. The model hears it with the next user message:

**`user message`** — *what the model receives next*

```text
[UI update] Translators added Welsh. ui_01 was replaced by ui_02; its earlier digest is out of date. Now: 7 translations in 5 scripts. Most spoken: English, Mandarin, Spanish. 2 right-to-left. Rendered as ui_02.
```

From then on the old handle is gone. A click on it is refused as *superseded by ui_02*, which the browser never sends, since the picker's `send` follows it to the new handle. `query_ui` on the old handle still answers, from what it was, and says what it is now.

<details>
<summary>The scripted model, for revisions</summary>

The first tutorial's scripted model queries the first handle in the history, which after a revision is the old picker. A real model is told to move on to the new handle; teach the scripted one the same.

**`src/server/scripted.ts`** — *edit*

```ts
// replace the line that finds the handle to query
// the picker as it is now: the latest digest of one, a revision's included
const handle = [...JSON.stringify(messages).matchAll(/translations in \d+ scripts\.[^"]*?Rendered as (ui_\d+)/g)].at(-1)?.[1];  // 1
```

**1** Every picker digest, the update text's *Now:* included, ends with `Rendered as` its handle. The last one is the picker on screen. A query on the old handle would still answer, from what the picker was.

</details>

| | `ctx.update` | `hai.update` |
| --- | --- | --- |
| Called from | a tool, inside a turn | your code, any time |
| The model hears | the new digest, as the tool's result | the update text, with the next message, or at once with `wake: true` |
| While a turn runs | it is the turn | it waits for the turn to finish |

> [!TIP]
> **Checkpoint**
>
> Say *“greet me”*, click the **Latin** chip, and wait six seconds without picking. **Welsh** appears in the list, the Latin filter is still on, and there is still one picker. Pick Spanish now: the resolution says *#3 of 7 by speakers*, counted from the revision, not the original.

## 09 · Break it on purpose

The same exercise as the first tutorial's last step. Make each edit, run `npm run typecheck`, then undo it.

**`src/server/notices.ts`** — *try each, then revert*

```ts
// 1 — leave out the model text
postcardDelivered.implement({});
error TS2345: Argument of type '{}' is not assignable to parameter of type
              'NoticeImplDef<{ to: string; ... }, "passive">'

// 2 — answer with something that isn't text
postcardDelivered.implement({ model: () => 42 });
error TS2322: Type 'number' is not assignable to type 'string'

// 3 — let a wake notice say nothing
replyReceived.implement({ model: () => null });
error TS2322: Type 'null' is not assignable to type 'string'
```

**`src/server/postOffice.ts`** — *try each, then revert*

```ts
// 4 — send a field the notice doesn't declare
notify?.(conversationId, postcardDeliveredServer, { to: PEN_PAL, fare: 343 });
error TS2353: Object literal may only specify known properties, and 'fare'
              does not exist in type '{ to: string; language: string; ... }'
```

**`src/server/translators.ts`** — *try it, then revert*

```ts
// 5 — revise the picker with props it doesn't take
update?.(conversationId, greetingPickerServer, handle, { rows: [] });
error TS2353: Object literal may only specify known properties, and 'rows'
              does not exist in type '{ greetings: { code: string; ... }[]; }'
```

> [!TIP]
> **What you just proved**
>
> What the model hears of a notice is never optional, and a turn the model didn't ask for always has something to answer. The payloads that cross from webhooks to browsers, and the props that replace a surface, are typed from the contract like everything else.

## Where to go next

The hello app now does every kind of real-time work haikit has: progress inside a request, notices after it, a turn the model starts, and a surface that changes in place.

### Before you ship it

- **Keep the conversation's id with the work.** Every callback here found its conversation because the code that started the work had the id at hand. A real webhook needs it stored beside the job: in the payment's metadata, the queue message, or a row of your own.
- **Run more than one server.** Notices are stored, so any server can deliver them. A wake turn runs on whichever server took it, and a store with `publish` and `subscribe` carries it to browsers connected to the others: `pgStore` does this over `NOTIFY` when you give it a `listen` connection.
- **Expect an update notice at least once.** `hai.update` commits the revision and the notice it owes together; if appending the notice fails, the next request sends it first. A rare stall can deliver it twice: the browser shows the revision once, and the model reads it twice.

### Revise from a tool

`hai.update` has a twin for tools. Inside a turn, `ctx.update(surface, handle, props)` revises a surface the same way and returns the new digest as the tool's result, so the model hears it at once. A *“just the right-to-left ones”* tool that narrows the picker in place, instead of rendering a second one, is three lines.

### Things that will tempt you

**A wake notice for everything.** Each one costs a model call nobody asked for. Make a notice wake only when the user would want to be interrupted, and let the rest ride their next message.

**Pushing the whole new state in a notice.** If the thing on screen changed, revise the surface. A notice that carries a fresh copy of the data leaves the old surface live, its old handle clickable, and two versions of the truth in the transcript.
