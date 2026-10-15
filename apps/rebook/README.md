# Rebook

A demo of what software built with [HaiKIT](https://github.com/wfoxd/haikit)
can do: **AI drives the software. You steer.**

Your flight to Tokyo is cancelled. Rebook tells you before you ask, shows you
every way to get there, waits while you choose, picks a seat with you while
other passengers take theirs, asks where you'll spend tonight because the new
flight leaves tomorrow, and issues the boarding pass. When the gate moves
later, it speaks up again. Each step is a component the AI chose for this
case, and each answer is a click.

This folder is a complete, self-contained app: copy it anywhere, install, and
run. It depends only on the published `@haikit/*` packages.

## The Airline ops bar

A bar under the header plays the airline. It isn't part of the conversation:
its buttons call this server's `/ops` routes, which act on your conversation
the way an airline's systems would, through `hai.notify` and `hai.update`. So
you watch the outside world act, and then the AI respond.

| Button | What the airline does | What you see |
| --- | --- | --- |
| **Cancel the flight** | Revises the trip card to *Cancelled*, and sends the `flight_cancelled` wake notice | The guide speaks first, without being asked, and shows the options |
| **Release the holds** | Lets its 5-minute seat holds run out now: seats left fall on every option, and the scarcest on screen sells out | The picker you're looking at is revised in place. The guide hears of it with your next click |
| **Change the gate** | Moves the new flight's gate, with `wake: true` | The boarding pass is revised in place, and the guide speaks up |

The holds also run out by themselves, five minutes after the options are
shown.

## The 60-second path

1. The trip card shows UA 837, San Francisco to Tokyo, on time. The guide
   says nothing: nothing has happened yet.
2. **Cancel the flight.** The card turns red, a notice appears beside it, and
   the guide speaks first: "I'm sorry: your 18:05 UA 837 to Tokyo was
   cancelled because of a crew shortage…". Fourteen options appear, and the
   turn waits on them.
3. Type "which are nonstop?". Typing closes the waiting picker. The guide
   asks `query_ui` about the options it was shown only as a digest, gets a
   capped answer ("5 of 14 match"), and shows the five as a new picker.
4. **Release the holds.** The picker changes while you look: UA 875 sells out.
5. Click NH 7. A seat map appears, and seats go grey as other passengers take
   them. A seat taken a moment ago is refused, and the map stays live.
6. NH 7 leaves tomorrow, so the guide asks where you'll spend tonight. Click
   the hotel.
7. The boarding pass appears, and a moment later the airline's confirmation
   beside it.
8. **Change the gate.** The pass is revised to the new gate, and the guide
   says so.
9. Open **Context**, top right, to see everything the model received.

## What each HaiKIT feature does here

| Feature | In Rebook |
| --- | --- |
| Two channels | Every component's full props go to the browser; the model gets a digest. For the 14 options: about 135 tokens of digest for about 665 of props |
| Elicit, the parked turn | The options, the seat map and tonight's choices each wait for a click, with nothing held open |
| `query_ui` and `cap` | "which are nonstop?" is answered from the stored options, capped: `5 of 14 match. 5 shown:` |
| Undeclared means local | The picker's filter chips work in the browser, with no round trip, because the contract declares no action for them |
| A refused click | A sold-out option or a taken seat throws in its handler, so nothing is recorded and the component stays live |
| Wake notices | The cancellation starts the guide's turn when the traveller hasn't said anything |
| Revisions, `hai.update` | The trip card, the picker, the seat map and the boarding pass are each revised in place by the airline |
| Passive notices | The seat confirmation arrives a moment after booking, and the model hears it with the next turn |
| Freshness | The options' `staleAfterMs` is 20 minutes. Past that, the whole conversation is out of date, and HaiKIT refuses every request on it rather than act on old prices |

The boarding pass books exactly what the traveller clicked. `issue_boarding_pass`
takes no input: the server reads the option, seat and night the traveller
chose from their clicks, so the model can ask for a booking but can't decide
what it is.

## Run it

Needs Node 22.18 or later (it runs TypeScript directly, with no build step).

```bash
npm install
npm start                # http://localhost:5190
```

With no API key it uses a scripted guide, so anyone can use the demo at no
model cost. The scripted guide reads only what a real model would: digests,
click labels, notices and query answers. To use Claude:

```bash
ANTHROPIC_API_KEY=… npm start
```

It runs Claude Haiku 5.5 (`claude-haiku-5-5`) at low effort. Set `HAI_MODEL`
to use another model.

The store is in memory: the demo's conversations go when the server restarts.

## Test it

```bash
npm test
```

That typechecks the server and the browser components against the shared
contracts, then boots the server and drives the whole path above over HTTP,
with the airline played by the `/ops` routes: the guide speaking first, the
capped query, the revisions, the refused clicks, the boarding pass and the
gate change.

## Deploy

```bash
docker build -t haikit-rebook .
docker run -p 8080:8080 haikit-rebook
```

Without `ANTHROPIC_API_KEY` it runs the scripted guide. A wake turn needs the
browser's events stream, so a proxy in front must pass server-sent events
through unbuffered; behind one that holds them back, the page polls instead.

## Layout

```
src/shared/surfaces.ts     the contract: trip_card, rebooking_options, seat_map, care_options,
                           boarding_pass
src/shared/notices.ts      flight_cancelled (wake), seat_confirmed
src/server/data.ts         the booking, the 14 options, seat maps and tonight's choices
src/server/surfaces.ts     digests, click handlers, the filter and earliest queries
src/server/notices.ts      what the model hears of each notice
src/server/airline.ts      the airline's side: cancel, holds, other passengers, confirmation,
                           the gate, and what the traveller clicked
src/server/tools.ts        show_trip (init), find_rebooking, show_seat_map, offer_care,
                           issue_boarding_pass
src/server/scripted.ts     the scripted guide, a ModelAdapter
src/server/main.ts         createHai, the /ops routes, static files
public/                    the page, the components, the Airline ops bar, the styles
test/smoke.mjs             the end-to-end check
```
