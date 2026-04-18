import { usePurchaseStore } from '../store/purchaseStore';
import Constants from 'expo-constants';

export type PurchasesPackage = any;

export const ENTITLEMENT_ID = 'Coco Sleep Pro';
export const OFFERING_ID    = 'default';

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

// RevenueCat v9 intentionally crashes the app in Expo Go when a test key is detected.
// Skip the SDK entirely when running inside Expo Go.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Lazy-load the native SDK so the app doesn't crash when the native module
// hasn't been built yet (e.g. running via Expo Go / Metro without expo run:ios).
let Purchases: any = null;
function getSDK(): any | null {
  if (IS_EXPO_GO) return null;
  if (Purchases) return Purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Purchases = require('react-native-purchases').default;
    return Purchases;
  } catch {
    return null;
  }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

export function initRevenueCat(userId?: string): void {
  const sdk = getSDK();
  if (!sdk || !API_KEY) return;
  try {
    sdk.configure({ apiKey: API_KEY });
    if (userId) {
      // logIn returns a Promise in some versions — always discard with a catch
      const loginResult = sdk.logIn(userId);
      if (loginResult && typeof loginResult.catch === 'function') {
        loginResult.catch(() => {});
      }
    }
  } catch { /* no-op */ }
}

// ─── Sync entitlement → store ─────────────────────────────────────────────────

export async function syncPremiumStatus(): Promise<boolean> {
  const sdk = getSDK();
  if (!sdk) return false;
  try {
    const info        = await sdk.getCustomerInfo();
    const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    const isPremium   = entitlement != null;
    const isTrialing  = entitlement?.periodType === 'TRIAL';
    const trialEndsAt = entitlement?.expirationDate ?? null;
    usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    return isPremium;
  } catch {
    return false;
  }
}

// ─── Offerings ────────────────────────────────────────────────────────────────

export async function getOfferings(): Promise<PurchasesPackage[]> {
  const sdk = getSDK();
  if (!sdk) return [];
  try {
    const offerings = await sdk.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export async function getDiscountOfferings(): Promise<PurchasesPackage[]> {
  const sdk = getSDK();
  if (!sdk) return [];
  try {
    const offerings = await sdk.getOfferings();
    const discount = offerings.all['discount_offer'];
    if (discount) return discount.availablePackages.filter((p: any) => p.packageType === 'ANNUAL');
    return offerings.current?.availablePackages.filter((p: any) => p.packageType === 'ANNUAL') ?? [];
  } catch {
    return [];
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  const sdk = getSDK();
  if (!sdk) return false;
  try {
    const { customerInfo } = await sdk.purchasePackage(pkg);
    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    const isPremium   = entitlement != null;
    const isTrialing  = entitlement?.periodType === 'TRIAL';
    const trialEndsAt = entitlement?.expirationDate ?? null;
    usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    return isPremium;
  } catch {
    return false;
  }
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export async function restorePurchases(): Promise<boolean> {
  const sdk = getSDK();
  if (!sdk) return false;
  try {
    const info        = await sdk.restorePurchases();
    const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    const isPremium   = entitlement != null;
    const isTrialing  = entitlement?.periodType === 'TRIAL';
    const trialEndsAt = entitlement?.expirationDate ?? null;
    usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    return isPremium;
  } catch {
    return false;
  }
}
