import * as THREE from 'three';
import './style.css';
import { cardLabel } from './poker/cards';
import { bestHandLabel } from './poker/evaluator';
import { HoldemGame, type GameEvent } from './poker/game';
import type { Card, PublicGameState, PublicPlayer } from './poker/types';

type CardVisual = {
  key: string;
  group: THREE.Group;
  face: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  base: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  label: string;
  target: THREE.Vector3;
  rotationY: number;
};

type Tween = {
  object: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromRotY: number;
  toRotY: number;
  elapsed: number;
  duration: number;
  arc: number;
};

type SeatVisual = {
  root: THREE.Group;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  betGroup: THREE.Group;
};

type DebugApi = {
  ready: boolean;
  newHand: () => void;
  act: (action: 'fold' | 'call' | 'raise', amount?: number) => boolean | void;
  state: () => PublicGameState;
  canvasSize: () => { width: number; height: number };
};

declare global {
  interface Window {
    __hearthsideDebug: DebugApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Canvas #game-canvas was not found');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x170d09);
scene.fog = new THREE.FogExp2(0x2b160d, 0.032);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 7.2, 8.4);
camera.lookAt(0, 0.55, 0);

let lastFrameTime = performance.now();
let elapsedTime = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(99, 99);
const textureCache = new Map<string, THREE.CanvasTexture>();
const cardVisuals = new Map<string, CardVisual>();
const tweens: Tween[] = [];
const clickableCards: THREE.Object3D[] = [];
let visualHandNumber = -1;
let hoveredCard: CardVisual | null = null;

const tableGroup = new THREE.Group();
const seatsGroup = new THREE.Group();
const cardsGroup = new THREE.Group();
const chipGroup = new THREE.Group();
const potGroup = new THREE.Group();
const emberGroup = new THREE.Group();
const deckPosition = new THREE.Vector3(-2.86, 0.92, -0.05);
const seatVisuals = new Map<string, SeatVisual>();

const ui = {
  roundBadge: mustElement<HTMLElement>('roundBadge'),
  potText: mustElement<HTMLElement>('potText'),
  stackText: mustElement<HTMLElement>('stackText'),
  toCallText: mustElement<HTMLElement>('toCallText'),
  bestHandText: mustElement<HTMLElement>('bestHandText'),
  messageText: mustElement<HTMLElement>('messageText'),
  playersPanel: mustElement<HTMLElement>('playersPanel'),
  foldBtn: mustElement<HTMLButtonElement>('foldBtn'),
  callBtn: mustElement<HTMLButtonElement>('callBtn'),
  raiseBtn: mustElement<HTMLButtonElement>('raiseBtn'),
  newHandBtn: mustElement<HTMLButtonElement>('newHandBtn'),
  raiseSlider: mustElement<HTMLInputElement>('raiseSlider'),
  raiseLabel: mustElement<HTMLElement>('raiseLabel'),
  toastText: mustElement<HTMLElement>('toastText'),
};

const feltMaterial = new THREE.MeshStandardMaterial({
  color: 0x245f45,
  roughness: 0.92,
  metalness: 0.02,
  map: makeNoiseTexture('felt', '#1f6a49', '#2f7d59', 0.22),
});
const woodMaterial = new THREE.MeshStandardMaterial({
  color: 0x6c351d,
  roughness: 0.62,
  metalness: 0.02,
  map: makeWoodTexture(),
});
const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xffcb68, roughness: 0.36, metalness: 0.38 });
const darkLeather = new THREE.MeshStandardMaterial({ color: 0x24140e, roughness: 0.78, metalness: 0.01 });

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function money(amount: number): string {
  return `$${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`;
}

