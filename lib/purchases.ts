/**
 * RevenueCat integration scaffold.
 *
 * HOW TO ACTIVATE:
 *   1. expo install react-native-purchases
 *   2. Set REVENUECAT_CONFIGURED = true
 *   3. Replace YOUR_REVENUECAT_API_KEY with the key from the RevenueCat dashboard
 *   4. Uncomment each TODO block
 *   5. Create the "coco_pro" entitlement in RevenueCat and attach your App Store products
 */

// import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { usePurchaseStore } from '../store/purchaseStore';

export const ENTITLEMENT_ID       = 'coco_pro';
export const OFFERING_ID          = 'default';
export const REVENUECAT_CONFIGURED = false; // flip to true once SDK is installed

// ─── Initialise ───────────────────────────────────────────────────────────────
// Call once in _layout.tsx after auth, passing the Supabase userId.

export function initRevenueCat(_userId?: string): void {
  if (!REVENUECAT_CONFIGURED) return;
  // TODO:
  // Purchases.configure({ apiKey: 'YOUR_REVENUECAT_API_KEY' });
  // if (_userId) void Purchases.logIn(_userId);
}

// ─── Sync entitlement → store ─────────────────────────────────────────────────
// Call on app foreground or after any purchase/restore to refresh status.

export async function syncPremiumStatus(): Promise<boolean> {
  if (!REVENUECAT_CONFIGURED) return false;
  try {
    // TODO:
    // const info = await Purchases.getCustomerInfo();
    // const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    // const isPremium   = entitlement != null;
    // const isTrialing  = entitlement?.periodType === 'TRIAL';
    // const trialEndsAt = entitlement?.expirationDate ?? null;
    // usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    // return isPremium;
    return false;
  } catch {
    return false;
  }
}

// ─── Offerings ────────────────────────────────────────────────────────────────

export async function getOfferings(): Promise<any[]> {
  if (!REVENUECAT_CONFIGURED) return [];
  try {
    // TODO:
    // const offerings = await Purchases.getOfferings();
    // return offerings.current?.availablePackages ?? [];
    return [];
  } catch {
    return [];
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

export async function purchasePackage(_pkg: any): Promise<boolean> {
  if (!REVENUECAT_CONFIGURED) return false;
  try {
    // TODO:
    // const { customerInfo } = await Purchases.purchasePackage(_pkg);
    // const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    // const isPremium   = entitlement != null;
    // const isTrialing  = entitlement?.periodType === 'TRIAL';
    // const trialEndsAt = entitlement?.expirationDate ?? null;
    // usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    // return isPremium;
    return false;
  } catch {
    return false;
  }
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export async function restorePurchases(): Promise<boolean> {
  if (!REVENUECAT_CONFIGURED) return false;
  try {
    // TODO:
    // const info        = await Purchases.restorePurchases();
    // const entitlement = info.entitlements.active[ENTITLEMENT_ID];
    // const isPremium   = entitlement != null;
    // const isTrialing  = entitlement?.periodType === 'TRIAL';
    // const trialEndsAt = entitlement?.expirationDate ?? null;
    // usePurchaseStore.getState().setPremium(isPremium, isTrialing, trialEndsAt);
    // return isPremium;
    return false;
  } catch {
    return false;
  }
}
