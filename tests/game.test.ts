import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/poker/cards';
import { HoldemGame } from '../src/poker/game';

const cards = (input: string) => input.split(/\s+/).filter(Boolean).map(parseCard);

describe('HoldemGame round flow', () => {
  it('starts with blinds, two hole cards for each player, and human legal actions', () => {
    const game = new HoldemGame(42, { autoBots: false });
    game.startNewHand();
    const state = game.getPublicState();
    expect(state.stage).toBe('preflop');
    expect(state.players).toHaveLength(6);
    expect(state.players.every((player) => player.isHuman ? player.holeCards.length === 2 : player.holeCardsHidden)).toBe(true);
    expect(state.pot).toBe(30);
    expect(state.currentBet).toBe(20);
  });

  it('can resolve a deterministic showdown and award the best hand', () => {
    const game = new HoldemGame(7, { autoBots: false });
    game.forceShowdownForTest(
      [
        cards('A♥ K♥'),
        cards('Q♣ Q♦'),
        cards('2♣ 7♦'),
        cards('3♠ 8♣'),
        cards('4♣ 9♦'),
        cards('5♠ J♣'),
      ],
      cards('Q♥ T♥ J♥ 2♦ 3♣'),
    );
    const state = game.getPublicState();
    expect(state.stage).toBe('hand-complete');
    expect(state.winners).toEqual(['p0']);
    expect(state.lastHandName).toContain('straight flush');
  });

  it('accepts a human fold only when it is the human turn', () => {
    const game = new HoldemGame(20260708, { autoBots: false });
    game.startNewHand();
    const state = game.getPublicState();
    const accepted = game.act({ type: 'fold' });
    if (state.legalActions.isPlayerTurn) {
      expect(accepted).toBe(true);
    } else {
      expect(accepted).toBe(false);
    }
  });
});