function stageName(stage: string): string {
  return stage
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function seatAngle(seat: number): number {
  return Math.PI / 2 + (seat * Math.PI * 2) / 6;
}

function seatPosition(seat: number, radiusX = 5.2, radiusZ = 3.35): THREE.Vector3 {
  const angle = seatAngle(seat);
  return new THREE.Vector3(Math.cos(angle) * radiusX, 0.55, Math.sin(angle) * radiusZ);
}

function cardSeatPosition(seat: number): THREE.Vector3 {
  const angle = seatAngle(seat);
  return new THREE.Vector3(Math.cos(angle) * 2.94, 0.92, Math.sin(angle) * 1.96);
}

function cardRotationForSeat(seat: number): number {
  return seatAngle(seat) - Math.PI / 2;
}

function getHoleCardTransform(player: PublicPlayer, index: number): { position: THREE.Vector3; rotationY: number } {
  const angle = seatAngle(player.seat);
  const base = cardSeatPosition(player.seat);
  const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const offset = index === 0 ? -0.23 : 0.23;
  return { position: base.addScaledVector(side, offset), rotationY: cardRotationForSeat(player.seat) };
}

function getCommunityTransform(index: number): { position: THREE.Vector3; rotationY: number } {
  return { position: new THREE.Vector3(-1.58 + index * 0.79, 0.94, -0.16), rotationY: 0 };
}

function makeNoiseTexture(key: string, base: string, fleck: string, strength: number): THREE.CanvasTexture {
  const cacheKey = `noise:${key}:${base}:${fleck}:${strength}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Could not create 2D context');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4200; i += 1) {
    const alpha = Math.random() * strength;
    ctx.fillStyle = hexToRgba(fleck, alpha);
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  textureCache.set(cacheKey, texture);
  return texture;
}

function makeWoodTexture(): THREE.CanvasTexture {
  const cached = textureCache.get('wood');
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Could not create wood texture');
  const gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
  gradient.addColorStop(0, '#4b2315');
  gradient.addColorStop(0.5, '#8d4a27');
  gradient.addColorStop(1, '#3b1b12');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y += 18) {
    ctx.strokeStyle = `rgba(255, 188, 96, ${0.06 + Math.random() * 0.05})`;
    ctx.lineWidth = 2 + Math.random() * 3;
    ctx.beginPath();
    for (let x = 0; x <= c.width; x += 16) {
      const wave = Math.sin(x * 0.03 + y * 0.08) * 8;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  textureCache.set('wood', texture);
  return texture;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeCardTexture(card: Card | null, hidden: boolean): THREE.CanvasTexture {
  const key = hidden || !card ? 'card:back' : `card:${cardLabel(card)}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 720;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Could not create card texture');

  roundRect(ctx, 18, 18, 476, 684, 34);
  if (hidden || !card) {
    const gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
    gradient.addColorStop(0, '#173b31');
    gradient.addColorStop(0.55, '#245f45');
    gradient.addColorStop(1, '#0f2722');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#ffd67a';
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, 48, 48, 416, 624, 28);
    ctx.clip();
    for (let x = -220; x < 740; x += 54) {
      ctx.strokeStyle = 'rgba(255, 214, 122, 0.2)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, -20);
      ctx.lineTo(x + 500, 740);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 500, -20);
      ctx.lineTo(x, 740);
      ctx.stroke();
    }
    ctx.restore();
    ctx.font = '900 112px Fraunces, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff0d6';
    ctx.fillText('H', 256, 340);
    ctx.font = '800 28px Inter, sans-serif';
    ctx.fillStyle = '#ffd67a';
    ctx.fillText('HEARTHSIDE', 256, 420);
  } else {
    const isRed = card.suit === '♥' || card.suit === '♦';
    ctx.fillStyle = '#fff8e8';
    ctx.fill();
    ctx.strokeStyle = '#4b2718';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = isRed ? '#d84f45' : '#211713';
    ctx.lineWidth = 4;
    roundRect(ctx, 42, 42, 428, 636, 22);
    ctx.stroke();

    const color = isRed ? '#c83f39' : '#16110f';
    ctx.fillStyle = color;
    ctx.font = '900 92px Fraunces, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cardLabel(card).slice(0, -1), 62, 58);
    ctx.font = '900 70px Georgia, serif';
    ctx.fillText(card.suit, 68, 145);

    ctx.save();
    ctx.translate(256, 360);
    ctx.font = '900 250px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(card.suit, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(512, 720);
    ctx.rotate(Math.PI);
    ctx.font = '900 92px Fraunces, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cardLabel(card).slice(0, -1), 62, 58);
    ctx.font = '900 70px Georgia, serif';
    ctx.fillText(card.suit, 68, 145);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(c);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createLabelSprite(text: string, color = '#fff0d6', bg = 'rgba(32,19,13,0.74)'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Could not create sprite texture');
  ctx.fillStyle = bg;
  roundRect(ctx, 14, 22, 484, 116, 38);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,122,0.35)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.font = '900 46px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 81);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.75, 0.55, 1);
  return sprite;
}

