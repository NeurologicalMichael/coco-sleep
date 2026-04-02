import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { ErrorBoundary } from '../../components/ErrorBoundary';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, active: IoniconsName, inactive: IoniconsName) {
  return (
    <Ionicons
      name={focused ? active : inactive}
      size={24}
      color={focused ? Colors.red : Colors.textMuted}
    />
  );
}

export default function TabsLayout() {
  return (
    <ErrorBoundary>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bgDeep,
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarActiveTintColor: Colors.red,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sleep',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'moon', 'moon-outline'),
        }}
      />
      <Tabs.Screen
        name="sounds"
        options={{
          title: 'Coco AI',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'sparkles', 'sparkles-outline'),
        }}
      />
      <Tabs.Screen
        name="sleep"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Log',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'journal', 'journal-outline'),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'League',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'trophy', 'trophy-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'person', 'person-outline'),
        }}
      />
    </Tabs>
    </ErrorBoundary>
  );
}
