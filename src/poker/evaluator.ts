import { cardLabel, rankName } from './cards';
import type { Card, EvaluatedHand, HandCategory } from './types';

const CATEGORY_RANK: Record<HandCategory, number> = {
  'High Card': 0,
  Pair: 1,
  'Two Pair': 2,
  'Three of a Kind': 3,
  Straight: 4,
  Flush: 5,
  'Full House': 6,
  'Four of a Kind': 7,
  'Straight Flush': 8,
};

export function compareScores(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function rankCounts(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

function straightHigh(cards: Card[]): number | null {
  const unique: number[] = [...new Set(cards.map((card) => Number(card.rank)))].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const first = unique[i];
    if (first === undefined) continue;
    let ok = true;
    for (let offset = 1; offset < 5; offset += 1) {
      if (unique[i + offset] !== first - offset) {
        ok = false;
        break;
      }
    }
    if (ok) return first;
  }
  return null;
}

function sortedRanks(cards: Card[]): number[] {
  return cards.map((card) => card.rank).sort((a, b) => b - a);
}

function describe(category: HandCategory, score: number[], cards: Card[]): string {
  const ranks = score.slice(1);
  switch (category) {
    case 'Straight Flush':
      return `${ranks[0] === 14 ? 'Royal' : `${rankName(ranks[0] ?? 0)}-high`} straight flush`;
    case 'Four of a Kind':
      return `Four ${rankName(ranks[0] ?? 0)}`;
    case 'Full House':
      return `${rankName(ranks[0] ?? 0)} full of ${rankName(ranks[1] ?? 0)}`;
    case 'Flush':
      return `${rankName(ranks[0] ?? 0)}-high flush`;
    case 'Straight':
      return `${rankName(ranks[0] ?? 0)}-high straight`;
    case 'Three of a Kind':
      return `Three ${rankName(ranks[0] ?? 0)}`;
    case 'Two Pair':
      return `Two pair, ${rankName(ranks[0] ?? 0)} and ${rankName(ranks[1] ?? 0)}`;
    case 'Pair':
      return `Pair of ${rankName(ranks[0] ?? 0)}`;
    case 'High Card':
      return `${rankName(ranks[0] ?? 0)} high (${cards.map(cardLabel).join(' ')})`;
    default:
      return category;
  }
}

export function evaluateFive(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) {
    throw new Error(`evaluateFive expects 5 cards, received ${cards.length}`);
  }

  const flush = cards.every((card) => card.suit === cards[0]?.suit);
  const straight = straightHigh(cards);
  const counts = rankCounts(cards);
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  let category: HandCategory;
  let score: number[];

  if (flush && straight !== null) {
    category = 'Straight Flush';
    score = [CATEGORY_RANK[category], straight];
  } else if (groups[0]?.count === 4) {
    category = 'Four of a Kind';
    const quad = groups[0].rank;
    const kicker = groups.find((group) => group.rank !== quad)?.rank ?? 0;
    score = [CATEGORY_RANK[category], quad, kicker];
  } else if (groups[0]?.count === 3 && groups[1]?.count === 2) {
    category = 'Full House';
    score = [CATEGORY_RANK[category], groups[0].rank, groups[1].rank];
  } else if (flush) {
    category = 'Flush';
    score = [CATEGORY_RANK[category], ...sortedRanks(cards)];
  } else if (straight !== null) {
    category = 'Straight';
    score = [CATEGORY_RANK[category], straight];
  } else if (groups[0]?.count === 3) {
    category = 'Three of a Kind';
    const trips = groups[0].rank;
    const kickers = groups.filter((group) => group.rank !== trips).map((group) => group.rank).sort((a, b) => b - a);
    score = [CATEGORY_RANK[category], trips, ...kickers];
  } else if (groups[0]?.count === 2 && groups[1]?.count === 2) {
    category = 'Two Pair';
    const highPair = Math.max(groups[0].rank, groups[1].rank);
    const lowPair = Math.min(groups[0].rank, groups[1].rank);
    const kicker = groups.find((group) => group.count === 1)?.rank ?? 0;
    score = [CATEGORY_RANK[category], highPair, lowPair, kicker];
  } else if (groups[0]?.count === 2) {
    category = 'Pair';
    const pair = groups[0].rank;
    const kickers = groups.filter((group) => group.rank !== pair).map((group) => group.rank).sort((a, b) => b - a);
    score = [CATEGORY_RANK[category], pair, ...kickers];
  } else {
    category = 'High Card';
    score = [CATEGORY_RANK[category], ...sortedRanks(cards)];
  }

  return {
    category,
    score,
    cards: [...cards],
    description: describe(category, score, cards),
  };
}

function fiveCardCombinations(cards: Card[]): Card[][] {
  const combos: Card[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            if (combo.every(Boolean)) combos.push(combo as Card[]);
          }
        }
      }
    }
  }
  return combos;
}

export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`evaluateBestHand expects at least 5 cards, received ${cards.length}`);
  }
  let best: EvaluatedHand | null = null;
  for (const combo of fiveCardCombinations(cards)) {
    const evaluated = evaluateFive(combo);
    if (!best || compareScores(evaluated.score, best.score) > 0) {
      best = evaluated;
    }
  }
  if (!best) throw new Error('No hand combinations could be evaluated');
  return best;
}

export function bestHandLabel(cards: Card[]): string {
  if (cards.length < 5) return 'Waiting for community cards';
  return evaluateBestHand(cards).description;
}