function setupLighting(): void {
  const hemi = new THREE.HemisphereLight(0xffe6bb, 0x2d1710, 1.42);
  scene.add(hemi);

  const key = new THREE.SpotLight(0xffd79b, 82, 17, Math.PI / 4.6, 0.72, 1.7);
  key.position.set(0, 7.5, 2.2);
  key.target.position.set(0, 0.55, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  scene.add(key, key.target);

  const fireLight = new THREE.PointLight(0xff7a2f, 55, 9, 2.1);
  fireLight.position.set(0, 1.35, -5.2);
  fireLight.name = 'fireLight';
  scene.add(fireLight);

  const tableGlow = new THREE.PointLight(0xffc979, 18, 8, 2.2);
  tableGlow.position.set(0, 1.5, 0.4);
  scene.add(tableGlow);
}

function setupRoom(): void {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), woodMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(5.8, 96),
    new THREE.MeshStandardMaterial({ color: 0x7c3527, roughness: 0.9, map: makeNoiseTexture('rug', '#713124', '#ffd67a', 0.11) }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.012;
  rug.scale.set(1.28, 0.82, 1);
  rug.receiveShadow = true;
  scene.add(rug);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x351b12, roughness: 0.82, map: makeWoodTexture() });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(14, 5.2, 0.38), wallMat);
  backWall.position.set(0, 2.55, -6.1);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const sideWallL = new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.2, 12), wallMat);
  sideWallL.position.set(-7.1, 2.1, -0.4);
  scene.add(sideWallL);
  const sideWallR = sideWallL.clone();
  sideWallR.position.x = 7.1;
  scene.add(sideWallR);

  const mantle = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.28, 0.42), woodMaterial);
  mantle.position.set(0, 1.95, -5.72);
  mantle.castShadow = true;
  scene.add(mantle);

  const hearth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 1.05), darkLeather);
  hearth.position.set(0, 0.13, -5.36);
  hearth.castShadow = true;
  hearth.receiveShadow = true;
  scene.add(hearth);

  const fireBox = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.45, 0.24), new THREE.MeshStandardMaterial({ color: 0x140b08, roughness: 0.86 }));
  fireBox.position.set(0, 0.95, -5.82);
  scene.add(fireBox);

  for (let i = 0; i < 5; i += 1) {
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.18 + i * 0.018, 16, 12),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffb85c : 0xff6a2e, transparent: true, opacity: 0.68 }),
    );
    flame.position.set(-0.42 + i * 0.21, 0.74 + (i % 2) * 0.12, -5.55);
    flame.scale.set(0.55, 1.7, 0.35);
    flame.userData.baseY = flame.position.y;
    emberGroup.add(flame);
  }

  for (let i = 0; i < 26; i += 1) {
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 + Math.random() * 0.026, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffbf73, transparent: true, opacity: 0.56 }),
    );
    ember.position.set((Math.random() - 0.5) * 2.1, 0.6 + Math.random() * 1.7, -5.15 + (Math.random() - 0.5) * 0.5);
    ember.userData.speed = 0.18 + Math.random() * 0.34;
    ember.userData.seed = Math.random() * 100;
    emberGroup.add(ember);
  }
  scene.add(emberGroup);
}

function setupTable(): void {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.96, 4.12, 0.32, 96), woodMaterial);
  base.scale.set(1.36, 1, 0.84);
  base.position.y = 0.48;
  base.castShadow = true;
  base.receiveShadow = true;
  tableGroup.add(base);

  const felt = new THREE.Mesh(new THREE.CylinderGeometry(3.62, 3.66, 0.12, 96), feltMaterial);
  felt.scale.set(1.32, 1, 0.8);
  felt.position.y = 0.72;
  felt.castShadow = true;
  felt.receiveShadow = true;
  tableGroup.add(felt);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.74, 0.11, 16, 160), woodMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.34, 1, 0.82);
  rim.position.y = 0.83;
  rim.castShadow = true;
  tableGroup.add(rim);

  const inlay = new THREE.Mesh(new THREE.TorusGeometry(2.54, 0.018, 8, 132), goldMaterial);
  inlay.rotation.x = Math.PI / 2;
  inlay.scale.set(1.52, 1, 0.84);
  inlay.position.y = 0.906;
  tableGroup.add(inlay);

  const logo = createLabelSprite('Hearthside Hold’em', '#ffd67a', 'rgba(23, 59, 49, 0.86)');
  logo.position.set(0, 0.96, 0.78);
  logo.scale.set(2.55, 0.62, 1);
  tableGroup.add(logo);

  createDeckStack();
  tableGroup.add(cardsGroup, chipGroup, potGroup);
  scene.add(tableGroup);
}

