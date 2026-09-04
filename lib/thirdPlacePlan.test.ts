import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findThirdPlaceRound,
  planThirdPlace,
  playingRounds,
  type KnockoutRound,
  type LoserFeeders,
} from './thirdPlacePlan.ts';

/** An eight-team bracket: quarters, semis, final. */
const eightTeam = (): KnockoutRound[] => [
  { id: 'r1', sequence: 1, matchIds: ['q1', 'q2', 'q3', 'q4'] },
  { id: 'r2', sequence: 2, matchIds: ['s1', 's2'] },
  { id: 'r3', sequence: 3, matchIds: ['f'] },
];

/** The same, with the play-off already appended. */
const withPlayOff = (): { rounds: KnockoutRound[]; feeders: LoserFeeders } => ({
  rounds: [...eightTeam(), { id: 'r4', sequence: 4, matchIds: ['tp'] }],
  feeders: { tp: ['s1', 's2'] },
});

describe('finding the play-off', () => {
  it('reads the loser edge rather than the round name', () => {
    const { rounds, feeders } = withPlayOff();
    assert.equal(findThirdPlaceRound(rounds, feeders)?.id, 'r4');
  });

  it('finds nothing in a bracket that has none', () => {
    assert.equal(findThirdPlaceRound(eightTeam(), {}), null);
  });

  it('does not mistake an empty round for one', () => {
    // Every match in an empty round trivially satisfies "is a loser edge".
    const rounds = [...eightTeam(), { id: 'r4', sequence: 4, matchIds: [] }];
    assert.equal(findThirdPlaceRound(rounds, {}), null);
  });

  it('leaves the play-off out of the playing rounds', () => {
    const { rounds, feeders } = withPlayOff();
    assert.deepEqual(playingRounds(rounds, feeders).map(r => r.id), ['r1', 'r2', 'r3']);
  });
});

describe('planning the change', () => {
  it('adds one below the final, fed by the semifinals', () => {
    const plan = planThirdPlace(eightTeam(), {}, true);
    assert.equal(plan.action, 'add');
    if (plan.action !== 'add') return;
    // The semifinal, not the final and not the quarters — getting this wrong
    // hangs the play-off off the wrong pair.
    assert.equal(plan.semi.id, 'r2');
    assert.deepEqual(plan.semi.matchIds, ['s1', 's2']);
    // Above every existing round: the bracket is a halving tree, and a round
    // wedged in front of the final would re-parent it.
    assert.equal(plan.sequence, 4);
  });

  it('adds nothing when the bracket already has one', () => {
    const { rounds, feeders } = withPlayOff();
    assert.equal(planThirdPlace(rounds, feeders, true).action, 'none');
  });

  it('removes the play-off round and nothing else', () => {
    const { rounds, feeders } = withPlayOff();
    const plan = planThirdPlace(rounds, feeders, false);
    assert.equal(plan.action, 'remove');
    if (plan.action !== 'remove') return;
    assert.equal(plan.round.id, 'r4');
  });

  it('removes nothing when there is none', () => {
    assert.equal(planThirdPlace(eightTeam(), {}, false).action, 'none');
  });

  it('refuses a bracket that is only a final', () => {
    const rounds: KnockoutRound[] = [{ id: 'r1', sequence: 1, matchIds: ['f'] }];
    const plan = planThirdPlace(rounds, {}, true);
    assert.equal(plan.action, 'impossible');
    if (plan.action !== 'impossible') return;
    assert.match(plan.reason, /semifinal/);
  });

  it('refuses a division with no knockout at all', () => {
    assert.equal(planThirdPlace([], {}, true).action, 'impossible');
    assert.equal(planThirdPlace([], {}, false).action, 'impossible');
  });

  it('takes a four-team draw, the smallest that has a semifinal', () => {
    const rounds: KnockoutRound[] = [
      { id: 'r1', sequence: 1, matchIds: ['s1', 's2'] },
      { id: 'r2', sequence: 2, matchIds: ['f'] },
    ];
    const plan = planThirdPlace(rounds, {}, true);
    assert.equal(plan.action, 'add');
    if (plan.action !== 'add') return;
    assert.equal(plan.semi.id, 'r1');
    assert.equal(plan.sequence, 3);
  });

  it('reads the semifinal off sequence, not off the order it was handed', () => {
    const shuffled = [eightTeam()[2], eightTeam()[0], eightTeam()[1]];
    const plan = planThirdPlace(shuffled, {}, true);
    assert.equal(plan.action, 'add');
    if (plan.action !== 'add') return;
    assert.equal(plan.semi.id, 'r2');
  });

  it('re-reads the semifinal past an existing play-off when re-adding', () => {
    /* A play-off already on the board is not a playing round, so removing and
       re-adding must land on the same semifinal rather than treating the
       play-off as the final and the final as the semi. */
    const { rounds, feeders } = withPlayOff();
    const afterRemoval = rounds.filter(r => r.id !== 'r4');
    const plan = planThirdPlace(afterRemoval, feeders, true);
    assert.equal(plan.action, 'add');
    if (plan.action !== 'add') return;
    assert.equal(plan.semi.id, 'r2');
  });
});
