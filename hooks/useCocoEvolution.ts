import { useCallback } from 'react';
import { useCocoStore } from '../store/cocoStore';
import { TIERS } from '../constants/tiers';

export function useCocoEvolution() {
  const { tier, addXP, incrementStreak, updateFromScore } = useCocoStore();
  const processSession = useCallback((recoveryScore: number) => {
    const xpGain = TIERS[tier - 1]?.xpPerSession ?? 10;
    updateFromScore(recoveryScore);
    incrementStreak();
    const { tieredUp, newTier } = addXP(xpGain);
    return { tieredUp, newTier, tierName: TIERS[newTier - 1]?.name ?? 'Legendary Coco' };
  }, [tier, addXP, incrementStreak, updateFromScore]);
  return { processSession };
}
