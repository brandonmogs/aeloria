import { World } from '../sim/World';
import { TileMap } from '../sim/TileMap';
import { NpcConfig } from '../sim/Npc';
import { D, DialogueContext, DialogueScript, linear } from '../sim/dialogue';
import { killsSince } from '../sim/quests';
import { TICKS_PER_SECOND } from '../engine/constants';

/**
 * The cast of Aeloria's starting area — monsters with wiki-accurate stats
 * and drops, and the townsfolk whose conversations start and finish the
 * quests. This is content: nothing here knows how the sim runs a fight or
 * how the chatbox draws a line of dialogue.
 */
export function populateNpcs(world: World, map: TileMap): void {
  const respawn = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);
  const spawn = (config: NpcConfig, tiles: ReadonlyArray<readonly [number, number]>): void => {
    for (const [x, y] of tiles) {
      if (!map.isBlocked(x, y)) world.spawnNpc({ x, y }, config);
    }
  };

  // A camp of goblins on the grass east of the road. OSRS level-2 goblins:
  // 5 hitpoints, every combat stat 1, the wiki's (negative) bonuses, and a bad
  // attitude toward newcomers. Sited so their wander-plus-aggro reach never
  // covers the spawn tile. Drops follow the wiki's table out of 128.
  spawn(
    {
      name: 'Goblin',
      kind: 'goblin',
      attack: 1,
      strength: 1,
      defense: 1,
      maxHitpoints: 5,
      attackSpeed: 4,
      attackType: 'crush',
      bonuses: { acrush: -21, str: -15, dstab: -15, dslash: -15, dcrush: -15 },
      respawnTicks: respawn(21),
      aggroRange: 2,
      wanderRadius: 3,
      examine: 'An ugly green creature.',
      drops: [
        { itemId: 'bones', chance: 1 },
        { itemId: 'coins', chance: 28 / 128, min: 5, max: 5 },
        { itemId: 'coins', chance: 8 / 128, min: 9, max: 20 },
        { itemId: 'hammer', chance: 15 / 128 },
        { itemId: 'water_rune', chance: 6 / 128, min: 6, max: 6 },
        { itemId: 'body_rune', chance: 5 / 128, min: 7, max: 7 },
        { itemId: 'earth_rune', chance: 3 / 128, min: 4, max: 4 },
        { itemId: 'goblin_mail', chance: 5 / 128 },
        { itemId: 'bronze_sq_shield', chance: 3 / 128 },
        { itemId: 'bronze_scimitar', chance: 2 / 128 },
        { itemId: 'bronze_med_helm', chance: 2 / 128 },
      ],
    },
    [
      [30, 21],
      [28, 19],
      [32, 22],
      [27, 17],
      [31, 18],
    ],
  );

  // Giant rats scurrying along the southern treeline. OSRS level-3 giant
  // rats: 5 hitpoints, 2/3/2, and a steady source of meat for the fire.
  spawn(
    {
      name: 'Giant rat',
      kind: 'rat',
      attack: 2,
      strength: 3,
      defense: 2,
      maxHitpoints: 5,
      attackSpeed: 4,
      attackType: 'crush',
      respawnTicks: respawn(18),
      aggroRange: 2,
      wanderRadius: 4,
      examine: 'Overgrown vermin.',
      drops: [
        { itemId: 'bones', chance: 1 },
        { itemId: 'raw_rat_meat', chance: 1 },
      ],
    },
    [
      [18, 12],
      [27, 10],
      [31, 13],
      [14, 9],
    ],
  );

  // Two guards flanking the bridge approach — OSRS level-21 guards: 22
  // hitpoints, 19/18/14. Passive, but they hit back hard, and their pockets
  // hold the first real gear upgrades.
  spawn(
    {
      name: 'Guard',
      kind: 'guard',
      attack: 19,
      strength: 18,
      defense: 14,
      maxHitpoints: 22,
      attackSpeed: 4,
      attackType: 'slash',
      bonuses: { aslash: 4, str: 5, dstab: 18, dslash: 25, dcrush: 19 },
      respawnTicks: respawn(30),
      aggroRange: 0,
      wanderRadius: 2,
      examine: 'He looks bored, but capable.',
      drops: [
        { itemId: 'bones', chance: 1 },
        { itemId: 'coins', chance: 0.7, min: 1, max: 30 },
        { itemId: 'iron_dagger', chance: 6 / 128 },
        { itemId: 'air_rune', chance: 2 / 128, min: 6, max: 6 },
        { itemId: 'earth_rune', chance: 2 / 128, min: 3, max: 3 },
        { itemId: 'fire_rune', chance: 2 / 128, min: 2, max: 2 },
        { itemId: 'iron_ore', chance: 1 / 128 },
        // Aeloria's own additions: the guards carry the castle armoury's spares.
        { itemId: 'iron_scimitar', chance: 0.05 },
        { itemId: 'steel_scimitar', chance: 0.02 },
        { itemId: 'iron_pickaxe', chance: 0.03 },
        { itemId: 'steel_axe', chance: 0.03 },
        { itemId: 'bread', chance: 0.1 },
        { itemId: 'holy_symbol', chance: 0.02 },
      ],
    },
    [
      [22, 31],
      [26, 31],
    ],
  );

  // --- Townsfolk --------------------------------------------------------------
  const townsfolk = (config: Omit<NpcConfig, 'attack' | 'strength' | 'defense' | 'maxHitpoints' | 'attackSpeed' | 'respawnTicks'>): NpcConfig => ({
    attack: 1,
    strength: 1,
    defense: 1,
    maxHitpoints: 10,
    attackSpeed: 4,
    respawnTicks: respawn(30),
    aggroRange: 0,
    wanderRadius: 1,
    attackable: false,
    ...config,
  });

  spawn(townsfolk({ name: 'Cook', kind: 'cook', examine: 'He looks harassed. And floury.', dialogue: cookDialogue }), [[27, 37]]);
  spawn(townsfolk({ name: 'Captain Harlan', kind: 'captain', examine: 'The captain of the castle guard.', dialogue: captainDialogue }), [[22, 37]]);
  spawn(townsfolk({ name: 'Shop keeper', kind: 'shopkeeper', examine: 'He sells a bit of everything.', dialogue: shopkeeperDialogue, shopId: 'general_store' }), [[20, 39]]);
  spawn(townsfolk({ name: 'Gareth', kind: 'woodsman', examine: 'A woodsman with arms like oak boughs.', dialogue: woodsmanDialogue }), [[17, 26]]);
  spawn(townsfolk({ name: 'Old Barnaby', kind: 'fisherman', examine: 'An old fisherman with a bad back.', dialogue: fishermanDialogue }), [[18, 30]]);
}

