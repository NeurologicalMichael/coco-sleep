/**
 * Coco AI — Sleep Coach Chat
 * Clean rebuild: minimal structure, rotated-square tail inside bubble, stable typewriter.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const TRAINER_IMG = require('../../assets/coco/trainer_nobg.png');
const BUBBLE_COLOR = '#2a2a2a';
const TAIL_BOX = 14;   // rotated square side length
const PAD_H    = 14;   // bubble horizontal padding
const PAD_V    = 11;   // bubble vertical padding (normal)
const PAD_V_LG = 14;   // bubble vertical padding (first message, ≈1.25×)

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
  return [...QUESTION_BANK].sort(() => Math.random() - 0.5).slice(0, 3);
}

// ─── Bounce hook ──────────────────────────────────────────────────────────────

function useBounce(amp: number, active: boolean) {
  const val  = useRef(new Animated.Value(0)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: -6 * amp, duration: 162, useNativeDriver: true }),
          Animated.timing(val, { toValue:  3 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(val, { toValue: -4 * amp, duration: 150, useNativeDriver: true }),
          Animated.timing(val, { toValue:  2 * amp, duration: 125, useNativeDriver: true }),
          Animated.timing(val, { toValue: -2 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(val, { toValue:  0,       duration: 175, useNativeDriver: true }),
          Animated.delay(700),
        ])
      );
      loop.current.start();
    } else {
      loop.current?.stop();
      loop.current = null;
      val.setValue(0);
    }
    return () => { loop.current?.stop(); loop.current = null; };
  }, [active]);

  return val;
}

// ─── Coco message bubble ──────────────────────────────────────────────────────
// Structure: row → [avatar] [bubble]
// Bubble directly contains: tail (absolute rotated square) + text
// overflow:'visible' on bubble lets the tail diamond poke out to the left.
// Invisible full-text + absolute overlay locks bubble size during typewriter.

interface CocoBubbleProps {
  content: string;
  visibleContent?: string;  // undefined = fully shown; string = typewriter in progress
  bouncing: boolean;
  large?: boolean;          // first message gets larger padding
}

function CocoBubble({ content, visibleContent, bouncing, large }: CocoBubbleProps) {
  const bounceY = useBounce(1.53, bouncing);
  const pv = large ? PAD_V_LG : PAD_V;

  return (
    <View style={row.cocoRow}>
      <Animated.Image
        source={TRAINER_IMG}
        style={[row.avatar, { transform: [{ translateY: bounceY }] }]}
        resizeMode="contain"
      />

      {/* Bubble — overflow:visible so the rotated-square tail can protrude left */}
      <View style={[bub.bubble, { paddingVertical: pv }]}>

        {/* Tail: rotated square, same color as bubble, half inside / half outside */}
        <View style={bub.tail} />

        {visibleContent !== undefined ? (
          <>
            {/* Invisible full text — locks bubble to final height immediately */}
            <Text style={[bub.text, bub.ghost]}>{content}</Text>
            {/* Typed portion overlaid at exactly the same position */}
            <Text style={[bub.text, bub.overlay, { top: pv, bottom: pv }]}>
              {visibleContent}
            </Text>
          </>
        ) : (
          <Text style={bub.text}>{content}</Text>
        )}
      </View>
    </View>
  );
}

// ─── User message bubble ──────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <View style={row.userRow}>
      <View style={bub.userBubble}>
        <Text style={bub.userText}>{content}</Text>
      </View>
    </View>
  );
}

// ─── Thinking bubble (visible while API is generating) ────────────────────────

function ThinkingBubble({ bounceVal }: { bounceVal: Animated.Value }) {
  return (
    <View style={row.cocoRow}>
      <Animated.Image
        source={TRAINER_IMG}
        style={[row.avatar, { transform: [{ translateY: bounceVal }] }]}
        resizeMode="contain"
      />
      <View style={[bub.bubble, bub.thinkingBubble]}>
        <View style={bub.tail} />
        <ActivityIndicator size="small" color={Colors.red} />
      </View>
    </View>
  );
}

// ─── Suggestion chip ──────────────────────────────────────────────────────────

