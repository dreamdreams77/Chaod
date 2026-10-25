/**
 * The world of CHAOS.exe — original cast, lore and dialogue.
 * Kept as data so writers can edit it without touching gameplay code.
 */
import type { PortraitId } from '../render/actors.ts';
import { MODE_IDS, type ModeId } from '../core/save.ts';

export interface Line {
  who: PortraitId;
  name: string;
  text: string;
  choices?: Array<{ label: string; effect?: string }>;
  /** Show the whole line at once (info cards), so one press closes it. */
  instant?: boolean;
}

export const CAST = {
  cass: { name: 'CASS ETTE', role: 'Protagonist', bio: 'A 1990s save-file tester who fell into the Cartridge Core while blowing dust off it. Speaks fluent cheat code.' },
  manual: { name: 'THE MANUAL', role: 'Mysterious guide', bio: 'A sentient instruction booklet missing half its pages. Knows everything it is allowed to remember.' },
  byte: { name: 'BYTE', role: 'Ally (virtual pet)', bio: 'A pocket-pet blob that hatched during the Crash. Grows braver the more you care for it.' },
  rex: { name: 'REX TURBO', role: 'Rival', bio: 'A kart racer who has been stuck on "lap 3 of 3" since 1996. Refuses to admit the race ended.' },
  polygon: { name: 'MADAME POLYGON', role: 'Ally / shopkeeper', bio: 'A fortune teller from a 3D game trapped in a 2D world. Sells upgrades and unsettlingly accurate prophecies.' },
  kevin: { name: 'KEVIN FROM QA', role: 'Recurring comedic character', bio: 'Files bug reports against reality. Whenever Kevin "fixes" a rule, the rule changes.' },
  demo: { name: 'DEMO', role: 'Secret character', bio: 'The developer\'s dog, who has been playing the attract-mode demo loop for thirty years. A very good boy with a double jump.' },
};

export const BOSSES: Array<{ id: string; name: string; mode: ModeId | 'roadmap'; title: string; bio: string }> = [
  { id: 'bricklord', name: 'BRICKLORD MAX', mode: 'beatdown', title: 'The Falling-Block Golem', bio: 'A golem of puzzle blocks who was the final boss of a puzzle game no one finished. Wants, desperately, to be cleared.' },
  { id: 'static', name: 'DJ STATIC', mode: 'rhythm', title: 'The Glitch Selector', bio: 'A rhythm-game announcer made of TV snow. Remixes reality because nobody ever let them pick the song.' },
  { id: 'lurker', name: 'THE LURKER', mode: 'neon', title: 'The Thing in the Rear-View', bio: 'A racing ghost that feeds on hesitation. It was the "ghost car" in a time-trial mode, and got hungry.' },
  { id: 'manager', name: 'THE CLOSING-TIME MANAGER', mode: 'mall', title: 'Mini-Boss, Retired', bio: 'Demoted from mini-boss to mall manager in 1994. Hunts anyone still shopping after closing.' },
  { id: 'highscore', name: 'THE HIGH SCORE', mode: 'highscore', title: 'Top of Every Leaderboard', bio: 'An entity made of every initials-entry ever typed. It caused the Crash so that no one could ever beat it. The last page of the Manual is behind its panel.' },
];

export const INTRO: Line[] = [
  { who: 'manual', name: 'THE MANUAL', text: 'Oh! A player! Do not panic. You have fallen inside the CARTRIDGE CORE.' },
  { who: 'cass', name: 'CASS', text: 'I was only blowing the dust off it...' },
  { who: 'manual', name: 'THE MANUAL', text: 'The Core kept every genre in its own cartridge. Then came THE GREAT GENRE CRASH. Now racing tracks run through shopping malls.' },
  { who: 'manual', name: 'THE MANUAL', text: 'Each ARCADE CABINET here is a portal into a broken world. Clear them, collect FLOPPY DISKS, and maybe we can reboot the Core.' },
  { who: 'byte', name: 'BYTE', text: 'Bweep!' },
  { who: 'manual', name: 'THE MANUAL', text: 'That is BYTE. It hatched during the Crash. Feed it. It will remember.' },
  { who: 'manual', name: 'THE MANUAL', text: 'Arrows to move. Walk up to things and press Z to interact. Start with the yellow cabinet: RETRO RAMPAGE.' },
];

