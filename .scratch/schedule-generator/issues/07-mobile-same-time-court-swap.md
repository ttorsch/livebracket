# Swapping two matches at the same time, on a phone

Type: prototype
Status: in_progress
Assignee: Antigravity
Blocked by: 02, 06

## Question

The organizer's stated purpose for grid view:

> view what happens on court by time; if there is some slot free or already
> filled up; if there is some time user want to swap court with the same
> division that happen the same time.

The last clause is a **horizontal, same-row operation**: take two matches in the
same time row, on different courts, and exchange their courts. On a phone the
courts scroll horizontally, so the two matches the organizer wants to swap are
frequently not on screen together — which is most likely why the view "feels
broken" beyond the density problems `06` fixes.

Drag and drop was removed on mobile (`b975281 rm drag and drop`) and replaced
with a court navigator (`e59d89b`), so there is no established gesture for this.

Prototype cheaply and react, rather than deciding on paper. Candidates:

- **Select-then-target**: tap a match, the row's other courts become drop
  targets, tap one to swap. Works regardless of what is on screen.
- **Row zoom**: tap a time row to expand it into a full-width list of that row's
  courts, swap within it, collapse.
- **Swap action on the match sheet**: open a match, "swap court with…", pick
  from a list of same-time matches.

The prototype should also answer whether **free slots** are swap targets, not
just other matches — moving a match onto empty court time at the same hour is the
same gesture from the organizer's point of view.

Link the prototype from this ticket. Resolve with the organizer in the loop.
