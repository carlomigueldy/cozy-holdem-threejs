import { bestHandLabel, compareScores, evaluateBestHand } from './evaluator';
import { SeededRandom, cardLabel, createDeck, shuffleDeck } from './cards';
import type { Card, EvaluatedHand, GameStage, LegalActions, Player, PokerAction, PublicGameState } from './types';

const PLAYER_NAMES = ['You', 'Moss', 'Juniper', 'Ember', 'Clover', 'Pip'];
const STARTING_STACK = 1_200;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

export type GameEvent =
  | { type: 'state'; state: PublicGameState }
  | { type: 'deal-card'; playerId?: string; communityIndex?: number; card?: Card; faceDown: boolean }
  | { type: 'chip'; playerId: string; amount: number }
  | { type: 'toast'; message: string };

type Listener = (event: GameEvent) => void;

type ForcedShowdownOptions = {
  contributions?: number[];
  folded?: boolean[];
  forceAllIn?: boolean;
};

export class HoldemGame {
  private players: Player[] = [];
  private deck: Card[] = [];
  private rng: SeededRandom;
  private dealerIndex = 0;
  private currentIndex: number | null = null;
  private stage: GameStage = 'idle';
  private communityCards: Card[] = [];
  private currentBet = 0;
  private minRaise = BIG_BLIND;
  private actedThisRound = new Set<number>();
  private message = 'Pull up a chair by the fire.';
  private winners: string[] = [];
  private lastHandName = '—';
  private listeners = new Set<Listener>();
  private handNumber = 0;
  private processing = false;
  private showdownOpen = false;
  private autoBots: boolean;

