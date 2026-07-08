import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/poker/cards';
import { HoldemGame } from '../src/poker/game';

const cards = (input: string) => input.split(/\s+/).filter(Boolean).map(parseCard);

describe('all-in board run-out (regression: preflop all-in must not crash)', () => {
  it('runs the board out to five cards and resolves without throwing', () => {
    const game = new HoldemGame(99, { autoBots: false });
    const before = () => game.getPublicState();
    expect(() =>
      game.forceAllInRunoutForTest(
        [cards('A♥ K♥'), cards('Q♣ Q♦'), cards('7♣ 2♦'), cards('8♠ 3♣'), cards('9♦ 4♣'), cards('J♠ 5♥')],
        [200, 200, 200, 200, 200, 200],
      ),
    ).not.toThrow();
    const state = before();
    expect(state.stage).toBe('hand-complete');
    expect(state.communityCards).toHaveLength(5);
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
    const distributed = state.players.reduce((sum, p) => sum + p.stack, 0);
    expect(distributed).toBe(1200); // 6 x 200 conserved exactly
  });
});

describe('side pots (regression: short all-in cannot scoop the whole pot)', () => {
  it('splits main pot and side pot by eligibility', () => {
    const game = new HoldemGame(5, { autoBots: false });
    game.forceShowdownForTest(
      [
        cards('6♥ 7♥'), // p0: straight flush (best) — all-in short
        cards('A♥ 9♥'), // p1: ace-high flush
        cards('K♦ Q♣'), // p2: pair of kings
        cards('2♠ 2♣'), // p3 folded
        cards('3♠ 3♦'), // p4 folded
        cards('4♠ 4♦'), // p5 folded
      ],
      cards('3♥ 4♥ 5♥ K♠ 2♣'),
      {
        contributions: [100, 500, 500, 0, 0, 0],
        folded: [false, false, false, true, true, true],
      },
    );
    const state = game.getPublicState();
    const stack = (id: string) => state.players.find((p) => p.id === id)!.stack;

    // Main pot = 100*3 = 300 -> p0 (straight flush). Side pot = 400*2 = 800 -> p1 (flush).
    // Start stacks in helper = 1200 - contribution.
    expect(stack('p0')).toBe(1100 + 300); // 1400
    expect(stack('p1')).toBe(700 + 800); // 1500
    expect(stack('p2')).toBe(700 + 0); // 700
    expect(new Set(state.winners)).toEqual(new Set(['p0', 'p1']));

    // Chip conservation: every chip that went in comes back out.
    const potIn = 100 + 500 + 500;
    const totalOut = state.players.reduce((sum, p) => sum + p.stack, 0);
    const totalStart = 1100 + 700 + 700 + 1200 + 1200 + 1200;
    expect(totalOut).toBe(totalStart + potIn - potIn + potIn); // sanity: start already excludes contributions
    expect(stack('p0') + stack('p1') + stack('p2')).toBe(1100 + 700 + 700 + potIn);
  });
});

describe('big blind option (regression: BB may act on a limped pot)', () => {
  it('leaves action on the big blind after everyone limps preflop', () => {
    const game = new HoldemGame(3, { autoBots: false });
    game.startNewHand();
    // Drive every non-BB player to just call the big blind.
    let guard = 0;
    while (guard < 12) {
      guard += 1;
      const state = game.getPublicState();
      if (state.currentIndex === null) break;
      const current = state.players[state.currentIndex]!;
      // Stop once action reaches the big blind with no raise outstanding.
      if (current.status === 'Big blind' || current.lastAction.startsWith('Big blind')) break;
      const ok = game.debugForceCurrentCall();
      if (!ok) break;
    }
    const state = game.getPublicState();
    expect(state.stage).toBe('preflop'); // must NOT have advanced to the flop yet
    const bb = state.players[state.currentIndex ?? -1];
    expect(bb?.lastAction.startsWith('Big blind')).toBe(true);
    expect(state.legalActions.canCheck).toBe(true); // BB can check its option
  });
});
