import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

const light = {
  bg: '#FFFFFF',
  surface: '#F4F4F6',
  text: '#111114',
  muted: '#6B6B76',
  border: '#E3E3E8',
  accent: '#FF4D6D',
  accentText: '#FFFFFF',
  danger: '#D92D20',
};
const dark: typeof light = {
  bg: '#0E0E11',
  surface: '#1C1C21',
  text: '#F4F4F6',
  muted: '#9A9AA5',
  border: '#2C2C33',
  accent: '#FF5C7A',
  accentText: '#FFFFFF',
  danger: '#FF6B5E',
};

export function useColors() {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ flex: 1, backgroundColor: c.bg, padding: 20, gap: 16 }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>{children}</Text>;
}

export function Body({ children, muted, center }: { children: ReactNode; muted?: boolean; center?: boolean }) {
  const c = useColors();
  return (
    <Text style={{ fontSize: 16, color: muted ? c.muted : c.text, textAlign: center ? 'center' : 'left' }}>
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted, textTransform: 'uppercase' }}>{children}</Text>;
}

export function ErrorText({ children, testID }: { children?: ReactNode; testID?: string }) {
  const c = useColors();
  if (!children) return null;
  return <Text testID={testID} style={{ color: c.danger, fontSize: 14 }}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const bg = { primary: c.accent, secondary: c.surface, danger: c.surface, ghost: 'transparent' }[variant];
  const fg = { primary: c.accentText, secondary: c.text, danger: c.danger, ghost: c.accent }[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string | null }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          styles.input,
          { backgroundColor: c.surface, color: c.text, borderColor: error ? c.danger : c.border },
          props.multiline && { minHeight: 90, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      <ErrorText testID={props.testID ? `${props.testID}-error` : undefined}>{error}</ErrorText>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: 16, padding: 16, gap: 8 }, style]}>
      {children}
    </View>
  );
}

/** − value + stepper (plus-ones). Buttons are disabled at the bounds. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  testID,
  decreaseLabel,
  increaseLabel,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  testID?: string;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean;
}) {
  const c = useColors();
  const step = (label: string, glyph: string, next: number, off: boolean, id: string) => (
    <Pressable
      testID={testID ? `${testID}-${id}` : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => onChange(next)}
      style={({ pressed }) => [
        styles.stepperButton,
        { backgroundColor: c.surface, borderColor: c.border, opacity: off ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ fontSize: 22, fontWeight: '700', color: c.text }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {step(decreaseLabel, '−', value - 1, !!disabled || value <= min, 'decrease')}
      <Text testID={testID ? `${testID}-value` : undefined} style={{ fontSize: 18, fontWeight: '700', color: c.text, minWidth: 18, textAlign: 'center' }}>
        {value}
      </Text>
      {step(increaseLabel, '+', value + 1, !!disabled || value >= max, 'increase')}
    </View>
  );
}

const styles = StyleSheet.create({
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
