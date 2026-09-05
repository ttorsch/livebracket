# Live Bracket — Launch Kit

Go-to-market material for Live Bracket: a 75-second video script aimed at
tournament organizers, a paste-ready outreach message, and the build plan for
the try-it-yourself sandbox.

Written 5 September 2026. Everything claimed about the product here was checked
against the code at that date — see **Accuracy notes** at the bottom for the
things that are deliberately *not* claimed.

---

## Read this first — the demo data problem

The dev database is full of placeholder content. The event is called
**"Test Tournament"**, teams are **"Sand / Sand"** and **"Spike / Spike"**, and
every knockout slot reads **"Player TBD"** because pool play has not finished.
The layouts are good; the content reads as a prototype. Do not send those
screenshots to a club owner.

`scripts/seed-demo-data.mjs` already generates eight scenario tournaments with
realistic Thai and Brazilian names (Ananda / Boonmee, Preecha / Ferreira). Seed
the sandbox from that first, then shoot the film and take the screenshots from
the sandbox. One good dataset feeds all three deliverables.

---

## 1. The 75-second film

Audience: a tournament organizer currently running their event on a whiteboard
and a WhatsApp group. Shoot vertical (9:16).

| Time | Beat | Voiceover | Shot |
|---|---|---|---|
| 0:00–0:06 | Hook | "Every tournament runs on the same two things. A whiteboard nobody can read…" | Handheld, close, real sand. A paper bracket taped to a trestle table, one corner lifting in the wind. A hand crosses out a name with a marker and writes over it. |
| 0:06–0:11 | Hook | "…and forty people asking which court they're on." | Cut to the organizer's phone, face up on the table. WhatsApp group, unread count climbing. Let it buzz on the audio. |
| 0:11–0:15 | Turn | "Live Bracket runs the whole thing. One link." | Hard cut to black, half a beat of silence, then the coral mark. Straight into the homepage hero on a phone — the site's own line, *Every Point live on one link*, is already the thesis, so let it sit on screen. |
| 0:15–0:25 | Set up | "Set your event up once. Divisions, fees, team caps, registration dates." | Screen recording at 2×. Dashboard → Create tournament. Name it, add three divisions — Men's Open, Women's Open, Mixed — set the fee and the team cap on one of them. |
| 0:25–0:34 | Fill it | "Teams sign themselves up. You watch the list fill — and see who's actually paid." | Public registration page on a phone, a team submits. Cut to the organizer's entry list: the counter moves 6/8 → 7/8, paid and unpaid pills, a waitlist row once the cap is hit. |
| 0:34–0:46 | The draw | "Seed the draw, lock it, and the schedule builds itself. Every court, in the right order, with time for net changes." | The organizer workspace. Drag two seeds to swap them, hit generate — pools appear — then lock the draw. Cut to the schedule tab and let the matches drop into the court grid. Strongest ten seconds you have; give it room. |
| 0:46–0:58 | Scoring | "Print the QR sheet and tape it to the court. Your referee scans it and taps the score. No app, no account, nothing to teach." | Printed QR cards coming off a printer, then out on the sand: a hand tapes one to the net post, a referee's phone scans it, the scorekeeper screen opens, a thumb taps and the score rolls 14 → 15. Shoot in real daylight — this is the shot that proves the product is built for a beach and not a desk. |
| 0:58–1:09 | Payoff | "And it's live. Same second. On the bracket, on the standings, on every phone at the beach — and every phone that isn't." | Cross-cut, tight and fast: referee's thumb → the public court card ticking over → a spectator's phone in a beach chair showing the same number → the bracket advancing a winner's name into the semifinal on its own. Three cuts, no more. |
| 1:09–1:16 | Close | "One link for your whole tournament. Try it on a real event — nothing you touch is real." | Hold on the public tournament page. The share sheet opens, the link copies. End card: the mark, the URL, and *Try the demo*. |

### Production notes

- **Shoot vertical, 9:16.** This gets sent in chats and watched on phones. If you
  want a landscape cut for the site later, frame the screen recordings with room
  on both sides.
- **Burn in subtitles.** Most of this will be watched muted. Every voiceover line
  is short enough to double as an on-screen caption — if you'd rather not record
  a voice at all, run them as text and the film still works.
- **Record the screen on a real device** at 3× pixel ratio, not the browser's
  responsive mode. The digit-roll animation and the live dot are the details that
  sell it, and they go mushy when downscaled.
- **Keep sand on screen.** Cut back to the beach at least three times. A
  competitor can copy a dashboard; nobody else's demo has a net post in it.
- **Music under, not over.** Light percussion, ducked hard beneath the voiceover,
  and dropped entirely for the half-beat of silence at 0:11.

---

## 2. The outreach message

For someone met in person at a beach or a club. Short enough to read without
scrolling, ends with something they can do.

```
Hey [name] — good meeting you at [event] 🏐

I've been building Live Bracket. It runs a whole tournament off one link:
teams register themselves, the draw and the court schedule generate from the
seeds, and your referee just scans a QR taped to the post and taps the score.
Everyone watching sees it the same second — bracket, standings, all of it.

Here's what it looks like 👇

You can also play with a real tournament yourself — you get your own private
copy, so change anything you like, nothing breaks: [demo link]

If you run an event this season I'd love 10 minutes of your honest opinion.
```

**Attach three screenshots, in this order:** live courts, then pool standings,
then the bracket. Three is the limit before a chat preview collapses them into a
grid and none of them can be read.

### Variants

