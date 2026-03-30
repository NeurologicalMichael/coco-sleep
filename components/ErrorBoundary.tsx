import { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Wraps a subtree and catches any React render errors.
 * Shows a minimal recovery UI instead of crashing the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error.message, info.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={s.container}>
          <Text style={s.eyebrow}>// ERROR</Text>
          <Text style={s.title}>SOMETHING BROKE.</Text>
          <View style={s.bar} />
          <Text style={s.body}>
            {this.props.fallbackLabel ?? 'This section couldn\'t load. Tap to retry.'}
          </Text>
          <TouchableOpacity style={s.btn} onPress={this.reset}>
            <Text style={s.btnText}>RETRY →</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  eyebrow: {
    fontSize: 9, fontWeight: '900', fontStyle: 'italic',
    letterSpacing: 3, color: Colors.red, marginBottom: 4,
  },
  title: {
    fontSize: 28, fontWeight: '900', fontStyle: 'italic',
    color: Colors.textPrimary, marginBottom: 8,
  },
  bar: { height: 3, width: 40, backgroundColor: Colors.red, marginBottom: 16 },
  body: {
    fontSize: 14, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22, marginBottom: 24,
  },
  btn: { borderWidth: 1.5, borderColor: Colors.red, paddingHorizontal: 24, paddingVertical: 12 },
  btnText: { fontSize: 11, fontWeight: '900', fontStyle: 'italic', letterSpacing: 2, color: Colors.red },
});
