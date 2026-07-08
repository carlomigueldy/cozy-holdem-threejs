export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export type Card = {
  rank: Rank;
  suit: Suit;
  id: string;
};

export type PlayerStatus =
  | 'Waiting'
  | 'Dealer'
  | 'Small blind'
  | 'Big blind'
  | 'Thinking'
  | 'Checked'
  | 'Called'
  | 'Bet'
  | 'Raised'
  | 'Folded'
  | 'All-in'
  | 'Winner';

export type Player = {
  id: string;
  name: string;
  seat: number;
  isHuman: boolean;
  stack: number;
  bet: number;
  committed: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  status: PlayerStatus;
  lastAction: string;
  handResult?: string;
};

export type GameStage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand-complete';

export type PokerAction =
  | { type: 'fold' }
  | { type: 'call' }
  | { type: 'raise'; amount: number };

export type LegalActions = {
  isPlayerTurn: boolean;
  canCheck: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  canRaise: boolean;
};

export type PublicPlayer = Omit<Player, 'holeCards'> & {
  holeCards: Card[];
  holeCardsHidden: boolean;
};

export type PublicGameState = {
  handNumber: number;
  stage: GameStage;
  pot: number;
  currentBet: number;
  minRaise: number;
  dealerIndex: number;
  currentIndex: number | null;
  communityCards: Card[];
  players: PublicPlayer[];
  message: string;
  winners: string[];
  lastHandName: string;
  legalActions: LegalActions;
};

export type HandCategory =
  | 'High Card'
  | 'Pair'
  | 'Two Pair'
  | 'Three of a Kind'
  | 'Straight'
  | 'Flush'
  | 'Full House'
  | 'Four of a Kind'
  | 'Straight Flush';

export type EvaluatedHand = {
  category: HandCategory;
  score: number[];
  cards: Card[];
  description: string;
};
