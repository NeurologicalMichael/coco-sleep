/**
 * Promo code redemption.
 *
 * Required Supabase migration:
 *
 *   CREATE TABLE IF NOT EXISTS promo_codes (
 *     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     code        TEXT UNIQUE NOT NULL,
 *     redeemed    BOOLEAN NOT NULL DEFAULT FALSE,
 *     redeemed_by UUID REFERENCES auth.users(id),
 *     redeemed_at TIMESTAMPTZ
 *   );
 *
 *   INSERT INTO promo_codes (code) VALUES
 *     ('COCO-MNVX-7R2K'), ('COCO-PQ3J-8WYT'), ('COCO-BZ9L-4HCS'),
 *     ('COCO-DK5M-NFXW'), ('COCO-RH6T-2QPJ'), ('COCO-VW8G-YCBE'),
 *     ('COCO-ZN4A-6LMF'), ('COCO-TF2U-9XSK'), ('COCO-JE7B-3GRV'),
 *     ('COCO-QL1P-5DCH');
 *
 *   ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "read_promo_codes"   ON promo_codes FOR SELECT USING (true);
 *   CREATE POLICY "redeem_promo_code"  ON promo_codes FOR UPDATE
 *     USING (NOT redeemed) WITH CHECK (redeemed_by = auth.uid());
 */

import { supabase } from '../constants/supabase';
import { usePurchaseStore } from '../store/purchaseStore';

export type RedeemResult = 'ok' | 'invalid' | 'used' | 'error';

export async function redeemPromoCode(code: string, userId: string): Promise<RedeemResult> {
  const normalized = code.toUpperCase().trim();

  const { data, error } = await supabase
    .from('promo_codes')
    .select('id, redeemed')
    .eq('code', normalized)
    .maybeSingle();

  if (error) return 'error';
  if (!data) return 'invalid';
  if (data.redeemed) return 'used';

  const { error: updateError } = await supabase
    .from('promo_codes')
    .update({ redeemed: true, redeemed_by: userId, redeemed_at: new Date().toISOString() })
    .eq('id', data.id);

  if (updateError) return 'error';

  usePurchaseStore.getState().setPremium(true);
  return 'ok';
}
