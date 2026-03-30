import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useSleepStore } from '../store/sleepStore';

export default function ToggleSleep() {
  const router = useRouter();

  useEffect(() => {
    useSleepStore.getState().setPendingWidgetToggle(true);
    router.replace('/(tabs)/sleep');
  }, []);

  return null;
}