// --- Dialogue scripts ---------------------------------------------------------
// Each is a function of the player's state, so it branches on quest stage and
// what's in the backpack. Node keys are local to the script.

function cookDialogue(ctx: DialogueContext): DialogueScript {
  const stage = ctx.questStage('cooks_rats');
  if (stage <= 0) {
    return {
      start: 'hello',
      nodes: {
        hello: D.npc("Hello, adventurer. Mind your step — my kitchen is a mess.", 'ask'),
        ask: D.options([
          { text: 'Is something the matter?', next: 'matter0' },
          { text: 'Nothing, just passing through.', next: 'bye' },
        ]),
        bye: D.npc('Mind the rats.'),
        ...linear('matter', [
          ['npc', 'Rats! Giant rats! Every night they raid the pantry, and the guards are shouting for their stew.'],
          ['npc', "I can't cook with the meat half eaten. And I've no time to go hunting."],
          ['player', 'Could I help?'],
          ['npc', 'You could! Kill three of the beasts in the woods south of the castle, and bring me three pieces of cooked meat so the guards get their supper.'],
          ['npc', 'Do that, and you may use my range whenever you like.'],
        ], 'decide'),
        decide: D.options([
          { text: 'Consider it done.', next: 'accept' },
          { text: "Sorry, I'm no rat-catcher.", next: 'decline' },
        ]),
        accept: D.npc('Bless you. Three rats, three pieces of cooked meat. Off you go!', undefined, (c) => {
          c.setQuestStage('cooks_rats', 1);
          c.setQuestVar('cooks_rats.rats', c.killCount('rat'));
        }),
        decline: D.npc('Then mind you keep out from under my feet.'),
      },
    };
  }
  if (stage === 1) {
    const rats = killsSince(ctx, 'rat', 'cooks_rats.rats');
    const meat = ctx.countItem('cooked_meat');
    if (rats >= 3 && meat >= 3) {
      return {
        start: 'done0',
        nodes: linear('done', [
          ['npc', "You've dealt with the rats? And you brought the meat! Wonderful."],
          ['npc', 'The guards will eat tonight. Use my range whenever you wish — it burns less than a campfire.'],
        ], undefined, (c) => {
          c.takeItem('cooked_meat', 3);
          c.grantXp('cooking', 300);
          c.completeQuest('cooks_rats');
        }),
      };
    }
    if (rats < 3) {
      return {
        start: 'p',
        nodes: { p: D.npc(`How goes the hunt? ${rats} of the beasts so far. They skulk in the woods south of the castle.`) },
      };
    }
    return {
      start: 'p',
      nodes: { p: D.npc(`The rats are dealt with — now I need three pieces of cooked meat. You have ${meat}. Cook it over a fire; the raw meat is on the rats.`) },
    };
  }
  return {
    start: 'thanks',
    nodes: {
      thanks: D.npc('Thank you again, adventurer. The range is all yours.', 'ask'),
      ask: D.options([
        { text: 'Where can I cook?', next: 'where' },
        { text: 'Thanks!', next: 'end' },
      ]),
      where: D.npc('The range is right here in the kitchen. Use your raw food on it — it burns far less than a campfire.'),
      end: D.end(),
    },
  };
}