function createDeckStack(): void {
  for (let i = 0; i < 8; i += 1) {
    const card = createCardVisual(`deck-${i}`, null, true);
    card.group.position.copy(deckPosition).add(new THREE.Vector3(0, i * 0.013, 0));
    card.group.rotation.y = -0.08;
    card.group.scale.setScalar(0.94);
    tableGroup.add(card.group);
  }
}

function createCardVisual(key: string, card: Card | null, hidden: boolean): CardVisual {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.04, 1.08),
    new THREE.MeshStandardMaterial({ color: 0xfff4df, roughness: 0.58, metalness: 0.01 }),
  );
  base.castShadow = true;
  base.receiveShadow = true;
  const faceMaterial = new THREE.MeshBasicMaterial({ map: makeCardTexture(card, hidden), transparent: true, toneMapped: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.03), faceMaterial);
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.023;
  face.name = key;
  face.userData.cardKey = key;
  const group = new THREE.Group();
  group.add(base, face);
  group.userData.cardKey = key;
  clickableCards.push(face);
  return { key, group, face, base, label: hidden || !card ? 'BACK' : cardLabel(card), target: new THREE.Vector3(), rotationY: 0 };
}

function updateCardTexture(visual: CardVisual, card: Card | null, hidden: boolean): void {
  const nextLabel = hidden || !card ? 'BACK' : cardLabel(card);
  if (nextLabel === visual.label) return;
  visual.label = nextLabel;
  visual.face.material.map = makeCardTexture(card, hidden);
  visual.face.material.needsUpdate = true;
}

function moveTo(object: THREE.Object3D, target: THREE.Vector3, rotationY: number, duration = 0.55, arc = 0.36): void {
  const existing = tweens.find((tween) => tween.object === object);
  if (existing) {
    existing.to.copy(target);
    existing.toRotY = rotationY;
    existing.duration = duration;
    return;
  }
  tweens.push({
    object,
    from: object.position.clone(),
    to: target.clone(),
    fromRotY: object.rotation.y,
    toRotY: rotationY,
    elapsed: 0,
    duration,
    arc,
  });
}

function syncCards(state: PublicGameState): void {
  if (state.handNumber !== visualHandNumber) {
    for (const visual of cardVisuals.values()) {
      cardsGroup.remove(visual.group);
    }
    cardVisuals.clear();
    clickableCards.length = 0;
    visualHandNumber = state.handNumber;
  }

  const activeKeys = new Set<string>();
  for (const player of state.players) {
    const shouldShow = state.stage !== 'idle' && player.stack + player.bet + player.committed > 0;
    if (!shouldShow) continue;
    const cardCount = Math.max(player.holeCards.length, player.folded && !player.isHuman ? 0 : 2);
    for (let i = 0; i < cardCount; i += 1) {
      const key = `${player.id}-hole-${i}`;
      activeKeys.add(key);
      const card = player.holeCards[i] ?? null;
      const hidden = player.holeCardsHidden || !card;
      const transform = getHoleCardTransform(player, i);
      let visual = cardVisuals.get(key);
      if (!visual) {
        visual = createCardVisual(key, card, hidden);
        visual.group.position.copy(deckPosition);
        visual.group.rotation.y = -0.08;
        cardVisuals.set(key, visual);
        cardsGroup.add(visual.group);
      }
      updateCardTexture(visual, card, hidden);
      visual.target.copy(transform.position);
      visual.rotationY = transform.rotationY;
      visual.group.visible = !player.folded || player.isHuman || state.stage === 'hand-complete';
      visual.group.scale.setScalar(player.folded ? 0.88 : 1);
      visual.base.material.opacity = player.folded ? 0.58 : 1;
      visual.base.material.transparent = player.folded;
      moveTo(visual.group, transform.position, transform.rotationY, 0.58, 0.42);
    }
  }

  state.communityCards.forEach((card, index) => {
    const key = `community-${index}`;
    activeKeys.add(key);
    const transform = getCommunityTransform(index);
    let visual = cardVisuals.get(key);
    if (!visual) {
      visual = createCardVisual(key, card, false);
      visual.group.position.copy(deckPosition);
      visual.group.rotation.y = -0.08;
      cardVisuals.set(key, visual);
      cardsGroup.add(visual.group);
    }
    updateCardTexture(visual, card, false);
    visual.target.copy(transform.position);
    visual.rotationY = transform.rotationY;
    visual.group.visible = true;
    visual.group.scale.setScalar(1);
    moveTo(visual.group, transform.position, transform.rotationY, 0.62, 0.45);
  });

  for (const [key, visual] of cardVisuals) {
    if (!activeKeys.has(key)) {
      cardsGroup.remove(visual.group);
      cardVisuals.delete(key);
    }
  }
}

