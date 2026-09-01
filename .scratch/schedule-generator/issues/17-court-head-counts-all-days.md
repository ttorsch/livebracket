# The court header counts every day, not its own day

Type: task
Status: open
Blocked by: —

## Question

Each day section draws its own court headers, but the count in them is not
scoped to that day.

`page.tsx`, in the grid's court-header map:

```ts
const onCourt = filteredMatches.filter(m => m.court === court);
```

`filteredMatches` spans the whole event, so on a two-day tournament every day's
header reports the same total. Filtered to Mixed Open on **Test Tournament**,
Day 1's Court 2 head reads `0/3 played` while the section beside it is headed
`2 MATCHES` — the third match is on Day 2.

Pre-existing, and deliberately left alone by `12`, which was narrowing where the
grid's frame comes from rather than touching what the headers say. It is worth
fixing now for two reasons `12` created:

- the roster is drawn in full, so headers on courts with nothing on them read
  `0/0 played` and sit directly beside the wrong number, which makes the
  inconsistency legible in a way it was not before;
- `06` is about to tune the header's height and content for a phone, and should
  not tune around a number that is wrong.

What to do:

1. Scope the count to the day the header is drawn for. The per-day items are
   already grouped in the calendar memo (`itemsByDay`), so the count can come
   off the same grouping rather than a second filter over every match.
2. Decide whether the progress bar means the same thing once it is per-day — it
   is `played / total` on the same set, so it should follow the count.
3. Check the `Unscheduled` tray's header, which has no day and currently shares
   this code path.

Done when a court's header on a given day reports that day's matches, and the
section heading's match count and the sum of its court headers agree.
