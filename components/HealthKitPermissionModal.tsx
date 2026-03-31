/**
 * HealthKitPermissionModal
 *
 * Shown once to explain the benefits of granting HealthKit access,
 * especially for Apple Watch users who can get real HRV + sleep stages.
 */

import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Colors } from '../constants/colors';
import { DiagonalStripes } from './DiagonalStripes';
import { requestAndCheckHealthKit } from '../utils/healthKit';
import { useUserProfileStore } from '../store/userProfileStore';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function HealthKitPermissionModal({ visible, onDismiss }: Props) {
  const [requesting, setRequesting] = useState(false);
  const setProfile = useUserProfileStore((s) => s.setProfile);

  async function handleAllow() {
    setRequesting(true);
    try {
      await requestAndCheckHealthKit();
    } catch {
      // Graceful — permission denied is fine
    }
    setProfile({ healthKitPermissionAsked: true });
    setRequesting(false);
    onDismiss();
  }

  function handleSkip() {
    setProfile({ healthKitPermissionAsked: true });
    onDismiss();
  }

  if (Platform.OS !== 'ios') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <DiagonalStripes color={Colors.info} opacity={0.04} />

          <View style={styles.inner}>
            <Text style={styles.eyebrow}>// HEALTH DATA</Text>
            <Text style={styles.title}>ENHANCE YOUR RECOVERY</Text>
            <View style={styles.bar} />

            <Text style={styles.body}>
              Coco can use Apple Health to improve your recovery analysis — no data ever leaves your device.
            </Text>

            <View style={styles.benefitList}>
              {[
                { icon: '❤️', label: 'Real HRV from Apple Watch', sub: 'Clinical-grade nervous system recovery' },
                { icon: '😴', label: 'Accurate sleep stages', sub: 'Deep, REM, and light sleep from Watch' },
                { icon: '🏃', label: 'Workout data import', sub: 'Auto-detect training load from workouts' },
                { icon: '💓', label: 'Resting heart rate trends', sub: 'Spot overtraining before it hits' },
              ].map((b) => (
                <View key={b.label} style={styles.benefit}>
                  <Text style={styles.benefitIcon}>{b.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.benefitLabel}>{b.label}</Text>
                    <Text style={styles.benefitSub}>{b.sub}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.watchNote}>
              <Text style={styles.watchNoteText}>
                APPLE WATCH DETECTED — Real HRV replaces sensor estimates for significantly more accurate scores.
              </Text>
            </View>

            <TouchableOpacity onPress={handleAllow} disabled={requesting} style={styles.allowBtn}>
              <View style={styles.allowBtnInner}>
                <Text style={styles.allowBtnText}>
                  {requesting ? 'REQUESTING...' : 'ALLOW HEALTH ACCESS →'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
              <Text style={styles.skipText}>MAYBE LATER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0e0e0e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: Colors.info + '44',
  },
  inner: { padding: 28, paddingBottom: 48 },

  eyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: Colors.info, marginBottom: 4,
  },
  title: {
    fontSize: 28, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textPrimary, lineHeight: 30,
  },
  bar: { height: 3, width: 40, backgroundColor: Colors.info, marginTop: 8, marginBottom: 16 },
  body: {
    fontSize: 13, color: Colors.textSecondary, lineHeight: 20, marginBottom: 20,
  },

  benefitList: { gap: 14, marginBottom: 20 },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitIcon: { fontSize: 20, lineHeight: 24, marginTop: 1 },
  benefitLabel: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  benefitSub: { fontSize: 11, color: Colors.textSecondary },

  watchNote: {
    backgroundColor: Colors.info + '18',
    borderLeftWidth: 3,
    borderLeftColor: Colors.info,
    padding: 12,
    marginBottom: 20,
  },
  watchNoteText: {
    fontSize: 10, fontWeight: '800', fontStyle: 'italic',
    color: Colors.info, letterSpacing: 1, lineHeight: 15,
  },

  allowBtn: { marginBottom: 12 },
  allowBtnInner: {
    backgroundColor: Colors.info,
    paddingVertical: 14,
    alignItems: 'center',
  },
  allowBtnText: {
    fontSize: 13, fontWeight: '900', fontStyle: 'italic',
    color: '#000', letterSpacing: 1,
  },

  skipBtn: { alignItems: 'center', paddingVertical: 8 },
  skipText: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1,
  },
});
