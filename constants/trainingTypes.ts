export type TrainingDay = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full_body' | 'cardio' | 'rest';

export interface TrainingType {
  id: TrainingDay;
  label: string;
  emoji: string;
  recoveryMultiplier: number;
  sleepNeed: number;
  description: string;
}

export const TRAINING_TYPES: TrainingType[] = [
  { id: 'push', label: 'Push', emoji: 'PSH', recoveryMultiplier: 0.90, sleepNeed: 0.5, description: 'Chest, shoulders, triceps' },
  { id: 'pull', label: 'Pull', emoji: 'PLL', recoveryMultiplier: 0.90, sleepNeed: 0.5, description: 'Back, biceps' },
  { id: 'legs', label: 'Legs', emoji: 'LGS', recoveryMultiplier: 0.85, sleepNeed: 1.0, description: 'Quads, hamstrings, glutes' },
  { id: 'upper', label: 'Upper', emoji: 'UPR', recoveryMultiplier: 0.88, sleepNeed: 0.75, description: 'Full upper body' },
  { id: 'lower', label: 'Lower', emoji: 'LWR', recoveryMultiplier: 0.85, sleepNeed: 1.0, description: 'Full lower body' },
  { id: 'full_body', label: 'Full Body', emoji: 'FUL', recoveryMultiplier: 0.82, sleepNeed: 1.25, description: 'Compound full-body' },
  { id: 'cardio', label: 'Cardio', emoji: 'CDO', recoveryMultiplier: 0.93, sleepNeed: 0.25, description: 'Cardio / conditioning' },
  { id: 'rest', label: 'Rest', emoji: 'RST', recoveryMultiplier: 1.05, sleepNeed: 0, description: 'Active recovery or full rest' },
];

export function getTrainingType(id: TrainingDay): TrainingType {
  return TRAINING_TYPES.find((t) => t.id === id) ?? TRAINING_TYPES[7];
}
