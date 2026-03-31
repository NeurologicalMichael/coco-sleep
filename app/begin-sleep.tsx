import { Redirect } from 'expo-router';
import { useSleepStore } from '../store/sleepStore';

// Widget deep link: coco-sleep://begin-sleep
// expo-router routes here; set the flag and immediately redirect — no black flash.
useSleepStore.getState().setPendingWidgetToggle(true);

export default function BeginSleepRedirect() {
  return <Redirect href="/(tabs)/sleep" />;
}