function SuggChip({ text, onPress, disabled }: { text: string; onPress(): void; disabled: boolean }) {
  return (
    <View style={chip.row}>
      <TouchableOpacity style={chip.btn} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
        <Text style={chip.label}>{text}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Row layouts
const row = StyleSheet.create({
  cocoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingRight: 56,
  },
  userRow: {
    flexDirection: 'row-reverse',
    marginBottom: 14,
    paddingLeft: 56,
    paddingRight: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    marginLeft: -18,
    marginRight: 4,
    flexShrink: 0,
  },
});

// Bubble styles
const bub = StyleSheet.create({
  // Coco bubble — natural width, overflow:visible for tail protrusion
  bubble: {
    backgroundColor: BUBBLE_COLOR,
    borderRadius: 20,
    paddingHorizontal: PAD_H,
    // paddingVertical set inline per instance
    maxWidth: '78%',
    alignSelf: 'flex-start',
    overflow: 'visible',
  },

  // Rotated square tail — inside bubble, same color, half protrudes left.
  // top:'50%' + translateY centers the tail on the bubble for any height,
  // always past the borderRadius:20 corner zone (requires bubble height > 40px,
  // guaranteed by minHeight on thinkingBubble and by text lineHeight on text bubbles).
  tail: {
    position: 'absolute',
    width: TAIL_BOX,
    height: TAIL_BOX,
    backgroundColor: BUBBLE_COLOR,
    borderRadius: 2,
    left: -(TAIL_BOX / 2) + 1,
    top: '50%',
    transform: [{ translateY: -(TAIL_BOX / 2) }, { rotate: '45deg' }],
  },

  thinkingBubble: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    minHeight: 46,        // ensures top:'50%' on tail = 23px > borderRadius:20 corner zone
    alignItems: 'center',
    justifyContent: 'center',
  },

  text: {
    fontSize: 15,
    color: '#e8e8e8',
    lineHeight: 22,
    fontWeight: '700',
  },

  // Makes the layout-locking text invisible (preserves space, hides color)
  ghost: {
    color: 'transparent',
  },

  // Absolutely positioned overlay — matches flow text position via left/right/top/bottom
  overlay: {
    position: 'absolute',
    left: PAD_H,
    right: PAD_H,
    // top and bottom set inline to match paddingVertical
    fontSize: 15,
    color: '#e8e8e8',
    lineHeight: 22,
    fontWeight: '700',
  },

  userBubble: {
    backgroundColor: Colors.red,
    borderRadius: 20,
    borderBottomRightRadius: 5,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    maxWidth: '78%',
    alignSelf: 'flex-start',
  },
  userText: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 22,
    fontWeight: '700',
  },
});

