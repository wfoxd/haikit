# Rebook

A demo of what software built with [HaiKIT](https://github.com/wfoxd/haikit)
can do: **AI drives the software. You steer.**

Your flight to Tokyo is cancelled. Rebook tells you before you ask, shows you
every way to get there, waits while you choose, picks a seat with you while
other passengers take theirs, asks where you'll spend tonight because the new
flight leaves tomorrow, and issues the boarding pass. A new flight that costs
extra is booked only once you've checked the change and confirmed the amount.
When the gate moves
later, it speaks up again. Each step is a component the AI chose for this
case, and each answer is a click.

Or ask it to book your flight home. It already knows who you are, where home
is and when you land in Tokyo, so the search is filled in before you see it,
and it asks only for what it doesn't know: the day.

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
| **Raise the fare** | Raises the fare on the flight home by $60 while its review waits | The review is revised in place to the new total. The guide hears of it with your next click, and a Confirm at the old total is refused |

The holds also run out by themselves, five minutes after the options are
shown.

Nothing happens until the airline acts, so a visitor who presses nothing
isn't left waiting: 30 seconds after the trip opens, the bar cancels the
flight itself, through the same route as its button. A countdown on the
button and a line under it say so, and cancelling sooner stops it. So does
starting to book the flight home: the visitor is doing something already.

## The 60-second path

1. The trip card shows UA 837, San Francisco to Tokyo, on time. The guide
   says nothing: nothing has happened yet.
2. **Cancel the flight**, or wait: after 30 seconds the airline cancels it
   anyway. The card turns red, a notice appears beside it, and
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

NH 7 costs nothing extra. Choose one that does, such as KE 26 + KE 2101 (+$60,
leaving tonight), and after the seat the guide shows the change to check
instead of the boarding pass: the new flight, the seat, tonight if there is a
night, and the extra fare. Nothing is booked until **Confirm**, which sends the
amount on screen; **Different flight** and **Different seat** go back a step,
and a change there needs confirming again.

## Book the flight home

1. Click **Book my flight home** on the trip card, or type "book my flight
   home on Sunday". The button is an `inform` action: it tells the guide,
   and nothing waits on the card.
2. The search is already filled in: Alex Morgan, any Tokyo airport, San
   Francisco, each marked "from your trip". The day says "from your message"
   if you named one, and "choose one" if you didn't. Change the day or the
   airport here, in the browser, then **Search flights**.
3. Ten flights home, the earliest to leave first. Only flights leaving at
   least two hours after you land in Tokyo are offered: rebooked onto NH 7,
   which lands on Thursday at 14:25, a Thursday search starts at 16:55. Type
   "which are nonstop?" or "which is cheapest?": the guide asks `query_ui`
   about the flights, and shows the answer as a new picker.
4. Pick UA 838, then a fare: Basic, Standard or Flex. Basic assigns your
   seat at check-in, so the guide goes straight to the review; Standard and
   Flex show the seat map first.
5. The review: the flight, fare, seat and total. Nothing is booked until you
   confirm, and Change flight, fare or seat goes back a step.
6. **Raise the fare.** The review changes while you look: $60 more, and it
   says what it was. A Confirm carrying the old total is refused.
7. Confirm. The e-ticket appears, the airline issues the ticket a moment
   later, and the trip card shows your flight home.

Nothing is charged, and no card details are ever asked for: the review says
the card on file pays, and that this is a demo.

## What each HaiKIT feature does here

| Feature | In Rebook |
| --- | --- |
| Two channels | Every component's full props go to the browser; the model gets a digest. For the 14 options: about 135 tokens of digest for about 665 of props |
| Elicit, the parked turn | The options, the seat map, tonight's choices and the review of a change that costs extra each wait for a click, with nothing held open |
| `query_ui` and `cap` | "which are nonstop?" is answered from the stored options, capped: `5 of 14 match. 5 shown:` |
| Undeclared means local | The picker's filter chips work in the browser, with no round trip, because the contract declares no action for them |
| A refused click | A sold-out option or a taken seat throws in its handler, so nothing is recorded and the component stays live |
| Wake notices | The cancellation starts the guide's turn when the traveller hasn't said anything |
| Revisions, `hai.update` | The trip card, the picker, the seat map and the boarding pass are each revised in place by the airline |
| Passive notices | The seat confirmation arrives a moment after booking, and the model hears it with the next turn |
| `init` runs once | `show_trip` opens the conversation and never runs again. Ask to see your bookings and `show_bookings` shows the trip card, the boarding pass and the e-ticket again, as they are now; the airline revises the copies shown last |
| Freshness | The options' `staleAfterMs` is 20 minutes. Past that, the whole conversation is out of date, and HaiKIT refuses every request on it rather than act on old prices |
| `inform` | The trip card's Book my flight home tells the guide without anything waiting on the card. It's refused while a question waits, and once the flight home is booked |
| Filled in, not asked | The search arrives filled in from the trip. Only the day is left to the traveller, unless they named it |
| A value the click carries | Confirm sends the amount on screen: the flight home's total, or a rebooking's extra fare. A total the airline has just raised is refused rather than charged |
| Two answers to one question | Each review waits on Confirm or a change: either `resolve` action answers it |

The boarding pass books exactly what the traveller clicked.
`issue_boarding_pass` takes no input: the server reads the option, seat and
night the traveller chose from their clicks, so the model can ask for a booking
but can't decide what it is. For an option that costs extra, it also refuses
until the traveller has confirmed that amount on `review_rebooking`. Asked
again with nothing changed, it books nothing and points the model to
`show_bookings`, which shows the cards again. The flight home works the same
way: each step's tool refuses to run ahead of the clicks, and `issue_ticket`
books the flight, fare, seat and total the traveller confirmed.

## Run it

Needs Node 22.18 or later (it runs TypeScript directly, with no build step).

```bash
npm install
npm start                # http://localhost:5190
```

With no API key it uses a scripted guide, so anyone can use the demo at no
model cost. The scripted guide reads only what a real model would: digests,
click labels, notices and query answers. To use Claude, put your key in a
`.env` file in this folder:

```bash
ANTHROPIC_API_KEY=sk-ant-…
```

`npm start` reads it (with Node's `--env-file-if-exists`; Node doesn't read
`.env` by itself), and a variable already set in your shell wins over the
file. Or pass the key for one run: `ANTHROPIC_API_KEY=… npm start`. `.env` is
in `.gitignore` and `.dockerignore`, so it's never committed and never built
into the image.

It runs Claude Haiku 5.5 (`claude-haiku-5-5`) at low effort. Set `HAI_MODEL`
to use another model.

The store is in memory: the demo's conversations go when the server restarts.

## Test it

```bash
npm test
```

That typechecks the server and the browser components against the shared
contracts, then boots the server and drives both paths above over HTTP,
with the airline played by the `/ops` routes: the guide speaking first, the
capped query, the revisions, the refused clicks, the boarding pass and the
gate change; then the filled-in search, the fares, the seat, the raised fare
and the e-ticket.

## Deploy

```bash
docker build -t haikit-rebook .
docker run --env-file .env -p 8080:8080 haikit-rebook
```

The image never contains `.env`: `.dockerignore` leaves it out, so a key
isn't baked into an image that might be pushed or shared. Docker doesn't read
`.env` by itself either. `--env-file .env` hands its variables to the
container when it starts, and `-e ANTHROPIC_API_KEY` passes one from your
shell instead. Without `ANTHROPIC_API_KEY` it runs the scripted guide, so
leave both off for the free demo. A wake turn needs the
browser's events stream, so a proxy in front must pass server-sent events
through unbuffered; behind one that holds them back, the page polls instead.

## Layout

```
src/shared/surfaces.ts     the contract: trip_card, rebooking_options, seat_map, care_options,
                           boarding_pass; for the flight home, flight_search, flight_results,
                           fare_options, booking_review, booking_confirmed
src/shared/notices.ts      flight_cancelled (wake), seat_confirmed, ticket_issued
src/server/data.ts         the booking, the 14 options, seat maps and tonight's choices; the
                           flights home and their fares
src/server/surfaces.ts     digests, click handlers, the filter and earliest queries
src/server/notices.ts      what the model hears of each notice
src/server/airline.ts      the airline's side: cancel, holds, other passengers, confirmation,
                           the gate, the fare and the ticket, and what the traveller clicked
src/server/tools.ts        show_trip (init), show_bookings, find_rebooking, show_seat_map,
                           offer_care, review_rebooking, issue_boarding_pass; start_booking,
                           show_flights, show_fares, show_home_seats, review_booking, issue_ticket
src/server/scripted.ts     the scripted guide, a ModelAdapter
src/server/main.ts         createHai, the /ops routes, static files
public/                    the page, the components, the Airline ops bar, the styles
test/smoke.mjs             the end-to-end check
```