/** The Manual reveals more of the mystery as the player progresses. */
export function manualLines(progress: { clears: number; bosses: string[]; floppies: number; trust: number; ending: boolean }): Line[] {
  // Only the two story bosses are Core shards (robot masters and THE HIGH SCORE also live in the list).
  const shards = progress.bosses.filter((b) => b === 'bricklord' || b === 'static').length;
  const L = (text: string): Line => ({ who: 'manual', name: 'THE MANUAL', text });
  if (progress.ending) {
    return [L('The Core is humming again. But the page I tore out... I can feel it out there. With THE HIGH SCORE.'), L('Thank you for letting me be more than instructions.')];
  }
  if (shards >= 2) {
    return [
      L('Both shards recovered! Bring them to the CARTRIDGE CORE in the middle of the lobby.'),
      L('...Cass. Before you do. I need to confess something.'),
      { who: 'manual', name: 'THE MANUAL', text: 'The Crash was not an accident. I tore out my own pages. The bosses begged me. They were tired of being final levels.', choices: [{ label: 'You did the right thing', effect: 'trust+' }, { label: 'People got hurt', effect: 'trust-' }] },
    ];
  }
  if (shards === 1) {
    return [
      L('One CORE SHARD. The bosses carry them... almost as if someone handed the shards out on purpose.'),
      L('Did the boss say anything strange before it fell? They never used to talk.'),
    ];
  }
  if (progress.clears >= 2) {
    return [
      L('Two worlds stabilized! Notice how the genres keep bleeding together? That is the Crash, spreading.'),
      L('The BOSS cabinets are open now: BOSS BEATDOWN and GLITCH RHYTHM. Each boss guards a CORE SHARD.'),
    ];
  }
  if (progress.clears >= 1) {
    return [L('Well done! New cabinets have powered on. The racing world, NEON PANIC, feels... watched.'), L('Visit MADAME POLYGON to spend your BITS. And the MUTATION LAB lets you switch genre fusions on or off.')];
  }
  return [L('Start with the yellow cabinet: RETRO RAMPAGE. Z jumps, X attacks, C fires your blaster.'), L('If the rules suddenly change... that is the CHAOS DIRECTOR. Watch for the warning bar.')];
}

export const KEVIN_LINES = [
  'Hi. Kevin, QA. I am filing a bug: "the floor is too floor-like". Severity: cosmic.',
  'Did you know the shop polygon has 7 sides on Tuesdays? I have it in a spreadsheet.',
  'If you see me in a level, do not panic. I am just marking a rule as WONTFIX.',
  'My bug tracker has 12,000 tickets. All of them say "genre bleed". All of them are assigned to me.',
  'I tested the Cartridge Core once. Well. Twice. The second time, it tested me.',
  'Tip: chaos orbs trigger the Chaos Director early. The shrine lets you nudge what it picks. That is not a bug. Probably.',
];

export const REX_LINES = (racedWon: boolean): string[] =>
  racedWon
    ? ['You beat me?! On lap 3 of 3?! ...Okay that was actually kind of rad.', 'Rematch whenever. I am not going anywhere. Literally. I am stuck here.']
    : ['Rex Turbo. Undefeated since 1996. Technically the race never ended.', 'Neon Panic is MY track. Something chases you after midnight. I am not scared. You are scared.'];

export const POLYGON_INTRO = 'Madame Polygon sees all angles. Spend your BITS, little sprite.';

