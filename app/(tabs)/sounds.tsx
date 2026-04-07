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

const TRAINER = require('../../assets/coco/trainer_nobg.png');

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

// ─── Message bubbles ──────────────────────────────────────────────────────────

function Bubble({ msg, displayText, isLatest, isFirst }: { msg: ChatMessage; displayText?: string; isLatest: boolean; isFirst?: boolean }) {
  const isUser = msg.role === 'user';
  // Only the latest assistant bubble bounces; hook always called (rules of hooks)
  const bounce = useJaggyBounce(1.53, !isUser && isLatest);

  if (isUser) {
    return (
      <View style={[bs.row, bs.rowUser]}>
        <View style={bs.bubbleUser}>
          <Text style={[bs.text, bs.textUser]}>{msg.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[bs.row, isFirst && bs.rowFirst]}>
      <Animated.Image
        source={TRAINER}
        style={[bs.trainerImg, { transform: [{ translateY: bounce }] }]}
        resizeMode="contain"
      />
      <View style={[bs.bubbleWrapper, isFirst && bs.bubbleWrapperFirst]}>
        {/* bubbleShell has no borderRadius/backgroundColor so triangle never gets clipped */}
        <View style={bs.bubbleShell}>
          <View style={bs.speechTail} />
          <View style={[bs.bubbleCoco, isFirst && bs.bubbleCocoFirst]}>
            <Text style={bs.text}>
              {displayText !== undefined ? displayText : msg.content}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// Shared bounce animation builder.
// amp  — 1.0 for 110px greeting trainer, 1.53 (=110/72) for 72px chat trainer.
// active — when it flips false the animation stops and resets to 0.
function useJaggyBounce(amp = 1, active = true) {
  const bounce  = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      const a = amp;
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(bounce, { toValue: -6 * a, duration: 162, useNativeDriver: true }),
          Animated.timing(bounce, { toValue:  3 * a, duration: 137, useNativeDriver: true }),
          Animated.timing(bounce, { toValue: -4 * a, duration: 150, useNativeDriver: true }),
          Animated.timing(bounce, { toValue:  2 * a, duration: 125, useNativeDriver: true }),
          Animated.timing(bounce, { toValue: -2 * a, duration: 137, useNativeDriver: true }),
          Animated.timing(bounce, { toValue:  0,     duration: 175, useNativeDriver: true }),
          Animated.delay(700),
        ])
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      animRef.current = null;
      bounce.setValue(0);
    }
    return () => { animRef.current?.stop(); animRef.current = null; };
  }, [active]);

  return bounce;
}

// bounce value is owned by the parent so it starts the moment loading=true
function TypingBubble({ bounce }: { bounce: Animated.Value }) {
  return (
    <View style={bs.row}>
      <Animated.Image
        source={TRAINER}
        style={[bs.trainerImg, { transform: [{ translateY: bounce }] }]}
        resizeMode="contain"
      />
      <View style={bs.bubbleWrapper}>
        <View style={bs.bubbleShell}>
          <View style={bs.speechTail} />
          <View style={[bs.bubbleCoco, bs.typingBubble]}>
            <ActivityIndicator size="small" color={Colors.red} />
          </View>
        </View>
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
      >
        <Text style={bs.suggText}>{text}</Text>
      </TouchableOpacity>
    </View>
  );
}

const BUBBLE_BG   = '#262626';   // iMessage-style dark-gray received bubble
const TAIL_COLOR  = '#262626';