- **The two-line version,** for when you're still standing in front of them:
  *"That thing I mentioned — it's here. Have a play, it's a real tournament and
  you can't break it: [link]"*. Send it from your phone before walking away; it
  lands while they still remember your face.
- **The follow-up,** about five days later if nothing comes back: *"No pressure
  on the demo — but one question if you have a second: what's the most annoying
  part of running your event right now? That's genuinely what I'm trying to
  fix."* A question gets answered far more often than a link gets clicked.
- **Check the channel.** In Thailand most local clubs live on LINE, not WhatsApp.
  The text works unchanged, but ask which they use before sending.

---

## 3. The sandbox

Every visitor gets their own private copy of a real, mid-event tournament, which
expires after a day.

### Why it is straightforward here

Every foreign key points down a clean tree rooted at `tournaments`:

```
tournaments
├── divisions
│   ├── rounds ──────────┐
│   ├── teams            │
│   │   ├── players      │
│   │   └── registrations│
│   └── matches ◄────────┘  (also references divisions and teams ×4)
└── vouchers
```

Nothing points sideways, nothing points back up. "Copy a tournament" is one
depth-first walk with a UUID remap — no cycle-breaking, no ordering puzzle. The
insert order is already written down in `scripts/seed-demo-data.mjs`.

### Constraints the clone must respect

Only three unique constraints need fresh values on a copy:

| Constraint | Handling |
|---|---|
| `tournaments.slug` (global unique) | Mint a fresh slug per sandbox |
| `matches.scorekeeper_token` (global unique) | Mint a fresh token per copied match |
| `organizers.email` (global unique) | Throwaway organizer gets a unique address |

Scoped uniques copy as-is: `vouchers (tournament_id, code)` and
`rounds (division_id, sequence)` are both per-parent.

Two columns must be **nulled, not copied** — both point at real auth users, and
carrying them into a sandbox would attach a stranger's copy to a real person's
account:

- `teams.registered_by`
- `players.user_id`

The clone should read with `select *` rather than listing columns, so a column
added by a later migration is copied without anyone having to remember this
file.

### What a visitor experiences

1. **They open the demo link.** A separate host running the same code against its
   own Supabase project and its own Redis. Production is not reachable from it at
   all — that isolation is the whole safety story; everything else is convenience.
2. **They get their own tournament, instantly.** The page mints a throwaway
   organizer and deep-copies the golden template: a two-day, three-division
   event, mid-play, pool results in, bracket drawn. Around 150 rows. No sign-up
   form, no email, no waiting.
3. **They can do anything.** Re-draw, reschedule, score a match, cancel a
   division, delete the whole thing. Two people trying the demo at the same time
   never see each other's changes.
4. **It cleans itself up.** An hourly cron deletes any sandbox past its 24-hour
   expiry along with its throwaway account.

### What to build

| Piece | What it does | Size |
|---|---|---|
| Demo project | Second Supabase project, second Upstash database, second Vercel project on its own domain, same repo | Setup only |
| Golden template | Extend the existing seed script to one realistic mid-event tournament, marked as the template | Small |
| `sandboxes` table | One row per visitor: id, expiry, throwaway user; plus a nullable `sandbox_id` on tournaments and organizers | Small |
| Clone routine | Deep-copy with UUID remap. Fiddly parts: matches carry four team references, and every copied match needs a fresh scorekeeper token | The real work |
| Start route | Mints the sandbox, creates the throwaway organizer, signs them in, drops them on the dashboard | Medium |
| Sweeper cron | Hourly Vercel cron deleting expired sandboxes and their auth users | Small |
| Demo guardrails | Persistent banner, outbound email disabled, rate limit on sandbox creation, `noindex` so demo events never show up in search | Small |

### Sign-in approach

Create the throwaway user with `supabaseAdmin.auth.admin.createUser`, then call
`signInWithPassword` against the request-scoped SSR client
(`lib/supabaseServer.ts`), which writes the auth cookies. No magic-link round
trip. An organizer is an `organizers` row with `auth_user_id` set — see the
reasoning in `supabase/migrations/0013_auth_organizer_link.sql`.

### Open decisions

- **The domain.** A subdomain you own beats a Vercel preview URL — a link like
  `demo.livebracket.app` survives being read aloud, and preview URLs can sit
  behind Vercel's login wall, which would kill the demo at the first click.
- **Which tournament is the template.** Suggested: two days, three divisions,
  ~24 teams, pool play finished, bracket drawn, two matches live — so a visitor
  lands somewhere interesting rather than on an empty setup form. Same fixture
  should feed the film and the screenshots.
- **Whether visitors can reset.** A "start over" button is cheap once the clone
  routine exists, and saves anyone who breaks their copy in the first two minutes
  from silently giving up.
- **A second Supabase project costs money on a paid plan.** Check the tier before
  provisioning — this is the one step an agent should not take unattended.

---

## Accuracy notes

Things deliberately **not** claimed in the script or the message, because the
code does not do them:

- **No online payments.** There is no Stripe or any payment provider in the
  repo. Registrations carry a `payment_status` and the dashboard shows paid vs
  unpaid, but money is collected off-platform. Do not let any shot imply a
  checkout.
- **Screenshots not yet captured:** the organizer dashboard and the scorekeeper
  screen. Both need an organizer login. They are the two most persuasive screens
  in the pitch — capture them once the sandbox exists.

Screenshots taken so far came from the local dev server on port 3001 and show
placeholder data. Retake everything from the sandbox once the golden template is
seeded.