export const BOSS_DEFEAT: Record<string, Line[]> = {
  bricklord: [
    { who: 'brick', name: 'BRICKLORD MAX', text: 'You... cleared me. Do you know how long I have been waiting for someone to finish the last row?' },
    { who: 'brick', name: 'BRICKLORD MAX', text: 'I was the final level. Always the final level. I only wanted to see what came after.' },
    { who: 'brick', name: 'BRICKLORD MAX', text: 'Take the shard. And decide: will you SET ME FREE as an ally, or DELETE me for the bits?', choices: [{ label: 'SET FREE', effect: 'mercy' }, { label: 'DELETE (+150 BITS)', effect: 'purge' }] },
  ],
  static: [
    { who: 'static', name: 'DJ STATIC', text: 'Okay okay okay. You kept the beat. Respect. Nobody ever lets the announcer play.' },
    { who: 'static', name: 'DJ STATIC', text: 'Someone promised us the Crash would let us pick our own songs. Someone with a LOT of points.' },
    { who: 'static', name: 'DJ STATIC', text: 'Shard is yours. So what is it: SET ME FREE, or DELETE the static?', choices: [{ label: 'SET FREE', effect: 'mercy' }, { label: 'DELETE (+150 BITS)', effect: 'purge' }] },
  ],
};

export const HIGHSCORE_INTRO: Line[] = [
  { who: 'highscore', name: 'THE HIGH SCORE', text: 'I AM EVERY INITIAL EVER TYPED. I AM THE NUMBER AT THE TOP. NOBODY GETS TO BE ABOVE ME.' },
  { who: 'highscore', name: 'THE HIGH SCORE', text: 'I MADE THE CRASH SO THE BOARD COULD NEVER BE BEATEN. GAMES END. A RECORD IS FOREVER.' },
  { who: 'manual', name: 'THE MANUAL', text: 'The last page is behind its panel! Keep out of the bullets and keep firing. Graze bullets to charge your bombs.' },
  { who: 'cass', name: 'CASS', text: 'Records are made to be broken.' },
];

export const HIGHSCORE_DEFEAT: Line[] = [
  { who: 'highscore', name: 'THE HIGH SCORE', text: 'Zero. I am... zero. It is so quiet down here.' },
  { who: 'highscore', name: 'THE HIGH SCORE', text: 'I only wanted someone to remember that I was best once. Nobody keeps playing after the top.' },
  { who: 'manual', name: 'THE MANUAL', text: 'The last page is back! The Core is whole. But a board with no champion is only a list of names.' },
  { who: 'cass', name: 'CASS', text: 'What do we do with the crown?', choices: [{ label: 'SET THE BOARD FREE', effect: 'mercy' }, { label: 'TAKE THE CROWN (+300 BITS)', effect: 'purge' }] },
];

export const ENDING: Line[] = [
  { who: 'core', name: 'CARTRIDGE CORE', text: 'SHARDS ACCEPTED. REBOOTING... GENRE BOUNDARIES: 41% RESTORED.' },
  { who: 'manual', name: 'THE MANUAL', text: 'It is working! The worlds are settling. Not perfectly. I hope not perfectly.' },
  { who: 'kevin', name: 'KEVIN FROM QA', text: 'I am closing ticket #1: "Everything is broken". Status: PARTIALLY FIXED. That counts.' },
  { who: 'manual', name: 'THE MANUAL', text: 'But listen. The last missing page. It is with THE HIGH SCORE, at the top of every leaderboard. It wanted the Crash. It wanted no one to ever beat it.' },
  { who: 'cass', name: 'CASS', text: 'Then I guess I am going for a new record.' },
];

/** The legs of the classic BOSS RUSH; the GAUNTLET adds the keeper in overtime and THE HIGH SCORE. */
export const RUSH_LEGS: ModeId[] = ['beatdown', 'rhythm'];
export const GAUNTLET_LEGS: ModeId[] = ['beatdown', 'rhythm', 'penalty', 'highscore'];