function createChipStack(amount: number, parent: THREE.Group, center: THREE.Vector3, maxChips = 16): void {
  parent.clear();
  if (amount <= 0) return;
  const chipCount = Math.min(maxChips, Math.max(1, Math.ceil(amount / 25)));
  for (let i = 0; i < chipCount; i += 1) {
    const valueColor = i % 5 === 0 ? 0xffd67a : i % 3 === 0 ? 0x8fd6ff : 0xff746b;
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.048, 24),
      new THREE.MeshStandardMaterial({ color: valueColor, roughness: 0.32, metalness: 0.08 }),
    );
    chip.position.set(center.x + (i % 3) * 0.055, center.y + i * 0.046, center.z + Math.floor(i / 3) * 0.048);
    chip.rotation.x = Math.PI / 2;
    chip.castShadow = true;
    parent.add(chip);
  }
  const label = createLabelSprite(money(amount), '#fff0d6', 'rgba(32, 19, 13, 0.72)');
  label.position.copy(center).add(new THREE.Vector3(0, 0.46 + chipCount * 0.026, 0));
  label.scale.set(0.82, 0.26, 1);
  parent.add(label);
}

function syncChips(state: PublicGameState): void {
  createChipStack(state.pot, potGroup, new THREE.Vector3(0, 0.98, -0.86), 22);
  for (const player of state.players) {
    const visual = seatVisuals.get(player.id);
    if (!visual) continue;
    const angle = seatAngle(player.seat);
    const betPos = new THREE.Vector3(Math.cos(angle) * 2.14, 0.98, Math.sin(angle) * 1.35);
    createChipStack(player.bet, visual.betGroup, betPos, 10);
  }
}

function setupSeats(): void {
  const colors = [0xffd67a, 0x98d8b7, 0xc7b5ff, 0xff9b71, 0x8fd6ff, 0xf4a7c5];
  PLAYER_SEAT_NAMES.forEach((name, seat) => {
    const root = new THREE.Group();
    const pos = seatPosition(seat);
    root.position.copy(pos);
    root.lookAt(0, pos.y, 0);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.58, 8, 18), new THREE.MeshStandardMaterial({ color: colors[seat]!, roughness: 0.68 }));
    body.position.y = 0.54;
    body.castShadow = true;
    root.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), new THREE.MeshStandardMaterial({ color: 0xffd9b5, roughness: 0.76 }));
    head.position.y = 1.05;
    head.castShadow = true;
    root.add(head);

    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 28), new THREE.MeshStandardMaterial({ color: 0x7c3527, roughness: 0.7 }));
    scarf.position.y = 0.83;
    scarf.rotation.x = Math.PI / 2;
    root.add(scarf);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.53, 0.64, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd67a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.035;
    root.add(halo);

    const label = createLabelSprite(name, '#fff0d6', 'rgba(32, 19, 13, 0.72)');
    label.position.set(0, 1.55, 0);
    label.scale.set(1.2, 0.38, 1);
    root.add(label);

    const betGroup = new THREE.Group();
    chipGroup.add(betGroup);
    seatsGroup.add(root);
    seatVisuals.set(`p${seat}`, { root, halo, label, betGroup });
  });
  scene.add(seatsGroup);
}

const PLAYER_SEAT_NAMES = ['You', 'Moss', 'Juniper', 'Ember', 'Clover', 'Pip'];

