import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../constants/colors';
import { DiagonalStripes } from '../components/DiagonalStripes';
import { getDiscountOfferings, purchasePackage, restorePurchases } from '../lib/purchases';
import { usePurchaseStore } from '../store/purchaseStore';

const OFFER_KEY    = 'discount_offer_shown_at';
const OFFER_HOURS  = 24;
const OFFER_MS     = OFFER_HOURS * 60 * 60 * 1000;

function pad(n: number) { return n.toString().padStart(2, '0'); }

function formatCountdown(ms: number) {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return { h: pad(h), m: pad(m), s: pad(s) };
}

export default function DiscountOfferScreen() {
  const router = useRouter();
  const { isPremium } = usePurchaseStore();
  const [packages, setPackages]   = useState<any[]>([]);
  const [selected, setSelected]   = useState<any | null>(null);
  const [loading, setLoading]     = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring]   = useState(false);
  const [remaining, setRemaining]   = useState(OFFER_MS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist the first time this screen was shown so the 24h clock is real
  useEffect(() => {
    async function init() {
      const stored = await AsyncStorage.getItem(OFFER_KEY);
      const shownAt = stored ? parseInt(stored, 10) : Date.now();
      if (!stored) await AsyncStorage.setItem(OFFER_KEY, shownAt.toString());
      const elapsed = Date.now() - shownAt;
      setRemaining(Math.max(0, OFFER_MS - elapsed));
    }
    void init();
  }, []);

  // Countdown tick
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  useEffect(() => {
    void loadPackages();
  }, []);

  async function loadPackages() {
    const pkgs = await getDiscountOfferings();
    setPackages(pkgs);
    const annual = pkgs.filter((p) => p.packageType === 'ANNUAL');
    setPackages(annual);
    if (annual.length > 0) setSelected(annual[0]);
    setLoading(false);
  }

  const handlePurchase = useCallback(async () => {
    if (!selected) return;
    setPurchasing(true);
    const ok = await purchasePackage(selected);
    setPurchasing(false);
    if (ok) {
      await AsyncStorage.removeItem(OFFER_KEY);
      router.replace('/(tabs)');
    } else {
      Alert.alert('Purchase failed', 'Please try again or restore purchases below.');
    }
  }, [selected, router]);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    const ok = await restorePurchases();
    setRestoring(false);
    if (ok) {
      await AsyncStorage.removeItem(OFFER_KEY);
      router.replace('/(tabs)');
    } else {
      Alert.alert('No purchases found', 'No active subscription found for this Apple ID.');
    }
  }, [router]);

  const handleDecline = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  if (isPremium) {
    router.replace('/(tabs)');
    return null;
  }

  const { h, m, s } = formatCountdown(remaining);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.hero}>
        <DiagonalStripes color="#fff" opacity={0.06} />
        <View style={styles.heroInner}>
          <Text style={styles.eyebrow}>// LIMITED OFFER</Text>
          <Text style={styles.heroTitle}>20%{'\n'}OFF</Text>
          <View style={styles.heroBar} />
          <Text style={styles.heroSub}>ONE-TIME OFFER — EXPIRES IN:</Text>
        </View>
      </View>

      {/* Countdown */}
      <View style={styles.countdown}>
        <View style={styles.countdownBlock}>
          <Text style={styles.countdownNum}>{h}</Text>
          <Text style={styles.countdownLabel}>HRS</Text>
        </View>
        <Text style={styles.countdownSep}>:</Text>
        <View style={styles.countdownBlock}>
          <Text style={styles.countdownNum}>{m}</Text>
          <Text style={styles.countdownLabel}>MIN</Text>
        </View>
        <Text style={styles.countdownSep}>:</Text>
        <View style={styles.countdownBlock}>
          <Text style={styles.countdownNum}>{s}</Text>
          <Text style={styles.countdownLabel}>SEC</Text>
        </View>
      </View>

      {/* Discount badge */}
      <View style={styles.discountBadge}>
        <Text style={styles.discountText}>⚡ 20% OFF — THIS SCREEN ONLY</Text>
      </View>

      {/* Packages */}
      <Text style={styles.sectionLabel}>CHOOSE YOUR PLAN</Text>
      {loading ? (
        <ActivityIndicator color={Colors.red} style={{ marginVertical: 24 }} />
      ) : packages.length === 0 ? (
        <View style={styles.noPackages}>
          <Text style={styles.noPackagesText}>No packages available right now.</Text>
        </View>
      ) : (
        packages.map((pkg) => {
          const isActive  = selected?.identifier === pkg.identifier;
          const isAnnual  = pkg.packageType === 'ANNUAL';
          const isMonthly = pkg.packageType === 'MONTHLY';
          const label     = isAnnual ? 'ANNUAL' : isMonthly ? 'MONTHLY' : pkg.packageType;

          // Show crossed-out "original" price (+25% since 20% off means *0.8, so original is /0.8)
          const discountedPrice: string = pkg.product.priceString;
          const originalPrice: string = isAnnual
            ? `$${(pkg.product.price / 0.8).toFixed(2)}/yr`
            : `$${(pkg.product.price / 0.8).toFixed(2)}/mo`;

          return (
            <TouchableOpacity key={pkg.identifier} onPress={() => setSelected(pkg)}>
              <View style={[styles.packageOuter, isActive && styles.packageOuterActive]}>
                <DiagonalStripes color={isActive ? Colors.red : Colors.textMuted} opacity={0.04} />
                {isAnnual && (
                  <View style={styles.bestValueBadge}>
                    <Text style={styles.bestValueText}>BEST VALUE</Text>
                  </View>
                )}
                <View style={styles.packageInner}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.packageTitle, isActive && { color: Colors.red }]}>{label}</Text>
                    <View style={styles.priceRow}>
                      <Text style={styles.originalPrice}>{originalPrice}</Text>
                      <Text style={styles.packagePrice}>{discountedPrice}</Text>
                      <View style={styles.offBadge}><Text style={styles.offText}>-20%</Text></View>
                    </View>
                    {isAnnual && (
                      <Text style={styles.packageSub}>
                        {`$${(pkg.product.price / 12).toFixed(2)}/mo billed annually`}
                      </Text>
                    )}
                  </View>
                  {isActive && (
                    <View style={styles.checkCircle}>
                      <Text style={styles.checkMark}>✓</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

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
              : <Text style={styles.ctaText}>CLAIM DISCOUNT →</Text>
            }
          </View>
        </View>
      </TouchableOpacity>

      {/* Footer */}
      <View style={styles.footerLinks}>
        <TouchableOpacity onPress={handleRestore} disabled={restoring}>
          <Text style={styles.footerLink}>{restoring ? 'RESTORING...' : 'RESTORE PURCHASES'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDecline}>
          <Text style={styles.footerLink}>NO THANKS</Text>
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
    paddingTop: 80, paddingBottom: 40,
  },
  heroInner: { paddingHorizontal: 28 },
  eyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 4, color: 'rgba(255,255,255,0.6)', marginBottom: 8,
  },
  heroTitle: {
    fontSize: 72, fontWeight: '900', fontStyle: 'italic',
    color: '#fff', lineHeight: 72,
  },
  heroBar: { height: 3, width: 60, backgroundColor: 'rgba(255,255,255,0.4)', marginVertical: 14 },
  heroSub: { fontSize: 11, fontWeight: '900', letterSpacing: 2, color: 'rgba(255,255,255,0.85)' },

  // Countdown
  countdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 24,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  countdownBlock: { alignItems: 'center', minWidth: 64 },
  countdownNum: {
    fontSize: 48, fontWeight: '900', fontStyle: 'italic',
    color: Colors.red, lineHeight: 52,
  },
  countdownLabel: {
    fontSize: 9, fontWeight: '900', letterSpacing: 2,
    color: Colors.textMuted, marginTop: 2,
  },
  countdownSep: {
    fontSize: 36, fontWeight: '900', color: Colors.textMuted,
    marginBottom: 16,
  },

  // Discount badge
  discountBadge: {
    marginHorizontal: 24, marginTop: 20, marginBottom: 4,
    backgroundColor: 'rgba(245,200,66,0.12)',
    borderWidth: 1, borderColor: Colors.gold,
    borderLeftWidth: 4, borderLeftColor: Colors.gold,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  discountText: {
    fontSize: 11, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1.5, color: Colors.gold, textAlign: 'center',
  },

  sectionLabel: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: Colors.textSecondary,
    marginBottom: 12, marginTop: 20, paddingHorizontal: 24,
  },

  // Packages
  packageOuter: {
    marginHorizontal: 24, marginBottom: 10,
    backgroundColor: Colors.bgCard,
    borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 5, borderLeftColor: Colors.textMuted,
    overflow: 'hidden',
  },
  packageOuterActive: { borderColor: Colors.red, borderLeftColor: Colors.red },
  bestValueBadge: {
    backgroundColor: Colors.gold, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 3,
  },
  bestValueText: {
    fontSize: 8, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1.5, color: Colors.bgDeep,
  },
  packageInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  packageTitle: {
    fontSize: 12, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1, color: Colors.textPrimary, marginBottom: 6,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  originalPrice: {
    fontSize: 14, fontWeight: '700', color: Colors.textMuted,
    textDecorationLine: 'line-through',
  },
  packagePrice: {
    fontSize: 22, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary,
  },
  offBadge: {
    backgroundColor: Colors.red, paddingHorizontal: 6, paddingVertical: 2,
  },
  offText: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 1,
  },
  packageSub: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  checkCircle: { width: 28, height: 28, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 14, color: '#fff', fontWeight: '900' },

  noPackages: {
    marginHorizontal: 24, padding: 18,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
  },
  noPackagesText: { fontSize: 12, color: Colors.textMuted },

  // CTA
  ctaOuter: { marginHorizontal: 24, marginTop: 8, transform: [{ skewX: '-1.5deg' }] },
  ctaInner: {
    backgroundColor: Colors.red, paddingVertical: 18,
    alignItems: 'center', transform: [{ skewX: '1.5deg' }],
  },
  ctaText: {
    fontSize: 14, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: '#fff',
  },

  footerLinks: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginHorizontal: 24, marginTop: 20,
  },
  footerLink: {
    fontSize: 10, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 1, color: Colors.textMuted,
  },
  legal: {
    fontSize: 10, color: Colors.textMuted, textAlign: 'center',
    marginHorizontal: 24, marginTop: 20, lineHeight: 16,
  },
});
