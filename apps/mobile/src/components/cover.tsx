import { getTheme } from '@check-in/shared';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { publicUrl } from '@/lib/supabase';

/** Event cover: the uploaded image if any, otherwise the theme gradient. */
export function Cover({
  coverPath,
  theme,
  height = 180,
  radius = 20,
  children,
  style,
}: {
  coverPath?: string | null;
  theme?: string | null;
  height?: number;
  radius?: number;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const t = getTheme(theme);
  const url = publicUrl('covers', coverPath);
  return (
    <View
      style={[
        {
          height,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundImage: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`,
          justifyContent: 'flex-end',
        },
        style,
      ]}
    >
      {url ? (
        <Image source={url} style={{ position: 'absolute', inset: 0 }} contentFit="cover" />
      ) : null}
      {children}
    </View>
  );
}
