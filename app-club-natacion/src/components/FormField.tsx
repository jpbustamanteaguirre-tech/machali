import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

const NAVY = '#0B1E2F';
const BORDER = '#E6E8EC';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export const FormField = forwardRef<TextInput, Props>(({ label, error, style, ...rest }, ref) => {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput ref={ref} style={[s.input, style]} placeholderTextColor="#8A98A8" {...rest} />
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
});

const s = StyleSheet.create({
  label: { color: NAVY, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 48,
    paddingHorizontal: 14, color: NAVY, backgroundColor: '#fff',
  },
  error: { color: '#CE2434', marginTop: 6 },
});

export default FormField;
