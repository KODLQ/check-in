import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAwareScrollView,
  KeyboardToolbar,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

import { useColors } from './ui';

type Props = ComponentProps<typeof KeyboardAwareScrollView> & { children?: ReactNode };

/** Height of the "Done" toolbar shown above the keyboard (KEYBOARD_TOOLBAR_HEIGHT in the library). */
const TOOLBAR_HEIGHT = 42;

/**
 * Scroll view for screens with text inputs: keeps the focused input (and the button below it) above the
 * keyboard, lets the first tap on another control through while the keyboard is up, dismisses the
 * keyboard by dragging, and shows a "Done" bar above the keyboard so multiline inputs can be closed.
 */
export const KeyboardScroll = forwardRef<KeyboardAwareScrollViewRef, Props>(function KeyboardScroll(
  { children, bottomOffset = 24, ...props },
  ref,
) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <>
      <KeyboardAwareScrollView
        ref={ref}
        bottomOffset={bottomOffset + TOOLBAR_HEIGHT}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: c.bg }}
        {...props}
      >
        {children}
      </KeyboardAwareScrollView>
      <KeyboardToolbar>
        <KeyboardToolbar.Done text={t('common.done')} />
      </KeyboardToolbar>
    </>
  );
});
