import { ImageSourcePropType } from 'react-native';

export type CocoLevel = 'bad' | 'normal' | 'leather' | 'gold' | 'diamond';

export interface CocoLevelInfo {
  level: CocoLevel;
  label: string;
  color: string;
  image: ImageSourcePropType | null;
}

export const COCO_LEVELS: Record<CocoLevel, CocoLevelInfo> = {
  bad:      { level: 'bad',      label: 'BAD',      color: '#FF2D2D', image: require('../assets/coco/bad.png') },
  normal:   { level: 'normal',   label: 'NORMAL',   color: '#C8A96E', image: require('../assets/coco/normal.png') },
  leather:  { level: 'leather',  label: 'LEATHER',  color: '#D4A84B', image: require('../assets/coco/leather.png') },
  gold:     { level: 'gold',     label: 'GOLD',     color: '#F5C842', image: require('../assets/coco/gold.png') },
  diamond:  { level: 'diamond',  label: 'DIAMOND',  color: '#5CE8F4', image: require('../assets/coco/diamond.png') },
};

/** Maps a recovery score (0–100) to a CocoLevel */
export function scoreToCocoLevel(score: number): CocoLevel {
  if (score < 30) return 'bad';
  if (score < 55) return 'normal';
  if (score < 73) return 'leather';
  if (score < 87) return 'gold';
  return 'diamond';
}

// ─── Growth Stage System (streak-based) ──────────────────────────────────────

export type GrowthStage = 'seed' | 'baby' | 'growing' | 'mature' | 'legendary';

export interface GrowthStageInfo {
  stage:       GrowthStage;
  name:        string;
  description: string;
  color:       string;
  image:       ImageSourcePropType;
  minStreak:   number;
  nextAt:      number | null; // null = max stage
}

// Each stage has 3 progression images (1=earliest, 3=most evolved)
export const GROWTH_STAGE_IMAGES: Record<GrowthStage, [any, any, any]> = {
  seed:      [require('../assets/coco/growth_seed_1.png'),      require('../assets/coco/growth_seed_2.png'),      require('../assets/coco/growth_seed_3.png')],
  baby:      [require('../assets/coco/growth_baby_1.png'),      require('../assets/coco/growth_baby_2.png'),      require('../assets/coco/growth_baby_3.png')],
  growing:   [require('../assets/coco/growth_growing_1.png'),   require('../assets/coco/growth_growing_2.png'),   require('../assets/coco/growth_growing_3.png')],
  mature:    [require('../assets/coco/growth_mature_1.png'),    require('../assets/coco/growth_mature_2.png'),    require('../assets/coco/growth_mature_3.png')],
  legendary: [require('../assets/coco/growth_legendary_1.png'), require('../assets/coco/growth_legendary_2.png'), require('../assets/coco/growth_legendary_3.png')],
};

export const GROWTH_STAGES: Record<GrowthStage, GrowthStageInfo> = {
  seed:      { stage: 'seed',      name: 'SEED',      description: 'tiny sprout, just starting',  color: '#A3E635', image: require('../assets/coco/growth_seed_3.png'),      minStreak: 0,  nextAt: 3  },
  baby:      { stage: 'baby',      name: 'BABY',      description: 'first leaves, getting there', color: '#86EFAC', image: require('../assets/coco/growth_baby_3.png'),      minStreak: 3,  nextAt: 6  },
  growing:   { stage: 'growing',   name: 'GROWING',   description: 'stronger every night',        color: '#4ADE80', image: require('../assets/coco/growth_growing_3.png'),   minStreak: 6,  nextAt: 11 },
  mature:    { stage: 'mature',    name: 'MATURE',    description: 'big & proud coconut tree',    color: '#F5C842', image: require('../assets/coco/growth_mature_3.png'),    minStreak: 11, nextAt: 21 },
  legendary: { stage: 'legendary', name: 'LEGENDARY', description: 'you are a sleep legend',      color: '#5CE8F4', image: require('../assets/coco/growth_legendary_3.png'), minStreak: 21, nextAt: null },
};

export function streakToGrowthStage(streak: number): GrowthStageInfo {
  if (streak >= 21) return GROWTH_STAGES.legendary;
  if (streak >= 11) return GROWTH_STAGES.mature;
  if (streak >= 6)  return GROWTH_STAGES.growing;
  if (streak >= 3)  return GROWTH_STAGES.baby;
  return GROWTH_STAGES.seed;
}

// ─── Coco personality messages ────────────────────────────────────────────────

const MILESTONE_MESSAGES: Array<{ streak: number; msg: string }> = [
  { streak: 21, msg: 'LEGENDARY — you are a sleep god' },
  { streak: 11, msg: 'MATURE COCO — you\'re built different' },
  { streak: 6,  msg: 'GROWING STRONG — things are heating up' },
  { streak: 3,  msg: 'BABY COCO — streak is alive' },
];

export function cocoTalk(lastScore: number | null, streak: number): string {
  // Streak milestone messages take priority
  const milestone = MILESTONE_MESSAGES.find((m) => streak === m.streak);
  if (milestone) return milestone.msg;

  if (lastScore === null) {
    const starters = [
      'track tonight to feed me',
      'put your phone on the mattress and sleep',
      'coco needs data to evolve',
    ];
    return starters[streak % starters.length];
  }

  if (lastScore >= 90) {
    const msgs = ['you cooked last night', 'absolute unit sleep session', 'sleep legend behavior fr'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  if (lastScore >= 80) {
    const msgs = ['solid night, coco is proud', 'that\'s how we do it', 'recovery locked in'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  if (lastScore >= 70) {
    const msgs = ['decent night, push harder tonight', 'almost there', 'not bad, not great'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  if (lastScore >= 55) {
    const msgs = ['mid sleep ngl', 'could\'ve been worse... could\'ve been better', 'average behavior'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  if (lastScore >= 40) {
    const msgs = ['rough night', 'your body is begging you', 'coco is disappointed but not surprised'];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  const msgs = ['bro what was that 💀', 'coco is not okay rn 💀', 'this is not it chief'];
  return msgs[Math.floor(Math.random() * msgs.length)];
}
