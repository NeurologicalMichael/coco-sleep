export type TierName = 'Seedling' | 'Sprout' | 'Palm' | 'Coconut' | 'Golden Coconut' | 'Legendary Coco';

export interface Tier {
  level: number;
  name: TierName;
  streakRequired: number;
  avgScoreRequired: number;
  xpPerSession: number;
  color: string;
  description: string;
}

export const TIERS: Tier[] = [
  { level: 1, name: 'Seedling', streakRequired: 0, avgScoreRequired: 0, xpPerSession: 10, color: '#6EE7B7', description: 'Just starting out' },
  { level: 2, name: 'Sprout', streakRequired: 7, avgScoreRequired: 60, xpPerSession: 15, color: '#34D399', description: '7-day streak, avg 60+' },
  { level: 3, name: 'Palm', streakRequired: 14, avgScoreRequired: 70, xpPerSession: 20, color: '#10B981', description: '14-day streak, avg 70+' },
  { level: 4, name: 'Coconut', streakRequired: 30, avgScoreRequired: 75, xpPerSession: 25, color: '#F5C842', description: '30-day streak, avg 75+' },
  { level: 5, name: 'Golden Coconut', streakRequired: 60, avgScoreRequired: 80, xpPerSession: 35, color: '#F59E0B', description: '60-day streak, avg 80+' },
  { level: 6, name: 'Legendary Coco', streakRequired: 90, avgScoreRequired: 85, xpPerSession: 50, color: '#A855F7', description: '90-day streak, avg 85+' },
];

export function getTierForLevel(level: number): Tier {
  return TIERS[Math.min(level - 1, TIERS.length - 1)];
}