// Suggestion chips
const chip = StyleSheet.create({
  row: { flexDirection: 'row-reverse', paddingHorizontal: 16, marginBottom: 8 },
  btn: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: Colors.red + '66',
    borderRadius: 20,
  },
  label: { fontSize: 13, color: Colors.red + 'cc', fontStyle: 'italic', lineHeight: 19 },
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

  // Typewriter state
  const [typingIdx,  setTypingIdx]  = useState(-1);
  const [typedCount, setTypedCount] = useState(0);
  const typeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Greeting typewriter (empty state)
  const GREETING = "Hey! I'm Coco.\nAsk me anything about your sleep.";
  const [greetingCount, setGreetingCount] = useState(0);
  const greetingBounce = useBounce(1, true);

  // Thinking-bubble bounce owned here so it starts the instant loading = true
  const thinkBounceVal = useRef(new Animated.Value(0)).current;
  const thinkBounceLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Minimum time the thinking bubble is shown (ms)
  const loadStartRef = useRef(0);

  const scrollRef   = useRef<ScrollView>(null);
  const animPad     = useRef(new Animated.Value(0)).current;

  // ── Keyboard avoidance ──────────────────────────────────────────────────────
  useEffect(() => {
    const tabH = Platform.OS === 'ios' ? 49 + insets.bottom : 0;
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        Animated.spring(animPad, {
          toValue: Math.max(0, e.endCoordinates.height - tabH),
          speed: 40, bounciness: 0, useNativeDriver: false,
        }).start();
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => Animated.spring(animPad, { toValue: 0, speed: 40, bounciness: 0, useNativeDriver: false }).start(),
    );
    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);

  // ── Thinking-bubble bounce ──────────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      const amp = 1.53;
      thinkBounceLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(thinkBounceVal, { toValue: -6 * amp, duration: 162, useNativeDriver: true }),
          Animated.timing(thinkBounceVal, { toValue:  3 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(thinkBounceVal, { toValue: -4 * amp, duration: 150, useNativeDriver: true }),
          Animated.timing(thinkBounceVal, { toValue:  2 * amp, duration: 125, useNativeDriver: true }),
          Animated.timing(thinkBounceVal, { toValue: -2 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(thinkBounceVal, { toValue:  0,       duration: 175, useNativeDriver: true }),
          Animated.delay(700),
        ])
      );
      thinkBounceLoop.current.start();
    } else {
      thinkBounceLoop.current?.stop();
      thinkBounceLoop.current = null;
      thinkBounceVal.setValue(0);
    }
  }, [loading]);

  // ── Greeting typewriter ─────────────────────────────────────────────────────
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setGreetingCount(Math.min(n, GREETING.length));
      if (n >= GREETING.length) clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, []);

  // ── Scroll to bottom on new message ────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);
  useEffect(() => { if (messages.length) scrollToBottom(); }, [messages.length]);

  // ── Start typewriter when a new assistant message arrives ──────────────────
  useEffect(() => {
    const idx = messages.length - 1;
    if (idx < 0 || messages[idx].role !== 'assistant') return;
    if (typeTimer.current) clearInterval(typeTimer.current);
    setTypingIdx(idx);
    setTypedCount(1);
    const fullLen = messages[idx].content.length;
    let n = 1;
    typeTimer.current = setInterval(() => {
      n += 1;
      setTypedCount(Math.min(n, fullLen));
      if (n >= fullLen) {
        clearInterval(typeTimer.current!);
        typeTimer.current = null;
        setTypingIdx(-1);
      }
    }, 20);
    return () => { if (typeTimer.current) clearInterval(typeTimer.current); };
  }, [messages.length]);

  // ── Send ───────────────────────────────────────────────────────────────────
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setError(null);
    setChips(pickThree());

    if (!isPremium) {
      setMessages([...history, {
        role: 'assistant',
        content: "Coco AI is a premium feature! Upgrade to Coco Pro and get 20% off — unlock personalised sleep coaching powered by your own data. 🔒",
      }]);
      return;
    }

    setLoading(true);
    loadStartRef.current = Date.now();
    try {
      const reply = await sendCocoMessage(history);
      // Keep thinking bubble visible for at least 1 second
      const elapsed   = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, 1000 - elapsed);
      await new Promise<void>(r => setTimeout(r, remaining));
      setMessages([...history, { role: 'assistant', content: reply }]);
    } catch {
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Paywall gate ───────────────────────────────────────────────────────────
  if (!isPremium) {
    return (
      <View style={gate.container}>
        <DiagonalStripes color={Colors.red} opacity={0.04} />
        <View style={gate.logoMark}><Text style={gate.logoC}>C</Text></View>
        <Text style={gate.title}>COCO AI</Text>
        <View style={gate.bar} />
        <Text style={gate.sub}>Your personal sleep coach.{'\n'}Powered by AI, trained on your data.</Text>
        <TouchableOpacity style={gate.btn} onPress={() => router.push('/paywall')} activeOpacity={0.8}>
          <Text style={gate.btnText}>UNLOCK WITH PRO →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isEmpty = messages.length === 0;
  const firstCocoIdx = messages.findIndex(m => m.role === 'assistant');
  const lastCocoIdx  = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1);

  const suggestionChips = !loading && (
    <View style={sc.section}>
      {chips.map((q, i) => (
        <SuggChip key={`${i}-${q.slice(0, 8)}`} text={q} onPress={() => send(q)} disabled={loading} />
      ))}
    </View>
  );

  return (
    <Animated.View style={[sc.container, { paddingBottom: animPad }]}>
      <ScrollView
        ref={scrollRef}
        style={sc.scroll}
        contentContainerStyle={sc.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          // ── Empty / greeting state ────────────────────────────────────────
          <View style={sc.emptyLayout}>
            <View style={sc.emptyHeader}>
              <Animated.Image
                source={TRAINER_IMG}
                style={[sc.heroAvatar, { transform: [{ translateY: greetingBounce }] }]}
                resizeMode="contain"
              />
              {/* Greeting bubble — same rotated-square tail, same overflow:visible pattern */}
              <View style={sc.greetingBubble}>
                <View style={sc.greetingTail} />
                <Text style={sc.greetingText}>{GREETING.slice(0, greetingCount)}</Text>
              </View>
            </View>
            {suggestionChips}
          </View>
        ) : (
          // ── Chat history ──────────────────────────────────────────────────
          <>
            {messages.map((m, i) => {
              if (m.role === 'user') {
                return <UserBubble key={i} content={m.content} />;
              }
              const isTyping = i === typingIdx;
              return (
                <CocoBubble
                  key={i}
                  content={m.content}
                  visibleContent={isTyping ? m.content.slice(0, typedCount) : undefined}
                  bouncing={i === lastCocoIdx}
                  large={i === firstCocoIdx}
                />
              );
            })}
            {loading && <ThinkingBubble bounceVal={thinkBounceVal} />}
            {error   && <Text style={sc.errorText}>{error}</Text>}
            {suggestionChips}
          </>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={sc.inputBar}>
        <TextInput
          style={sc.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message"
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={500}
          editable={!loading}
        />
        <TouchableOpacity
          style={[sc.sendBtn, (!input.trim() || loading) && sc.sendBtnOff]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
          activeOpacity={0.8}
        >
          <Text style={sc.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Screen-level styles ──────────────────────────────────────────────────────

const sc = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bgDeep },
  scroll:        { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 60, paddingBottom: 12 },

  // Empty state
  emptyLayout: { flex: 1, justifyContent: 'space-between' },
  emptyHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 24,
    paddingBottom: 24,
    minHeight: 160,
  },
  heroAvatar: {
    width: 110,
    height: 110,
    marginLeft: -24,
    flexShrink: 0,
  },
  greetingBubble: {
    flex: 1,
    marginLeft: 10,
    backgroundColor: BUBBLE_COLOR,
    borderRadius: 20,
    paddingHorizontal: PAD_H,
    paddingVertical: 13,
    overflow: 'visible',
  },
  greetingTail: {
    position: 'absolute',
    width: TAIL_BOX,
    height: TAIL_BOX,
    backgroundColor: BUBBLE_COLOR,
    borderRadius: 2,
    left: -(TAIL_BOX / 2) + 1,
    top: 18,  // fixed — greetingBubble uses flex:1 so '%' would float to mid-screen
    transform: [{ rotate: '45deg' }],
  },
  greetingText: {
    fontSize: 15,
    color: '#e8e8e8',
    lineHeight: 23,
    fontWeight: '700',
  },

  // Misc
  section:   { paddingTop: 8, paddingBottom: 4 },
  errorText: { fontSize: 11, color: Colors.red, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgDeep,
  },
  input: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 22,
    color: Colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 110,
    lineHeight: 21,
  },
  sendBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: '#3a3a3c' },
  sendIcon:   { fontSize: 17, fontWeight: '900', color: '#fff' },
});

// ─── Paywall gate styles ──────────────────────────────────────────────────────

const gate = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep, alignItems: 'center', justifyContent: 'center', padding: 40, overflow: 'hidden' },
  logoMark:  { width: 72, height: 72, backgroundColor: Colors.red, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logoC:     { fontSize: 36, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  title:     { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 4 },
  bar:       { height: 3, width: 60, backgroundColor: Colors.red, marginVertical: 14 },
  sub:       { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn:       { backgroundColor: Colors.red, paddingHorizontal: 28, paddingVertical: 14 },
  btnText:   { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 1 },
});
