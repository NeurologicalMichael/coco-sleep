/**
 * Coco AI — Sleep Coach Chat
 * Premium feature. Powered by Claude (Anthropic).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, ActivityIndicator,
  Keyboard, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { DiagonalStripes } from '../../components/DiagonalStripes';
import { usePurchaseStore } from '../../store/purchaseStore';
import { sendCocoMessage, ChatMessage } from '../../lib/cocoAI';

// ─── Question bank ────────────────────────────────────────────────────────────

const QUESTION_BANK = [
  "What's the best bedtime for my wake-up goal?",
  "How many hours of sleep do I actually need based on my trends?",
  "Why do I feel tired even after a full night's sleep?",
  "Which night this month was my best sleep and what made it good?",
  "How long is it taking me to fall asleep on average?",
  "Is my sleep getting better or worse over the past 30 days?",
  "What does my stage breakdown look like compared to last week?",
  "How much deep sleep am I averaging per night?",
  "Why was my sleep efficiency so low last night?",
  "What's causing so many disruptions in my sleep?",
];

function pickThree(): string[] {
  const shuffled = [...QUESTION_BANK].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[bs.row, isUser && bs.rowUser]}>
      {!isUser && (
        <View style={bs.avatar}>
          <Text style={bs.avatarText}>C</Text>
        </View>
      )}
      <View style={[bs.bubble, isUser ? bs.bubbleUser : bs.bubbleCoco]}>
        <Text style={[bs.text, isUser && bs.textUser]}>{msg.content}</Text>
      </View>
    </View>
  );
}

function SuggestedBubble({ text, onPress, disabled }: { text: string; onPress: () => void; disabled: boolean }) {
  return (
    <View style={bs.suggRow}>
      <TouchableOpacity
        style={bs.suggBubble}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
        hitSlop={{ top: 0, bottom: 0, left: 0, right: 0 }}
      >
        <Text style={bs.suggText}>{text}</Text>
      </TouchableOpacity>
    </View>
  );
}

const bs = StyleSheet.create({
  row:        { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-end', gap: 8, paddingHorizontal: 16 },
  rowUser:    { flexDirection: 'row-reverse' },
  avatar:     { width: 28, height: 28, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  bubble:     { maxWidth: '80%', padding: 12, borderWidth: 1 },
  bubbleCoco: { backgroundColor: '#111', borderColor: Colors.border, borderLeftWidth: 3, borderLeftColor: Colors.red },
  bubbleUser: { backgroundColor: Colors.red + '22', borderColor: Colors.red + '55' },
  text:       { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  textUser:   { color: Colors.textPrimary },

  // Suggested question bubbles (outlined, right-aligned)
  suggRow:    { flexDirection: 'row-reverse', paddingHorizontal: 16, marginBottom: 8 },
  suggBubble: {
    maxWidth: '80%', padding: 12,
    borderWidth: 1.5, borderColor: Colors.red + '66',
    borderLeftWidth: 1.5,
    backgroundColor: 'transparent',
  },
  suggText:   { fontSize: 12, color: Colors.red + 'cc', fontStyle: 'italic', lineHeight: 18 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CocoAIScreen() {
  const { isPremium } = usePurchaseStore();
  const router        = useRouter();
  const insets        = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [chips,    setChips]    = useState<string[]>(() => pickThree());
  const [error,    setError]    = useState<string | null>(null);
  const scrollRef    = useRef<ScrollView>(null);
  const animatedPad  = useRef(new Animated.Value(0)).current;

  // Smooth keyboard animation — matches the keyboard's own spring/duration
  useEffect(() => {
    // Tab bar height (49 base + safe area bottom inset)
    const tabBarH = Platform.OS === 'ios' ? 49 + insets.bottom : 0;

    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const pad = Math.max(0, e.endCoordinates.height - tabBarH);
        Animated.timing(animatedPad, {
          toValue:         pad,
          duration:        e.duration > 0 ? e.duration : 250,
          useNativeDriver: false,
        }).start();
      },
    );

    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        Animated.timing(animatedPad, {
          toValue:         0,
          duration:        e.duration > 0 ? e.duration : 250,
          useNativeDriver: false,
        }).start();
      },
    );

    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  useEffect(() => { if (messages.length) scrollToBottom(); }, [messages.length]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setError(null);
    setLoading(true);
    setChips(pickThree());

    try {
      const reply = await sendCocoMessage(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch {
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Paywall gate ────────────────────────────────────────────────────────────

  if (!isPremium) {
    return (
      <View style={gate.container}>
        <DiagonalStripes color={Colors.red} opacity={0.04} />
        <View style={gate.logoMark}>
          <Text style={gate.logoC}>C</Text>
        </View>
        <Text style={gate.title}>COCO AI</Text>
        <View style={gate.bar} />
        <Text style={gate.sub}>
          Your personal sleep coach.{'\n'}Powered by AI, trained on your data.
        </Text>
        <TouchableOpacity style={gate.btn} onPress={() => router.push('/paywall')} activeOpacity={0.8}>
          <Text style={gate.btnText}>UNLOCK WITH PRO →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEmpty = messages.length === 0;

  const suggestions = !loading && (
    <View style={s.suggSection}>
      {chips.map((q, i) => (
        <SuggestedBubble
          key={`${i}-${q.slice(0, 8)}`}
          text={q}
          onPress={() => send(q)}
          disabled={loading}
        />
      ))}
    </View>
  );

  return (
    <Animated.View style={[s.container, { paddingBottom: animatedPad }]}>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          // Empty state: header centered in top half, suggestions anchored at bottom
          <View style={s.emptyLayout}>
            <View style={s.emptyHeader}>
              <View style={s.logoMark}>
                <Text style={s.logoC}>C</Text>
              </View>
              <Text style={s.emptyTitle}>COCO AI</Text>
              <Text style={s.emptySub}>Your personal sleep coach.{'\n'}Ask me anything about your sleep.</Text>
            </View>
            {suggestions}
          </View>
        ) : (
          <>
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}

            {loading && (
              <View style={bs.row}>
                <View style={bs.avatar}>
                  <Text style={bs.avatarText}>C</Text>
                </View>
                <View style={[bs.bubble, bs.bubbleCoco, s.typingBubble]}>
                  <ActivityIndicator size="small" color={Colors.red} />
                </View>
              </View>
            )}

            {error && <Text style={s.errorText}>{error}</Text>}

            {suggestions}
          </>
        )}
      </ScrollView>

      {/* Input — directly above keyboard */}
      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your sleep..."
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={500}
          editable={!loading}
        />
        <TouchableOpacity
          style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnOff]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
          activeOpacity={0.8}
        >
          <Text style={s.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bgDeep },
  scroll:       { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 60, paddingBottom: 12 },

  // Empty state: fills full scroll area, header centered, suggestions at bottom
  emptyLayout: { flex: 1, justifyContent: 'space-between' },
  emptyHeader: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 24 },
  logoMark:   {
    width: 64, height: 64, backgroundColor: Colors.red,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  logoC:      { fontSize: 32, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  emptyTitle: { fontSize: 36, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 4, marginBottom: 8 },
  emptySub:   { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },

  typingBubble: { paddingVertical: 10, paddingHorizontal: 16 },
  errorText:    { fontSize: 11, color: Colors.red, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },

  suggSection: { paddingTop: 8, paddingBottom: 4 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.bgDeep,
  },
  input: {
    flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 13,
    paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100, lineHeight: 19,
  },
  sendBtn:    { width: 40, height: 40, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: Colors.border },
  sendIcon:   { fontSize: 18, fontWeight: '900', color: '#fff' },
});

const gate = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: Colors.bgDeep,
    alignItems: 'center', justifyContent: 'center',
    padding: 40, overflow: 'hidden',
  },
  logoMark: {
    width: 72, height: 72, backgroundColor: Colors.red,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  logoC:    { fontSize: 36, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  title:    { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: Colors.textPrimary, letterSpacing: 4 },
  bar:      { height: 3, width: 60, backgroundColor: Colors.red, marginVertical: 14 },
  sub:      { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn:      { backgroundColor: Colors.red, paddingHorizontal: 28, paddingVertical: 14 },
  btnText:  { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 1 },
});
