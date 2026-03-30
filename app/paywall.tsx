import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
type PurchasesPackage = any;
import { Colors } from '../constants/colors';
import { DiagonalStripes } from '../components/DiagonalStripes';
import { getOfferings, purchasePackage, restorePurchases, REVENUECAT_CONFIGURED } from '../lib/purchases';
import { usePurchaseStore } from '../store/purchaseStore';

const FREE_FEATURES = [
  'Sleep tracking (unlimited nights)',
  'Recovery score + 3 core insights',
  'Streak tracking & Coco evolution',
  'Friends & group leaderboards',
  'Sleep debt tracker',
  'Personal sleep plan',
  'Last 7 nights of history',
];

const PRO_FEATURES = [
  'HRV proxy analysis',
  'Cortisol level tracking',
  'Muscle recovery status',
  'Sleep stage charts per night',
  'Global leaderboard rankings',
  'App blocking at bedtime',
  'Full session history (90 nights)',
  'Wake-up alarm',
];

export default function PaywallScreen() {
  const router = useRouter();
  const { isPremium } = usePurchaseStore();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    void loadPackages();
  }, []);

  async function loadPackages() {
    const pkgs = await getOfferings();
    setPackages(pkgs);
    if (pkgs.length > 0) {
      setSelected(pkgs.find((p) => p.packageType === 'ANNUAL') ?? pkgs.find((p) => p.packageType === 'WEEKLY') ?? pkgs[0]);
    }
    setLoading(false);
  }

  async function handlePurchase() {
    if (!selected) return;
    setPurchasing(true);
    const ok = await purchasePackage(selected);
    setPurchasing(false);
    if (ok) {
      router.back();
    } else {
      Alert.alert('Purchase failed', 'Please try again or restore purchases below.');
    }
  }

  async function handleRestore() {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) {
      router.back();
    } else {
      Alert.alert('No purchases found', 'No active subscription found for this Apple ID.');
    }
  }

  // Only auto-dismiss if RevenueCat is live and the user is actually subscribed
  if (isPremium && REVENUECAT_CONFIGURED) {
    router.back();
    return null;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Hero */}
      <View style={styles.hero}>
        <DiagonalStripes color="#fff" opacity={0.06} />
        <View style={styles.heroInner}>
          <Text style={styles.heroEyebrow}>// UPGRADE</Text>
          <Text style={styles.heroTitle}>COCO{'\n'}PRO</Text>
          <View style={styles.heroBar} />
          <Text style={styles.heroSub}>1 WEEK FREE — THEN CANCEL ANYTIME</Text>
        </View>
      </View>

      {/* Feature comparison */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>WHAT YOU GET</Text>
        <View style={styles.featureCard}>
          <DiagonalStripes color={Colors.red} opacity={0.04} />
          <View style={styles.featureCardInner}>
            <Text style={styles.featureTier}>COCO PRO</Text>
            {PRO_FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <View style={styles.featureDot} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.freeCard}>
          <Text style={styles.freeTier}>FREE FOREVER</Text>
          {FREE_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <View style={[styles.featureDot, { backgroundColor: Colors.textMuted }]} />
              <Text style={[styles.featureText, { color: Colors.textMuted }]}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Package selector */}
      <Text style={styles.sectionLabel}>CHOOSE YOUR PLAN</Text>
      {loading ? (
        <ActivityIndicator color={Colors.red} style={{ marginVertical: 24 }} />
      ) : packages.length === 0 ? (
        <View style={styles.noPackages}>
          <Text style={styles.noPackagesText}>LAUNCHING SOON</Text>
          <Text style={styles.noPackagesSub}>
            Coco Pro is coming. All features are unlocked while we finish the store setup — enjoy it free for now.
          </Text>
        </View>
      ) : (
        packages.map((pkg) => {
          const isActive = selected?.identifier === pkg.identifier;
          const isAnnual = pkg.packageType === 'ANNUAL';
          const isWeekly = pkg.packageType === 'WEEKLY';
          const label = isAnnual ? 'ANNUAL' : isWeekly ? 'WEEKLY' : pkg.packageType;
          return (
            <TouchableOpacity key={pkg.identifier} onPress={() => setSelected(pkg)}>
              <View style={[styles.packageOuter, isActive && styles.packageOuterActive]}>
                <DiagonalStripes color={isActive ? Colors.red : Colors.textMuted} opacity={0.04} />
                <View style={styles.packageInner}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.packageTitle, isActive && { color: Colors.red }]}>
                      {label}
                      {isAnnual && <Text style={styles.bestValue}> — BEST VALUE</Text>}
                    </Text>
                    <Text style={styles.packagePrice}>{pkg.product.priceString}</Text>
                    {isAnnual && <Text style={styles.packageSub}>{`$${(pkg.product.price / 12).toFixed(2)}/mo billed annually`}</Text>}
                    {isWeekly && <Text style={styles.packageSub}>billed weekly after trial</Text>}
                  </View>
                  {isActive && <View style={styles.checkCircle}><Text style={styles.checkMark}>✓</Text></View>}
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* Trial callout */}
      <View style={styles.trialBadge}>
        <Text style={styles.trialText}>7-DAY FREE TRIAL — NO CHARGE TODAY</Text>
      </View>

      {/* CTA */}
      <TouchableOpacity
        disabled={purchasing || !selected}
        onPress={handlePurchase}
        style={{ opacity: (!selected || purchasing) ? 0.5 : 1 }}
      >
        <View style={styles.ctaOuter}>
          <View style={styles.ctaInner}>
            {purchasing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.ctaText}>START FREE TRIAL →</Text>
            }
          </View>
        </View>
      </TouchableOpacity>

      {/* Restore + close */}
      <View style={styles.footerLinks}>
        <TouchableOpacity onPress={handleRestore} disabled={restoring}>
          <Text style={styles.footerLink}>{restoring ? 'RESTORING...' : 'RESTORE PURCHASES'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.footerLink}>NOT NOW</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.legal}>
        Subscription auto-renews unless cancelled 24hrs before renewal. Manage in Apple ID settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { paddingBottom: 48 },

  hero: {
    backgroundColor: Colors.red, overflow: 'hidden',
    paddingTop: 80, paddingBottom: 48,
  },
  heroInner: { paddingHorizontal: 28 },
  heroEyebrow: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 4, color: 'rgba(255,255,255,0.6)', marginBottom: 8 },
  heroTitle: { fontSize: 64, fontWeight: '900', fontStyle: 'italic', color: '#fff', lineHeight: 64 },
  heroBar: { height: 3, width: 60, backgroundColor: 'rgba(255,255,255,0.4)', marginVertical: 14 },
  heroSub: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: 'rgba(255,255,255,0.85)' },

  section: { paddingHorizontal: 24, marginTop: 28, marginBottom: 8 },
  sectionLabel: { fontSize: 9, fontWeight: '900', fontStyle: 'italic', letterSpacing: 3, color: Colors.textSecondary, marginBottom: 12, paddingHorizontal: 24 },

  featureCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.red,
    borderLeftWidth: 5, borderLeftColor: Colors.red, overflow: 'hidden', marginBottom: 10,
  },
  featureCardInner: { padding: 18 },
  featureTier: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.red, marginBottom: 12 },
  freeCard: {
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3, borderLeftColor: Colors.textMuted, padding: 18,
  },
  freeTier: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.textMuted, marginBottom: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  featureDot: { width: 6, height: 6, backgroundColor: Colors.red },
  featureText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600', flex: 1 },

  packageOuter: {
    marginHorizontal: 24, marginBottom: 10, backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 5, borderLeftColor: Colors.textMuted,
    overflow: 'hidden',
  },
  packageOuterActive: { borderColor: Colors.red, borderLeftColor: Colors.red },
  packageInner: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  packageTitle: { fontSize: 12, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textPrimary, marginBottom: 4 },
  bestValue: { color: Colors.gold, fontSize: 10 },
  packagePrice: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary },
  packageSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  checkCircle: { width: 28, height: 28, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 14, color: '#fff', fontWeight: '900' },

  trialBadge: {
    marginHorizontal: 24, marginVertical: 16, backgroundColor: 'rgba(245,200,66,0.1)',
    borderWidth: 1, borderColor: Colors.gold, borderLeftWidth: 3, borderLeftColor: Colors.gold,
    padding: 12,
  },
  trialText: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1.5, color: Colors.gold, textAlign: 'center' },

  ctaOuter: { marginHorizontal: 24, transform: [{ skewX: '-1.5deg' }] },
  ctaInner: { backgroundColor: Colors.red, paddingVertical: 18, alignItems: 'center', transform: [{ skewX: '1.5deg' }] },
  ctaText: { fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff' },

  footerLinks: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 24, marginTop: 20 },
  footerLink: { fontSize: 10, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1, color: Colors.textMuted },

  legal: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginHorizontal: 24, marginTop: 20, lineHeight: 16 },

  noPackages: { marginHorizontal: 24, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.warning, padding: 18, marginBottom: 16 },
  noPackagesText: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', color: Colors.warning, marginBottom: 6 },
  noPackagesSub: { fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
});
