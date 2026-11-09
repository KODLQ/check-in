import { ActionSheetIOS, Alert, Platform } from 'react-native';

export interface SheetOption {
  label: string;
  destructive?: boolean;
}

/**
 * Native list of choices: an action sheet on iOS, an alert with buttons on Android. Resolves with the
 * index of the chosen option, or null when cancelled.
 */
export function showActionSheet(
  options: SheetOption[],
  { title, cancelLabel }: { title?: string; cancelLabel: string },
): Promise<number | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      const destructive = options.flatMap((o, i) => (o.destructive ? [i] : []));
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...options.map((o) => o.label), cancelLabel],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: destructive.length > 0 ? destructive : undefined,
        },
        (index) => resolve(index < options.length ? index : null),
      );
      return;
    }
    // Android alerts take at most three buttons, so list the options and keep cancel separate when
    // there is room; with three options the alert is dismissed by tapping outside.
    Alert.alert(
      title ?? '',
      undefined,
      [
        ...options.map((o, i) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : undefined, onPress: () => resolve(i) })),
        ...(options.length < 3 ? [{ text: cancelLabel, style: 'cancel' as const, onPress: () => resolve(null) }] : []),
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