const bs = StyleSheet.create({
  // ── Rows ─────────────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    marginBottom: 14,
    alignItems: 'flex-start',
    paddingRight: 16,
  },
  rowUser: {
    flexDirection: 'row-reverse',
    paddingLeft: 60,   // keeps user bubble from stretching full width
    paddingRight: 16,
  },

  // ── Trainer image ─────────────────────────────────────────────────────────────
  trainerImg: {
    width: 72,
    height: 72,
    marginLeft: -18,
    flexShrink: 0,
  },

  // ── Bubble wrapper (relative so tail can be absolute) ────────────────────────
  bubbleWrapper: {
    flex: 1,
    position: 'relative',
    marginLeft: 6,
  },

  // bubbleShell: no borderRadius, no backgroundColor → iOS never clips absolute children.
  // Triangle is positioned here, bubbleCoco is the purely visual inner bubble.
  bubbleShell: {
    flex: 1,
  },

  // Triangle positioned relative to bubbleShell (same height as bubbleCoco).
  // top:'50%' + translateY:-8 centers it vertically — at 50% the bubble left edge
  // is perfectly straight (outside both corner-radius zones), so the connection is flush.
  speechTail: {
    position: 'absolute',
    left: -8,
    top: '50%',
    transform: [{ translateY: -8 }],
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderRightWidth: 8,
    borderLeftWidth: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: BUBBLE_BG,
    borderLeftColor: 'transparent',
  },

  // ── Rows ─────────────────────────────────────────────────────────────────────
  rowFirst: {
    paddingRight: 6,
  },

  // ── Bubble wrapper variants ───────────────────────────────────────────────────
  bubbleWrapperFirst: {
    marginLeft: 2,
  },

  // ── Bubbles ───────────────────────────────────────────────────────────────────
  bubbleCoco: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: BUBBLE_BG,
    borderRadius: 22,
    minHeight: 44,
  },
  bubbleCocoFirst: {
    paddingVertical: 14,   // 11 × 1.25
    minHeight: 55,         // 44 × 1.25
  },
  bubbleUser: {
    backgroundColor: Colors.red,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 6,
  },

  text:       { fontSize: 15, color: '#e8e8e8', lineHeight: 22, fontWeight: '700' },
  textUser:   { color: '#fff', fontWeight: '700' },

  typingBubble: { paddingVertical: 12, paddingHorizontal: 18 },

  // ── Suggestions ───────────────────────────────────────────────────────────────
  suggRow:    { flexDirection: 'row-reverse', paddingHorizontal: 16, marginBottom: 8 },
  suggBubble: {
    maxWidth: '80%', paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1.5, borderColor: Colors.red + '66',
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  suggText: { fontSize: 13, color: Colors.red + 'cc', fontStyle: 'italic', lineHeight: 19 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CocoAIScreen() {
  const { isPremium } = usePurchaseStore();
  const router        = useRouter();
  const insets        = useSafeAreaInsets();

  const [messages,   setMessages]   = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [chips,      setChips]      = useState<string[]>(() => pickThree());
  const [error,      setError]      = useState<string | null>(null);

  // Typewriter state — tracks which assistant message is currently being revealed
  const [typingIdx,   setTypingIdx]   = useState(-1);
  const [typedCount,  setTypedCount]  = useState(0);
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Greeting typewriter + bounce (empty state)
  const GREETING = "Hey! I'm Coco.\nAsk me anything about your sleep.";
  const [greetingTyped, setGreetingTyped] = useState(0);
  const greetingBounce = useJaggyBounce(1);

  // Typing-bubble bounce — lives in parent so it starts the instant loading=true
  // 110/72 ≈ 1.53: scales amplitude so 72px trainer looks identical to 110px greeting trainer
  const typingBounce    = useRef(new Animated.Value(0)).current;
  const typingBounceRef = useRef<Animated.CompositeAnimation | null>(null);

  const scrollRef   = useRef<ScrollView>(null);
  const animatedPad = useRef(new Animated.Value(0)).current;

  // Keyboard avoidance
  useEffect(() => {
    const tabBarH = Platform.OS === 'ios' ? 49 + insets.bottom : 0;
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        Animated.spring(animatedPad, {
          toValue: Math.max(0, e.endCoordinates.height - tabBarH),
          speed: 40, bounciness: 0, useNativeDriver: false,
        }).start();
        // Scroll to bottom after padding has expanded so latest messages stay visible
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => Animated.spring(animatedPad, { toValue: 0, speed: 40, bounciness: 0, useNativeDriver: false }).start(),
    );
    return () => { show.remove(); hide.remove(); };
  }, [insets.bottom]);

  // Start/stop typing bounce in sync with loading state
  useEffect(() => {
    if (loading) {
      const amp = 1.53;
      typingBounceRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(typingBounce, { toValue: -6 * amp, duration: 162, useNativeDriver: true }),
          Animated.timing(typingBounce, { toValue:  3 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(typingBounce, { toValue: -4 * amp, duration: 150, useNativeDriver: true }),
          Animated.timing(typingBounce, { toValue:  2 * amp, duration: 125, useNativeDriver: true }),
          Animated.timing(typingBounce, { toValue: -2 * amp, duration: 137, useNativeDriver: true }),
          Animated.timing(typingBounce, { toValue:  0,       duration: 175, useNativeDriver: true }),
          Animated.delay(700),
        ])
      );
      typingBounceRef.current.start();
    } else {
      typingBounceRef.current?.stop();
      typingBounceRef.current = null;
      typingBounce.setValue(0);
    }
  }, [loading]);

  // Greeting typewriter — fires once on mount (bounce handled by useJaggyBounce above)
  useEffect(() => {
    let count = 0;
    const id = setInterval(() => {
      count += 1;
      setGreetingTyped(Math.min(count, GREETING.length));
      if (count >= GREETING.length) clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  useEffect(() => { if (messages.length) scrollToBottom(); }, [messages.length]);

  // Start typewriter when a new assistant message is appended
  useEffect(() => {
    const lastIdx = messages.length - 1;
    if (lastIdx < 0 || messages[lastIdx].role !== 'assistant') return;
    // Clear any existing timer
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    setTypingIdx(lastIdx);
    setTypedCount(1); // start at 1 so bubble always has ≥1 char — avoids zero-height tail flash
    const fullLen = messages[lastIdx].content.length;
    let count = 1;
    typeTimerRef.current = setInterval(() => {
      count += 1; // 1 char per tick — 2.5× slower than original
      setTypedCount(Math.min(count, fullLen));
      if (count >= fullLen) {
        clearInterval(typeTimerRef.current!);
        typeTimerRef.current = null;
        setTypingIdx(-1);
      }
    }, 20);
    return () => { if (typeTimerRef.current) clearInterval(typeTimerRef.current); };
  }, [messages.length]);

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
    setChips(pickThree());

    // Non-premium users get a hard gate — no API call made
    if (!isPremium) {
      setMessages([...next, {
        role: 'assistant',
        content: "Coco AI is a premium feature! Upgrade to Coco Pro and get 20% off — unlock personalised sleep coaching powered by your own data. 🔒",
      }]);
      return;
    }

    setLoading(true);
    try {
      const reply = await sendCocoMessage(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch {
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Paywall gate ──────────────────────────────────────────────────────────────

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
          <View style={s.emptyLayout}>
            <View style={s.emptyHeader}>
              <Animated.Image
                source={TRAINER}
                style={[s.trainerHero, { transform: [{ translateY: greetingBounce }] }]}
                resizeMode="contain"
              />
              <View style={s.greetingOuter}>
                <View style={s.greetingTail} />
                <View style={s.greetingBubble}>
                  <Text style={s.greetingText}>
                    {GREETING.slice(0, greetingTyped)}
                  </Text>
                </View>
              </View>
            </View>
            {suggestions}
          </View>
        ) : (
          <>
            {(() => {
              // Only the most-recent assistant bubble bounces; all others freeze at 0
              const lastCocoIdx  = messages.reduce((acc, msg, j) => msg.role === 'assistant' ? j : acc, -1);
              const firstCocoIdx = messages.findIndex(m => m.role === 'assistant');
              return messages.map((m, i) => {
              const isTypingMsg = m.role === 'assistant' && i === typingIdx;
              const displayText = isTypingMsg ? m.content.slice(0, typedCount) : undefined;
              return (
                <Bubble
                  key={i}
                  msg={m}
                  displayText={displayText}
                  isLatest={i === lastCocoIdx}
                  isFirst={i === firstCocoIdx}
                />
              );
            });
            })()}
            {loading && <TypingBubble bounce={typingBounce} />}
            {error && <Text style={s.errorText}>{error}</Text>}
            {suggestions}
          </>
        )}
      </ScrollView>

      {/* Input bar — iMessage style */}
      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message"
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
  container:     { flex: 1, backgroundColor: Colors.bgDeep },
  scroll:        { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 60, paddingBottom: 12 },

  // ── Empty state ───────────────────────────────────────────────────────────────
  emptyLayout: { flex: 1, justifyContent: 'space-between' },

  emptyHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 24,
    paddingBottom: 24,
    minHeight: 160,
  },

  trainerHero: {
    width: 110,
    height: 110,
    marginLeft: -24,
    flexShrink: 0,
  },

  greetingOuter: {
    flex: 1,
    position: 'relative',
    marginLeft: 8,
  },
  greetingTail: {
    position: 'absolute',
    left: -7,
    top: 30,
    width: 18,
    height: 18,
    backgroundColor: BUBBLE_BG,
    borderRadius: 3,
    transform: [{ rotate: '45deg' }],
    zIndex: 0,
  },
  greetingBubble: {
    backgroundColor: BUBBLE_BG,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 13,
    zIndex: 1,
  },
  greetingText: {
    fontSize: 15,
    color: '#e8e8e8',
    lineHeight: 23,
    fontWeight: '700',
  },

  // ── Misc ──────────────────────────────────────────────────────────────────────
  errorText:   { fontSize: 11, color: Colors.red, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  suggSection: { paddingTop: 8, paddingBottom: 4 },

  // ── Input bar — iMessage style ────────────────────────────────────────────────
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
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#3a3a3c' },
  sendIcon:   { fontSize: 17, fontWeight: '900', color: '#fff' },
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
  logoC:   { fontSize: 36, fontWeight: '900', fontStyle: 'italic', color: '#fff' },
  title:   { fontSize: 48, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 4 },
  bar:     { height: 3, width: 60, backgroundColor: Colors.red, marginVertical: 14 },
  sub:     { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn:     { backgroundColor: Colors.red, paddingHorizontal: 28, paddingVertical: 14 },
  btnText: { fontSize: 13, fontWeight: '900', fontStyle: 'italic', color: '#fff', letterSpacing: 1 },
});
