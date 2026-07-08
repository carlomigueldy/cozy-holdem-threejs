import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/poker/cards';
import { compareScores, evaluateBestHand } from '../src/poker/evaluator';

const cards = (input: string) => input.split(/\s+/).filter(Boolean).map(parseCard);

describe('Texas Hold\'em hand evaluator', () => {
  it('recognizes a royal / ace-high straight flush', () => {
    const hand = evaluateBestHand(cards('A♥ K♥ Q♥ J♥ T♥ 2♣ 3♦'));
    expect(hand.category).toBe('Straight Flush');
    expect(hand.description).toContain('Royal');
  });

  it('handles wheel straights with ace low', () => {
    const hand = evaluateBestHand(cards('A♣ 2♥ 3♦ 4♠ 5♣ K♦ Q♥'));
    expect(hand.category).toBe('Straight');
    expect(hand.score[1]).toBe(5);
  });

  it('chooses full house over flush and lower trips', () => {
    const hand = evaluateBestHand(cards('A♣ A♥ A♦ K♠ K♣ 2♣ 3♣'));
    expect(hand.category).toBe('Full House');
    expect(hand.description).toBe('Aces full of Kings');
  });

  it('breaks ties using kickers', () => {
    const board = cards('A♣ K♦ 9♥ 4♠ 2♣');
    const first = evaluateBestHand([...cards('Q♣ J♦'), ...board]);
    const second = evaluateBestHand([...cards('T♣ 8♦'), ...board]);
    expect(first.category).toBe('High Card');
    expect(compareScores(first.score, second.score)).toBeGreaterThan(0);
  });

  it('selects the best five out of seven cards', () => {
    const hand = evaluateBestHand(cards('9♣ 9♦ 9♥ 9♠ A♣ K♣ 2♦'));
    expect(hand.category).toBe('Four of a Kind');
    expect(hand.score.slice(1)).toEqual([9, 14]);
  });
});
