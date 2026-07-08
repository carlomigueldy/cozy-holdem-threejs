import { RANKS, SUITS, type Card, type Rank } from './types';

export class SeededRandom {
  private seed: number;

  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
  }

  next(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  integer(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

export function rankLabel(rank: number): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

export function rankName(rank: number): string {
  const names: Record<number, string> = {
    14: 'Aces',
    13: 'Kings',
    12: 'Queens',
    11: 'Jacks',
    10: 'Tens',
    9: 'Nines',
    8: 'Eights',
    7: 'Sevens',
    6: 'Sixes',
    5: 'Fives',
    4: 'Fours',
    3: 'Threes',
    2: 'Twos',
  };
  return names[rank] ?? String(rank);
}

export function cardLabel(card: Card): string {
  return `${rankLabel(card.rank)}${card.suit}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${rankLabel(rank)}${suit}` });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], rng: SeededRandom): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.integer(i + 1);
    const current = copy[i];
    const swap = copy[j];
    if (!current || !swap) continue;
    copy[i] = swap;
    copy[j] = current;
  }
  return copy;
}

export function parseCard(input: string): Card {
  const suit = input.slice(-1);
  const rankText = input.slice(0, -1).toUpperCase();
  if (!SUITS.includes(suit as Card['suit'])) {
    throw new Error(`Invalid card suit in ${input}`);
  }
  const rankMap: Record<string, Rank> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
  };
  const rank = rankMap[rankText] ?? Number(rankText);
  if (!RANKS.includes(rank as Rank)) {
    throw new Error(`Invalid card rank in ${input}`);
  }
  return { rank: rank as Rank, suit: suit as Card['suit'], id: `${rankLabel(rank)}${suit}` };
}