function captainDialogue(ctx: DialogueContext): DialogueScript {
  const stage = ctx.questStage('goblin_trouble');
  if (stage <= 0) {
    return {
      start: 'halt',
      nodes: {
        halt: D.npc('Halt! Oh — a civilian. Go about your business.', 'ask'),
        ask: D.options([
          { text: 'Anything I can do to help?', next: 'help0' },
          { text: "I'll be on my way.", next: 'end' },
        ]),
        end: D.end(),
        ...linear('help', [
          ['npc', 'Goblins. A camp of them east of the road, harassing travellers and pilfering the farms.'],
          ['npc', "My men are stretched thin. Thin the camp — five of them — and I'll see you're rewarded."],
        ], 'decide'),
        decide: D.options([
          { text: "I'll deal with the goblins.", next: 'accept' },
          { text: "Goblins are the guards' problem.", next: 'decline' },
        ]),
        accept: D.npc('Good. Five goblins, then report back to me. Mind — they bite.', undefined, (c) => {
          c.setQuestStage('goblin_trouble', 1);
          c.setQuestVar('goblin_trouble.goblins', c.killCount('goblin'));
        }),
        decline: D.npc('Then stay off the road after dark.'),
      },
    };
  }
  if (stage === 1) {
    const kills = killsSince(ctx, 'goblin', 'goblin_trouble.goblins');
    if (kills >= 5) {
      return {
        start: 'done0',
        nodes: linear('done', [
          ['npc', 'Five goblins? Good work, adventurer.'],
          ['npc', "Take this — the armoury's spare scimitar, and the thanks of the garrison."],
        ], undefined, (c) => {
          c.giveItem('iron_scimitar', 1);
          c.grantXp('attack', 250);
          c.grantXp('strength', 250);
          c.completeQuest('goblin_trouble');
        }),
      };
    }
    return {
      start: 'p',
      nodes: { p: D.npc(`Still ${5 - kills} to go. They're camped east of the road, past the trees.`) },
    };
  }
  return { start: 'p', nodes: { p: D.npc('The road is quieter thanks to you. Carry on.') } };
}

