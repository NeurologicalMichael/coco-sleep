import { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { CocoLevel, COCO_LEVELS } from '../constants/cocoLevels';

interface Props {
  level: CocoLevel;
  size?: number;
  showLabel?: boolean;
}

export function CocoAvatar({ level, size = 120, showLabel = false }: Props) {
  const info = COCO_LEVELS[level];
  const [imgError, setImgError] = useState(false);

  return (
    <View style={styles.wrap}>
      {info.image && !imgError ? (
        <Image
          source={info.image}
          style={{ width: size, height: size }}
          resizeMode="contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <View style={[styles.goldPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.goldPlaceholderText, { fontSize: size * 0.28 }]}>CC</Text>
        </View>
      )}
      {showLabel && (
        <Text style={[styles.label, { color: info.color }]}>{info.label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  goldPlaceholder: {
    backgroundColor: 'rgba(245,200,66,0.15)',
    borderWidth: 2,
    borderColor: '#F5C842',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldPlaceholderText: {
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#F5C842',
    letterSpacing: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 3,
    marginTop: 6,
  },
});
