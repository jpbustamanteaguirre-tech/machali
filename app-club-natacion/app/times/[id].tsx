import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TimeNew() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top','right','left','bottom']}>
      <Text style={{ margin: 24 }}>Registrar tiempo (stub)</Text>
    </SafeAreaView>
  );
}
