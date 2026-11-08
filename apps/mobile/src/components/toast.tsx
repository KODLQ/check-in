import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Small non-blocking message at the top of the screen; hides itself after a few seconds. */
export function Toast({
  message,
  onHide,
  durationMs = 4000,
}: {
  message: string | null;
  onHide: () => void;
  durationMs?: number;
}) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onHide, durationMs);
    return () => clearTimeout(id);
  }, [message, onHide, durationMs]);

  if (!message) return null;
  return (
    <Pressable
      testID="toast"
      accessibilityRole="alert"
      onPress={onHide}
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 16,
        right: 16,
        backgroundColor: 'rgba(17,17,20,0.92)',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
        {message}
      </Text>
    </Pressable>
  );
}