function syncSeats(state: PublicGameState): void {
  for (const player of state.players) {
    const visual = seatVisuals.get(player.id);
    if (!visual) continue;
    const isTurn = state.currentIndex === player.seat;
    const isWinner = state.winners.includes(player.id);
    visual.halo.material.opacity = isWinner ? 0.72 : isTurn ? 0.58 : player.folded ? 0.08 : 0.18;
    visual.halo.material.color.set(isWinner ? 0xfff0a3 : isTurn ? 0xffb85c : 0x98d8b7);
    visual.root.scale.lerp(new THREE.Vector3(isTurn || isWinner ? 1.1 : 1, isWinner ? 1.12 : 1, isTurn || isWinner ? 1.1 : 1), 0.22);
    visual.root.visible = player.stack + player.bet + player.committed > 0;
  }
}

function updateUI(state: PublicGameState): void {
  ui.roundBadge.textContent = `${stageName(state.stage)} • Hand ${state.handNumber || 1}`;
  ui.potText.textContent = money(state.pot);
  const human = state.players[0];
  ui.stackText.textContent = money(human?.stack ?? 0);
  ui.toCallText.textContent = state.legalActions.callAmount > 0 ? money(state.legalActions.callAmount) : 'Check is free';
  ui.messageText.textContent = state.message;

  if (human) {
    const cards = [...human.holeCards, ...state.communityCards];
    ui.bestHandText.textContent = cards.length >= 5 ? bestHandLabel(cards) : 'Waiting for the flop';
  }

  const legal = state.legalActions;
  ui.foldBtn.disabled = !legal.isPlayerTurn;
  ui.callBtn.disabled = !legal.isPlayerTurn;
  ui.raiseBtn.disabled = !legal.isPlayerTurn || !legal.canRaise;
  ui.raiseSlider.disabled = !legal.isPlayerTurn || !legal.canRaise;
  ui.callBtn.textContent = legal.canCheck ? 'Check' : `Call ${money(legal.callAmount)}`;
  if (legal.canRaise) {
    ui.raiseSlider.min = String(legal.minRaiseTo);
    ui.raiseSlider.max = String(Math.max(legal.minRaiseTo, legal.maxRaiseTo));
    if (Number(ui.raiseSlider.value) < legal.minRaiseTo || Number(ui.raiseSlider.value) > legal.maxRaiseTo) {
      ui.raiseSlider.value = String(Math.min(legal.maxRaiseTo, legal.minRaiseTo + 40));
    }
    ui.raiseLabel.textContent = `Raise to ${money(Number(ui.raiseSlider.value))}`;
    ui.raiseBtn.textContent = state.currentBet === 0 ? 'Bet' : 'Raise';
  } else {
    ui.raiseLabel.textContent = 'Raise unavailable';
    ui.raiseBtn.textContent = 'Bet / Raise';
  }
  ui.newHandBtn.textContent = state.stage === 'hand-complete' || state.stage === 'idle' ? 'New Hand' : 'Redeal';

  ui.playersPanel.innerHTML = state.players
    .map((player) => {
      const classes = ['player-pill'];
      if (state.currentIndex === player.seat) classes.push('is-turn');
      const cards = player.holeCardsHidden ? '🂠 🂠' : player.holeCards.map(cardLabel).join(' ');
      const result = player.handResult ? `<span class="player-bet">${escapeHtml(player.handResult)}</span>` : `<span class="player-bet">Bet ${money(player.bet)} • ${cards}</span>`;
      return `<div class="${classes.join(' ')}">
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-status">${escapeHtml(player.status)}</span>
        <span class="player-stack">${money(player.stack)}</span>
        ${result}
      </div>`;
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message: string): void {
  ui.toastText.textContent = message;
  ui.toastText.classList.add('show');
  window.setTimeout(() => ui.toastText.classList.remove('show'), 2400);
}

function handleGameEvent(event: GameEvent): void {
  if (event.type === 'state') {
    syncCards(event.state);
    syncSeats(event.state);
    syncChips(event.state);
    updateUI(event.state);
  } else if (event.type === 'toast') {
    showToast(event.message);
  } else if (event.type === 'chip') {
    showToast(`${event.amount > 0 ? money(event.amount) : 'Chips'} slid into the pot.`);
  }
}

function setupInteractions(game: HoldemGame): void {
  ui.foldBtn.addEventListener('click', () => game.act({ type: 'fold' }));
  ui.callBtn.addEventListener('click', () => game.act({ type: 'call' }));
  ui.raiseBtn.addEventListener('click', () => game.act({ type: 'raise', amount: Number(ui.raiseSlider.value) }));
  ui.newHandBtn.addEventListener('click', () => game.startNewHand());
  ui.raiseSlider.addEventListener('input', () => {
    ui.raiseLabel.textContent = `Raise to ${money(Number(ui.raiseSlider.value))}`;
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    pointer.set(99, 99);
    hoveredCard = null;
  });
  renderer.domElement.addEventListener('click', () => {
    if (hoveredCard && hoveredCard.label !== 'BACK') showToast(`A cozy look at ${hoveredCard.label}.`);
  });
}

function setupDebugApi(game: HoldemGame): void {
  window.__hearthsideDebug = {
    ready: true,
    newHand: () => game.startNewHand(),
    act: (action, amount) => {
      if (action === 'raise') return game.act({ type: 'raise', amount: amount ?? Number(ui.raiseSlider.value) });
      return game.act({ type: action });
    },
    state: () => game.getPublicState(),
    canvasSize: () => ({ width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight }),
  };
}

function updateTweens(delta: number): void {
  for (let i = tweens.length - 1; i >= 0; i -= 1) {
    const tween = tweens[i];
    if (!tween) continue;
    tween.elapsed += delta;
    const t = Math.min(1, tween.elapsed / tween.duration);
    const eased = easeOutCubic(t);
    tween.object.position.lerpVectors(tween.from, tween.to, eased);
    tween.object.position.y += Math.sin(t * Math.PI) * tween.arc;
    tween.object.rotation.y = THREE.MathUtils.lerp(tween.fromRotY, tween.toRotY, eased);
    tween.object.rotation.z = Math.sin(t * Math.PI) * 0.08;
    if (t >= 1) {
      tween.object.position.copy(tween.to);
      tween.object.rotation.y = tween.toRotY;
      tween.object.rotation.z = 0;
      tweens.splice(i, 1);
    }
  }
}

function updateHover(): void {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickableCards, false);
  const hit = hits[0]?.object;
  const key = typeof hit?.userData.cardKey === 'string' ? hit.userData.cardKey : null;
  const visual = key ? cardVisuals.get(key) ?? null : null;
  if (hoveredCard && hoveredCard !== visual) {
    hoveredCard.group.position.y = hoveredCard.target.y;
  }
  hoveredCard = visual;
  document.body.style.cursor = visual ? 'pointer' : 'default';
  if (visual) {
    visual.group.position.y = THREE.MathUtils.lerp(visual.group.position.y, visual.target.y + 0.08, 0.18);
  }
}

function updateAmbientAnimation(elapsed: number, delta: number): void {
  const fireLight = scene.getObjectByName('fireLight') as THREE.PointLight | undefined;
  if (fireLight) fireLight.intensity = 48 + Math.sin(elapsed * 7.1) * 7 + Math.sin(elapsed * 13.7) * 3;
  emberGroup.children.forEach((child, index) => {
    if (child instanceof THREE.Mesh) {
      const seed = Number(child.userData.seed ?? index);
      const speed = Number(child.userData.speed ?? 0.2);
      child.position.y += speed * delta;
      child.position.x += Math.sin(elapsed * 1.7 + seed) * delta * 0.08;
      child.scale.setScalar(0.88 + Math.sin(elapsed * 5 + seed) * 0.12);
      if (child.position.y > 2.45) child.position.y = 0.62;
    }
  });

  seatsGroup.children.forEach((seat, index) => {
    seat.position.y = 0.55 + Math.sin(elapsed * 1.4 + index) * 0.025;
  });
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function animate(): void {
  const now = performance.now();
  const delta = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  elapsedTime += delta;
  const elapsed = elapsedTime;
  updateTweens(delta);
  updateHover();
  updateAmbientAnimation(elapsed, delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setupLighting();
setupRoom();
setupTable();
setupSeats();

const game = new HoldemGame(20260708);
game.on(handleGameEvent);
setupInteractions(game);
setupDebugApi(game);
window.addEventListener('resize', onResize);
game.startNewHand();
animate();

console.info('Hearthside Hold’em ready', { three: THREE.REVISION });
