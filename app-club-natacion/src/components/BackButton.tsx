// src/components/BackButton.tsx
import { router } from 'expo-router';
import { Text, TouchableOpacity } from 'react-native';

type Props = {
  fallback?: string;
  hitSlop?: { top: number; bottom: number; left: number; right: number };
  style?: any;
  textStyle?: any;
};

export default function BackButton({
  fallback = '/(tabs)',
  hitSlop = { top: 8, bottom: 8, left: 8, right: 8 },
  style,
  textStyle,
}: Props) {
  const goBackSafe = () => {
    // @ts-ignore expo-router puede exponer canGoBack()
    if (router.canGoBack?.()) {
      router.back();
    } else {
      router.replace(fallback);
    }
  };

  return (
    <TouchableOpacity onPress={goBackSafe} hitSlop={hitSlop} style={style}>
      <Text style={[{ color: '#fff', fontSize: 18 }, textStyle]}>←</Text>
    </TouchableOpacity>
  );
}
