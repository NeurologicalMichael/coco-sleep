import { View, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface DiagonalStripesProps {
  color?: string;
  opacity?: number;
  spacing?: number;
}

export function DiagonalStripes({ color = Colors.red, opacity = 0.06, spacing = 18 }: DiagonalStripesProps) {
  const stripes = Array.from({ length: 24 }, (_, i) => i);
  return (
    <View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', opacity }]} pointerEvents="none">
      {stripes.map((i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: 1.5,
            height: 400,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
            left: i * spacing - 60,
            top: -150,
          }}
        />
      ))}
    </View>
  );
}