export const MODE_INFO: Record<ModeId, { title: string; genre: string; blurb: string; color: string; /** Cabinet label when the title is too long. */ short?: string }> = {
  rampage: { title: 'RETRO RAMPAGE', genre: 'PLATFORMER → SHMUP', blurb: 'Run, jump, slash. Midway the level turns into a shoot-em-up.', color: '#ffcf3f' },
  neon: { title: 'NEON PANIC', genre: 'RACING → HORROR', blurb: 'Beat REX TURBO to the line. At midnight, something gives chase.', color: '#3fe0ff' },
  mall: { title: 'NIGHTMARE MALL', genre: 'SURVIVAL HORROR + PET', blurb: 'Find 3 keycards and escape. Hide in lockers. BYTE can bark.', color: '#b3122e', short: 'MALL' },
  beatdown: { title: 'BOSS BEATDOWN', genre: 'FIGHTER → BULLET HELL', blurb: 'Fight BRICKLORD MAX. Fill block rows. Survive his genre tantrum.', color: '#ff6f3f' },
  rhythm: { title: 'GLITCH RHYTHM', genre: 'RHYTHM + SHOOTER', blurb: 'Hit notes on the beat to shoot DJ STATIC. Dodge the glitches.', color: '#ff3fd2' },
  penalty: { title: 'PENALTY STORM', genre: 'SPORTS + BULLET HELL', blurb: 'Dribble, dodge the keeper\'s bullet patterns and score six goals.', color: '#ff9f3f' },
  blocks: { title: 'BLOCK PARTY', genre: 'PUZZLE + PARTY', blurb: 'Seven falling shapes, a fair bag and a ghost to aim by. Clear the line goal. Topping out costs a heart.', color: '#b07aff', short: 'BLOCKS' },
  bolt: { title: 'BOLT BRIGADE', genre: 'RUN-AND-GUN + BOSSES', blurb: 'Pick a robot master, run its stage, beat it and take its weapon. Charge your buster, exploit the weakness.', color: '#3f9fff', short: 'BOLT' },
  highscore: { title: 'THE HIGH SCORE', genre: 'EVERY GENRE', blurb: 'The final boss: three phases, bullet hell, a fighter and a remix. Graze bullets to charge bombs.', color: '#ffcf3f' },
  command: { title: 'CORE COMMAND', genre: 'STRATEGY → BULLET HELL', blurb: 'Build towers along the glitch road. Eight waves. Defend the Cartridge Core.', color: '#7dff6b' },
};

/** What a player still has to do to open a cabinet (one wording, used everywhere). */
export function lockHint(mode: ModeId): string {
  if (mode === 'neon' || mode === 'mall') return 'Clear RETRO RAMPAGE first.';
  if (mode === 'command') return 'Clear any three worlds first.';
  if (mode === 'penalty') return 'Clear any four worlds first.';
  if (mode === 'blocks') return 'Clear any two worlds first.';
  if (mode === 'bolt') return 'Clear any three worlds first.';
  return 'Clear any two worlds first.';
}

/** Which cabinets are open. Curiosity-gated, never grind-gated. */
export function isModeUnlocked(mode: ModeId, cleared: Record<ModeId, { clears: number }>): boolean {
  const c = (m: ModeId) => cleared[m].clears > 0;
  const total = MODE_IDS.filter(c).length;
  switch (mode) {
    case 'rampage': return true;
    case 'neon': return c('rampage');
    case 'mall': return c('rampage');
    case 'beatdown': return total >= 2;
    case 'rhythm': return total >= 2;
    case 'command': return total >= 3;
    case 'penalty': return total >= 4;
    case 'blocks': return total >= 2;
    case 'bolt': return total >= 3;
    case 'highscore': return true; // the Core only offers it once the Cartridge Core is restored
  }
}
