/**
 * ProGate — renders children when the user is on Coco Pro.
 * Shows a branded upgrade card otherwise.
 *
 * Usage (full-width section replacement):
 *   <ProGate feature="Sleep Stage Charts" description="Visualise your sleep stages per night.">
 *     <SleepCharts ... />
 *   </ProGate>
 *
 * Usage (compact inline row):
 *   <ProGate feature="App Blocking" compact>
 *     <ScreenTimeSection />
 *   </ProGate>
 */

import { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { DiagonalStripes } from './DiagonalStripes';
import { usePurchaseStore } from '../store/purchaseStore';

interface ProGateProps {
  children:    ReactNode;
  feature:     string;        // short feature name, e.g. "Sleep Stage Charts"
  description?: string;       // one-line description shown in the card
  compact?:    boolean;       // compact row variant (no full card, just a lock row)
  style?:      ViewStyle;
}

export function ProGate({ children, feature, description, compact = false, style }: ProGateProps) {
  const router = useRouter();
  const { isPremium } = usePurchaseStore();

  if (isPremium) return <>{children}</>;

  if (compact) {
    return (
      <TouchableOpacity onPress={() => router.push('/paywall')} activeOpacity={0.8} style={style}>
        <View style={s.compact}>
          <DiagonalStripes color={Colors.gold} opacity={0.05} />
          <View style={s.compactInner}>
            <View style={s.badge}>
              <Text style={s.badgeText}>PRO</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.compactFeature}>{feature.toUpperCase()}</Text>
              {description ? <Text style={s.compactDesc}>{description}</Text> : null}
            </View>
            <Text style={s.compactArrow}>→</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.outer, style]}>
      <DiagonalStripes color={Colors.gold} opacity={0.05} />
      <View style={s.inner}>
        <View style={s.headerRow}>
          <View style={s.badge}>
            <Text style={s.badgeText}>PRO</Text>
          </View>
          <Text style={s.featureTitle}>{feature.toUpperCase()}</Text>
        </View>
        {description ? <Text style={s.desc}>{description}</Text> : null}
        <TouchableOpacity onPress={() => router.push('/paywall')} activeOpacity={0.8}>
          <View style={s.btn}>
            <Text style={s.btnText}>UNLOCK WITH COCO PRO →</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // ── Full card ────────────────────────────────────────────────────────────────
  outer: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderLeftWidth: 4,
    borderLeftColor: Colors.gold,
    overflow: 'hidden',
    marginBottom: 12,
  },
  inner: { padding: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  badge: { backgroundColor: Colors.gold, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 8, fontWeight: '900', color: Colors.bgDeep, letterSpacing: 1 },
  featureTitle: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textPrimary, letterSpacing: 0.5, flex: 1,
  },
  desc: { fontSize: 12, color: Colors.textMuted, lineHeight: 18, marginBottom: 14 },
  btn: {
    borderWidth: 1.5,
    borderColor: Colors.gold,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1.5, color: Colors.gold,
  },

  // ── Compact row ───────────────────────────────────────────────────────────────
  compact: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    overflow: 'hidden',
    marginBottom: 12,
  },
  compactInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  compactFeature: {
    fontSize: 12, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textPrimary, letterSpacing: 0.5,
  },
  compactDesc: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  compactArrow: { fontSize: 14, color: Colors.gold, fontWeight: '900' },
});