function woodsmanDialogue(ctx: DialogueContext): DialogueScript {
  const stage = ctx.questStage('woodsmans_wager');
  if (stage <= 0) {
    return {
      start: 'ho',
      nodes: {
        ho: D.npc('Ho there! You look like you could swing an axe. Or could you?', 'ask'),
        ask: D.options([
          { text: 'I could out-chop you any day.', next: 'wager0' },
          { text: "I'm not much of a woodsman.", next: 'meh' },
        ]),
        meh: D.npc("Then you'll be wanting the road, not the wood."),
        ...linear('wager', [
          ['npc', 'Ha! A wager, then. Bring me ten logs and light a fire right here beside me.'],
          ['npc', "Manage it and I'll hand over my spare steel axe. Fail, and you owe me a drink."],
        ], 'decide'),
        decide: D.options([
          { text: "You're on.", next: 'accept' },
          { text: 'Maybe another time.', next: 'decline' },
        ]),
        accept: D.npc('Ten logs and a fire. Go on then — the trees are right behind me.', undefined, (c) => {
          c.setQuestStage('woodsmans_wager', 1);
        }),
        decline: D.npc("Suit yourself. The offer stands."),
      },
    };
  }
  if (stage === 1) {
    const logs = ctx.countItem('logs');
    const fire = ctx.questVar('woodsmans_wager.fire') > 0;
    if (logs >= 10 && fire) {
      return {
        start: 'done0',
        nodes: linear('done', [
          ['npc', 'Ten logs and a fire at my feet! You win the wager, fair and square.'],
          ['npc', 'Here — the steel axe is yours. Treat her well.'],
        ], undefined, (c) => {
          c.takeItem('logs', 10);
          c.giveItem('steel_axe', 1);
          c.grantXp('woodcutting', 250);
          c.grantXp('firemaking', 250);
          c.completeQuest('woodsmans_wager');
        }),
      };
    }
    if (logs < 10) {
      return { start: 'p', nodes: { p: D.npc(`Ten logs, remember. You've got ${logs}.`) } };
    }
    return {
      start: 'p',
      nodes: { p: D.npc("Logs, I see — now light a fire next to me, and I'll believe you know one end of a tinderbox from the other.") },
    };
  }
  return { start: 'p', nodes: { p: D.npc('Still swinging that axe, I hope!') } };
}

function fishermanDialogue(ctx: DialogueContext): DialogueScript {
  const stage = ctx.questStage('fishermans_favour');
  if (stage <= 0) {
    const skilled = ctx.skillLevel('fishing') >= 15;
    return {
      start: 'ow',
      nodes: {
        ow: D.npc("Ohh, my back... I can't haul a net like I used to.", 'ask'),
        ask: D.options([
          { text: 'Can I help?', next: 'help0' },
          { text: 'Sounds painful. Good luck.', next: 'bye' },
        ]),
        bye: D.npc('Aye. Luck.'),
        ...linear('help', [
          ['npc', 'You fish? The guards want their supper: five shrimps and three anchovies from the moat.'],
          ['npc', skilled ? "Bring them raw and I'll make it worth your while." : "Anchovies take a practised hand — level 15 at least. But bring them raw and I'll make it worth your while."],
        ], 'decide'),
        decide: D.options([
          { text: "I'll fetch your fish.", next: 'accept' },
          { text: 'Not today.', next: 'decline' },
        ]),
        accept: D.npc('Good lad. Five shrimps, three anchovies. The spots are right there on the moat.', undefined, (c) => {
          c.setQuestStage('fishermans_favour', 1);
        }),
        decline: D.npc('Then the guards go hungry. Ohh, my back...'),
      },
    };
  }
  if (stage === 1) {
    const shrimps = ctx.countItem('raw_shrimps');
    const anchovies = ctx.countItem('raw_anchovies');
    if (shrimps >= 5 && anchovies >= 3) {
      return {
        start: 'done0',
        nodes: linear('done', [
          ['npc', "Shrimps and anchovies, fresh from the moat! You've the makings of a fisherman."],
          ['npc', "Here's a little something for your trouble — and a trick or two about reading the water."],
        ], undefined, (c) => {
          c.takeItem('raw_shrimps', 5);
          c.takeItem('raw_anchovies', 3);
          c.giveItem('coins', 100);
          c.grantXp('fishing', 500);
          c.completeQuest('fishermans_favour');
        }),
      };
    }
    return {
      start: 'p',
      nodes: { p: D.npc(`The guards are waiting on five shrimps and three anchovies. You've ${shrimps} shrimps and ${anchovies} anchovies so far.`) },
    };
  }
  return { start: 'p', nodes: { p: D.npc('The guards ate well. My back thanks you.') } };
}

function shopkeeperDialogue(): DialogueScript {
  return {
    start: 'hi',
    nodes: {
      hi: D.npc('Can I help you?', 'ask'),
      ask: D.options([
        { text: 'Yes please. What are you selling?', next: 'shop' },
        { text: 'No, thanks.', next: 'end' },
      ]),
      shop: D.end((c) => c.openShop('general_store')),
      end: D.end(),
    },
  };
}