  constructor(seed = Date.now(), options: { autoBots?: boolean } = {}) {
    this.rng = new SeededRandom(seed);
    this.autoBots = options.autoBots ?? true;
    this.players = PLAYER_NAMES.map((name, seat) => ({
      id: `p${seat}`,
      name,
      seat,
      isHuman: seat === 0,
      stack: STARTING_STACK,
      bet: 0,
      committed: 0,
      holeCards: [],
      folded: false,
      allIn: false,
      status: 'Waiting',
      lastAction: 'Waiting',
    }));
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ type: 'state', state: this.getPublicState() });
    return () => this.listeners.delete(listener);
  }

  startNewHand(): void {
    if (this.processing) return;
    this.processing = true;
    this.handNumber += 1;
    this.showdownOpen = false;
    this.winners = [];
    this.lastHandName = '—';
    this.communityCards = [];
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.actedThisRound.clear();
    this.stage = 'preflop';
    this.message = 'Fresh cards, warm mugs, small blinds.';

    for (const player of this.players) {
      if (player.stack <= 0) player.stack = STARTING_STACK;
      player.bet = 0;
      player.committed = 0;
      player.holeCards = [];
      player.folded = false;
      player.allIn = false;
      player.status = 'Waiting';
      player.lastAction = 'Waiting';
      player.handResult = undefined;
    }

    this.dealerIndex = this.nextOccupiedSeat(this.dealerIndex);
    this.players[this.dealerIndex]!.status = 'Dealer';
    this.deck = shuffleDeck(createDeck(), this.rng);

    const smallBlindIndex = this.nextActiveIndex(this.dealerIndex);
    const bigBlindIndex = this.nextActiveIndex(smallBlindIndex);
    this.postBlind(smallBlindIndex, SMALL_BLIND, 'Small blind');
    this.postBlind(bigBlindIndex, BIG_BLIND, 'Big blind');
    this.currentBet = BIG_BLIND;
    this.minRaise = BIG_BLIND;

    for (let round = 0; round < 2; round += 1) {
      for (let offset = 1; offset <= this.players.length; offset += 1) {
        const index = (this.dealerIndex + offset) % this.players.length;
        const player = this.players[index]!;
        const card = this.draw();
        player.holeCards.push(card);
        this.emit({ type: 'deal-card', playerId: player.id, card, faceDown: !player.isHuman });
      }
    }

    this.currentIndex = this.nextActionableIndex(bigBlindIndex);
    this.processing = false;
    this.emitToast('New hand begins. The hearth is glowing.');
    this.emitState();
    if (this.autoBots) void this.advanceBots();
  }

  act(action: PokerAction): boolean {
    if (this.processing || this.currentIndex === null) return false;
    const player = this.players[this.currentIndex];
    if (!player || !player.isHuman || player.folded || player.allIn) return false;
    const legal = this.getLegalActions();
    if (!legal.isPlayerTurn) return false;
    const accepted = this.applyAction(this.currentIndex, action);
    if (accepted) {
      this.afterAction();
      if (this.autoBots) void this.advanceBots();
    }
    return accepted;
  }

  getPublicState(): PublicGameState {
    const legalActions = this.getLegalActions();
    const pot = this.players.reduce((sum, player) => sum + player.committed + player.bet, 0);
    return {
      handNumber: this.handNumber,
      stage: this.stage,
      pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerIndex: this.dealerIndex,
      currentIndex: this.currentIndex,
      communityCards: [...this.communityCards],
      players: this.players.map((player) => ({
        ...player,
        holeCards: player.isHuman || this.showdownOpen || this.stage === 'hand-complete' ? [...player.holeCards] : [],
        holeCardsHidden: !player.isHuman && !this.showdownOpen && this.stage !== 'hand-complete',
      })),
      message: this.message,
      winners: [...this.winners],
      lastHandName: this.lastHandName,
      legalActions,
    };
  }

  forceShowdownForTest(holeCards: Card[][], board: Card[], options: ForcedShowdownOptions = {}): void {
    this.startNewHand();
    this.communityCards = [...board];
    this.players.forEach((player, index) => {
      const contribution = options.contributions?.[index] ?? 0;
      player.stack = Math.max(0, STARTING_STACK - contribution);
      player.committed = contribution;
      player.holeCards = [...(holeCards[index] ?? [])];
      player.folded = options.folded?.[index] ?? false;
      player.allIn = options.forceAllIn ?? player.stack === 0;
      player.bet = 0;
      player.status = player.folded ? 'Folded' : 'Waiting';
      player.lastAction = player.folded ? 'Folded' : 'Waiting';
      player.handResult = undefined;
    });
    this.stage = 'showdown';
    this.currentBet = 0;
    this.currentIndex = null;
    this.actedThisRound.clear();
    this.resolveShowdown();
  }

  forceAllInRunoutForTest(holeCards: Card[][], contributions: number[]): void {
    this.startNewHand();
    this.communityCards = [];
    this.players.forEach((player, index) => {
      const contribution = contributions[index] ?? 0;
      player.stack = 0;
      player.committed = contribution;
      player.bet = 0;
      player.holeCards = [...(holeCards[index] ?? [])];
      player.folded = false;
      player.allIn = true;
      player.status = 'All-in';
      player.lastAction = `All-in for $${contribution}`;
      player.handResult = undefined;
    });
    this.stage = 'preflop';
    this.currentBet = 0;
    this.currentIndex = null;
    this.actedThisRound.clear();
    this.runBoardToRiver();
    this.stage = 'showdown';
    this.resolveShowdown();
  }

  debugForceCurrentCall(): boolean {
    if (this.currentIndex === null || this.processing) return false;
    const accepted = this.applyAction(this.currentIndex, { type: 'call' });
    if (accepted) this.afterAction();
    return accepted;
  }

  private draw(): Card {
    const card = this.deck.pop();
    if (!card) throw new Error('Deck exhausted');
    return card;
  }

  private postBlind(index: number, amount: number, status: Player['status']): void {
    const player = this.players[index]!;
    const paid = Math.min(amount, player.stack);
    player.stack -= paid;
    player.bet += paid;
    player.status = status;
    player.lastAction = `${status} $${paid}`;
    if (player.stack === 0) player.allIn = true;
    this.emit({ type: 'chip', playerId: player.id, amount: paid });
  }

  private applyAction(index: number, action: PokerAction): boolean {
    const player = this.players[index]!;
    const toCall = Math.max(0, this.currentBet - player.bet);
    if (action.type === 'fold') {
      this.actedThisRound.add(index);
      player.folded = true;
      player.status = 'Folded';
      player.lastAction = 'Folded';
      this.message = `${player.name} folds and keeps their cocoa warm.`;
      this.emitToast(player.isHuman ? 'You folded. Watch the fire and the board.' : `${player.name} folds.`);
      return true;
    }

    if (action.type === 'call') {
      this.actedThisRound.add(index);
      const paid = this.commitChips(player, toCall);
      player.status = toCall === 0 ? 'Checked' : player.allIn ? 'All-in' : 'Called';
      player.lastAction = toCall === 0 ? 'Checked' : `Called $${paid}`;
      this.message = toCall === 0 ? `${player.name} checks.` : `${player.name} calls $${paid}.`;
      if (paid > 0) this.emit({ type: 'chip', playerId: player.id, amount: paid });
      return true;
    }

    const targetBet = Math.floor(action.amount / 10) * 10;
    const legal = this.legalForPlayer(index);
    if (!legal.canRaise || targetBet < legal.minRaiseTo || targetBet > legal.maxRaiseTo) {
      return false;
    }
    const needed = targetBet - player.bet;
    const paid = this.commitChips(player, needed);
    const raiseBy = targetBet - this.currentBet;
    this.currentBet = Math.max(this.currentBet, player.bet);
    this.minRaise = Math.max(BIG_BLIND, raiseBy);
    this.actedThisRound = new Set([index]);
    player.status = player.allIn ? 'All-in' : this.currentBet === targetBet && this.currentBet > BIG_BLIND ? 'Raised' : 'Bet';
    player.lastAction = `${player.status} to $${player.bet}`;
    this.message = `${player.name} ${player.status.toLowerCase()} to $${player.bet}.`;
    this.emit({ type: 'chip', playerId: player.id, amount: paid });
    this.emitToast(player.isHuman ? `You ${player.status.toLowerCase()} to $${player.bet}.` : `${player.name} ${player.status.toLowerCase()}s.`);
    return true;
  }

  private commitChips(player: Player, amount: number): number {
    const paid = Math.max(0, Math.min(amount, player.stack));
    player.stack -= paid;
    player.bet += paid;
    if (player.stack === 0) {
      player.allIn = true;
      player.status = 'All-in';
    }
    return paid;
  }

  private afterAction(): void {
    if (this.onlyOnePlayerRemaining()) {
      this.awardUncontested();
      return;
    }

    if (this.bettingRoundComplete()) {
      this.advanceStage();
      return;
    }

    if (this.currentIndex !== null) {
      this.currentIndex = this.nextActionableIndex(this.currentIndex);
      this.setThinkingStatus();
    }
    this.emitState();
  }

  private bettingRoundComplete(): boolean {
    const contenders = this.players.filter((player) => !player.folded);
    const actionable = contenders.filter((player) => !player.allIn && player.stack > 0);
    if (actionable.length === 0) return true;
    const allMatched = actionable.every((player) => player.bet === this.currentBet);
    const everyoneActed = actionable.every((player) => this.actedThisRound.has(player.seat));
    return allMatched && everyoneActed;
  }

  private advanceStage(): void {
    this.collectBets();
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.actedThisRound.clear();
    for (const player of this.players) {
      if (!player.folded && !player.allIn) {
        player.status = 'Waiting';
        player.lastAction = 'Waiting';
      }
    }

    if (this.players.filter((player) => !player.folded && !player.allIn && player.stack > 0).length === 0) {
      this.runBoardToRiver();
      this.stage = 'showdown';
      this.resolveShowdown();
      return;
    }

    if (this.stage === 'preflop') {
      this.burn();
      for (let i = 0; i < 3; i += 1) this.dealCommunity();
      this.stage = 'flop';
      this.message = 'The flop lands soft as quilt squares.';
    } else if (this.stage === 'flop') {
      this.burn();
      this.dealCommunity();
      this.stage = 'turn';
      this.message = 'The turn card glows in the lantern light.';
    } else if (this.stage === 'turn') {
      this.burn();
      this.dealCommunity();
      this.stage = 'river';
      this.message = 'The river arrives. Last chance by the hearth.';
    } else if (this.stage === 'river') {
      this.stage = 'showdown';
      this.resolveShowdown();
      return;
    }

    this.currentIndex = this.firstActionAfterDealer();
    this.setThinkingStatus();
    this.emitToast(this.stage === 'flop' ? 'Flop is out.' : `${this.stage[0]?.toUpperCase()}${this.stage.slice(1)} card dealt.`);
    this.emitState();
    if (this.autoBots) void this.advanceBots();
  }

  private runBoardToRiver(): void {
    while (this.communityCards.length < 5) {
      this.burn();
      const cardsToDeal = this.communityCards.length === 0 ? 3 : 1;
      for (let i = 0; i < cardsToDeal && this.communityCards.length < 5; i += 1) {
        this.dealCommunity();
      }
    }
  }

  private burn(): void {
    this.draw();
  }

  private dealCommunity(): void {
    const card = this.draw();
    this.communityCards.push(card);
    this.emit({ type: 'deal-card', communityIndex: this.communityCards.length - 1, card, faceDown: false });
  }

  private collectBets(): void {
    for (const player of this.players) {
      player.committed += player.bet;
      player.bet = 0;
    }
  }

  private awardUncontested(): void {
    this.collectBets();
    const winner = this.players.find((player) => !player.folded);
    const pot = this.players.reduce((sum, player) => sum + player.committed, 0);
    if (winner) {
      winner.stack += pot;
      winner.status = 'Winner';
      winner.lastAction = `Won $${pot}`;
      this.winners = [winner.id];
      this.message = `${winner.name} wins $${pot} without a showdown.`;
      this.lastHandName = 'Uncontested pot';
    }
    this.clearCommitted();
    this.stage = 'hand-complete';
    this.currentIndex = null;
    this.showdownOpen = true;
    this.emitToast(this.message);
    this.emitState();
  }

  private resolveShowdown(): void {
    this.collectBets();
    if (this.communityCards.length < 5) this.runBoardToRiver();
    this.showdownOpen = true;
    const pot = this.players.reduce((sum, player) => sum + player.committed, 0);
    const contenders = this.players.filter((player) => !player.folded);
    const evaluated = new Map<string, EvaluatedHand>();

    let overallBestScore: number[] | null = null;
    let overallBestHand: EvaluatedHand | null = null;
    let overallWinners: Player[] = [];
    for (const player of contenders) {
      const hand = evaluateBestHand([...player.holeCards, ...this.communityCards]);
      evaluated.set(player.id, hand);
      player.handResult = hand.description;
      if (!overallBestScore || compareScores(hand.score, overallBestScore) > 0) {
        overallBestScore = hand.score;
        overallBestHand = hand;
        overallWinners = [player];
      } else if (compareScores(hand.score, overallBestScore) === 0) {
        overallWinners.push(player);
      }
    }

    const payouts = new Map<string, number>();
    const winnerIds = new Set<string>();
    const contributionLevels = [...new Set(this.players.map((player) => player.committed).filter((amount) => amount > 0))].sort((a, b) => a - b);
    let previousLevel = 0;

    for (const level of contributionLevels) {
      const contributors = this.players.filter((player) => player.committed >= level);
      const amount = (level - previousLevel) * contributors.length;
      previousLevel = level;
      if (amount <= 0) continue;

      const eligible = contributors.filter((player) => !player.folded);
      if (eligible.length === 0) continue;

      let bestScore: number[] | null = null;
      let potWinners: Player[] = [];
      for (const player of eligible) {
        const hand = evaluated.get(player.id);
        if (!hand) continue;
        if (!bestScore || compareScores(hand.score, bestScore) > 0) {
          bestScore = hand.score;
          potWinners = [player];
        } else if (compareScores(hand.score, bestScore) === 0) {
          potWinners.push(player);
        }
      }

      const share = Math.floor(amount / potWinners.length);
      let remainder = amount % potWinners.length;
      for (const winner of potWinners) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + share + extra);
        winnerIds.add(winner.id);
      }
    }

    if (winnerIds.size === 0) {
      for (const player of overallWinners) winnerIds.add(player.id);
    }

    for (const player of this.players) {
      const won = payouts.get(player.id) ?? 0;
      if (won > 0 || winnerIds.has(player.id)) {
        player.stack += won;
        player.status = 'Winner';
        player.lastAction = `Won $${won}`;
      }
    }

    this.winners = [...winnerIds];
    this.lastHandName = overallBestHand?.description ?? 'Showdown';
    const names = this.winners.map((id) => this.players.find((player) => player.id === id)?.name).filter(Boolean).join(' & ');
    this.message = `${names || 'No one'} win${this.winners.length === 1 ? 's' : ''} $${pot} across the pots with ${this.lastHandName}.`;
    this.clearCommitted();
    this.stage = 'hand-complete';
    this.currentIndex = null;
    this.emitToast(this.message);
    this.emitState();
  }

  private clearCommitted(): void {
    for (const player of this.players) {
      player.committed = 0;
      player.bet = 0;
    }
  }

  private async advanceBots(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.currentIndex !== null) {
        const player = this.players[this.currentIndex];
        if (!player || player.isHuman || this.stage === 'hand-complete') break;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 380));
        const action = this.chooseBotAction(this.currentIndex);
        this.applyAction(this.currentIndex, action);
        if (this.onlyOnePlayerRemaining()) {
          this.awardUncontested();
          break;
        }
        if (this.bettingRoundComplete()) {
          this.processing = false;
          this.advanceStage();
          return;
        }
        this.currentIndex = this.nextActionableIndex(this.currentIndex);
        this.setThinkingStatus();
        this.emitState();
      }
    } finally {
      this.processing = false;
      this.emitState();
    }
  }

  private chooseBotAction(index: number): PokerAction {
    const player = this.players[index]!;
    const legal = this.legalForPlayer(index);
    const holeStrength = this.estimateStrength(player);
    const pressure = legal.callAmount / Math.max(1, player.stack + player.bet);
    if (legal.callAmount > 0 && holeStrength + this.rng.next() * 0.35 < pressure * 1.55) {
      return { type: 'fold' };
    }
    if (legal.canRaise && holeStrength > 0.55 && this.rng.next() < 0.28) {
      const raiseTarget = Math.min(legal.maxRaiseTo, legal.minRaiseTo + this.rng.integer(8) * 10 + Math.floor(holeStrength * 50));
      return { type: 'raise', amount: raiseTarget };
    }
    return { type: 'call' };
  }

  private estimateStrength(player: Player): number {
    const ranks = player.holeCards.map((card) => card.rank).sort((a, b) => b - a);
    const suited = player.holeCards[0]?.suit === player.holeCards[1]?.suit;
    const pair = ranks[0] === ranks[1];
    let score = 0.18;
    if (pair) score += 0.36 + (ranks[0] ?? 2) / 40;
    score += ((ranks[0] ?? 2) + (ranks[1] ?? 2)) / 60;
    if (suited) score += 0.08;
    if (this.communityCards.length >= 3) {
      try {
        const best = evaluateBestHand([...player.holeCards, ...this.communityCards]);
        score += best.score[0]! / 12;
      } catch {
        // Pre-5-card stage strength remains heuristic.
      }
    }
    return Math.min(1, score);
  }

  private getLegalActions(): LegalActions {
    return this.currentIndex === null ? this.emptyLegalActions() : this.legalForPlayer(this.currentIndex);
  }

  private legalForPlayer(index: number): LegalActions {
    const player = this.players[index]!;
    const callAmount = Math.max(0, Math.min(this.currentBet - player.bet, player.stack));
    const minRaiseTo = this.currentBet === 0 ? BIG_BLIND : this.currentBet + this.minRaise;
    const maxRaiseTo = player.bet + player.stack;
    const isPlayerTurn =
      !this.processing && this.currentIndex === index && player.isHuman && !player.folded && !player.allIn && this.stage !== 'hand-complete';
    return {
      isPlayerTurn,
      canCheck: callAmount === 0,
      callAmount,
      minRaiseTo,
      maxRaiseTo,
      canRaise: maxRaiseTo >= minRaiseTo && !player.allIn && !player.folded,
    };
  }

  private emptyLegalActions(): LegalActions {
    return { isPlayerTurn: false, canCheck: false, callAmount: 0, minRaiseTo: BIG_BLIND, maxRaiseTo: 0, canRaise: false };
  }

  private firstActionAfterDealer(): number | null {
    let index = this.dealerIndex;
    for (let i = 0; i < this.players.length; i += 1) {
      index = this.nextActiveIndex(index);
      const player = this.players[index]!;
      if (!player.folded && !player.allIn) return index;
    }
    return null;
  }

  private nextOccupiedSeat(index: number): number {
    for (let i = 1; i <= this.players.length; i += 1) {
      const next = (index + i) % this.players.length;
      if (this.players[next]!.stack > 0) return next;
    }
    return 0;
  }

  private nextActiveIndex(index: number): number {
    for (let i = 1; i <= this.players.length; i += 1) {
      const next = (index + i) % this.players.length;
      const player = this.players[next]!;
      if (player.stack > 0 || player.bet > 0 || player.committed > 0) return next;
    }
    return index;
  }

  private nextActionableIndex(index: number): number | null {
    for (let i = 1; i <= this.players.length; i += 1) {
      const next = (index + i) % this.players.length;
      const player = this.players[next]!;
      if (!player.folded && !player.allIn && player.stack > 0) return next;
    }
    return null;
  }

  private setThinkingStatus(): void {
    for (const player of this.players) {
      if (!player.folded && !player.allIn && player.status === 'Thinking') player.status = 'Waiting';
    }
    if (this.currentIndex !== null) {
      const current = this.players[this.currentIndex]!;
      if (!current.folded && !current.allIn) current.status = 'Thinking';
    }
  }

  private onlyOnePlayerRemaining(): boolean {
    return this.players.filter((player) => !player.folded).length === 1;
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitState(): void {
    this.emit({ type: 'state', state: this.getPublicState() });
  }

  private emitToast(message: string): void {
    this.emit({ type: 'toast', message });
  }

  bestHumanHandLabel(): string {
    const human = this.players[0]!;
    return bestHandLabel([...human.holeCards, ...this.communityCards]);
  }

  debugSnapshot(): PublicGameState & { humanCards: string[]; community: string[] } {
    const state = this.getPublicState();
    return {
      ...state,
      humanCards: this.players[0]!.holeCards.map(cardLabel),
      community: this.communityCards.map(cardLabel),
    };
  }
}
