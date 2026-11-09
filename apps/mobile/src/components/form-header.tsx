import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { useColors } from './ui';

function HeaderButton({
  title,
  onPress,
  bold,
  testID,
}: {
  title: string;
  onPress: () => void;
  bold?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({ paddingHorizontal: 6, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}
    >
      <Text style={{ color: c.accent, fontSize: 17, fontWeight: bold ? '700' : '400' }}>{title}</Text>
    </Pressable>
  );
}

/**
 * Cancel / Save in a modal form's header. Cancel goes back, so the screen's discard guard
 * (useDiscardGuard) asks first when there are unsaved changes.
 */
export function FormHeader({ saveLabel, onSave, busy }: { saveLabel: string; onSave: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Stack.Screen
      options={{
        headerLeft: () => (
          <HeaderButton testID="header-cancel" title={t('common.cancel')} onPress={() => router.back()} />
        ),
        headerRight: () =>
          busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <HeaderButton testID="header-save" title={saveLabel} bold onPress={onSave} />
          ),
      }}
    />
  );
}
