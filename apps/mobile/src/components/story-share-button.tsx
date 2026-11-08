import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { Button } from '@/components/ui';
import { locale } from '@/lib/i18n';
import {
  availableDestinations,
  cleanupStoryImages,
  downloadStoryImage,
  shareStory,
  type StoryDestination,
} from '@/lib/story-share';

/** Destination picker; resolves null when the host cancels. */
function pickDestination(
  options: StoryDestination[],
  labels: Record<StoryDestination, string>,
  title: string,
  cancel: string,
): Promise<StoryDestination | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: [...options.map((o) => labels[o]), cancel], cancelButtonIndex: options.length },
        (i) => resolve(options[i] ?? null),
      );
      return;
    }
    // Android alerts show up to three buttons: at most Instagram, Snapchat and "More…"; back/outside cancels.
    Alert.alert(
      title,
      undefined,
      options.map((o) => ({ text: labels[o], onPress: () => resolve(o) })),
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export function StoryShareButton({
  token,
  link,
  title,
  notify,
}: {
  token: string;
  link: string;
  title: string;
  notify: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    let prepared;
    try {
      prepared = await Promise.all([downloadStoryImage(token, locale), availableDestinations()]);
    } catch {
      setBusy(false);
      Alert.alert(t('story.image_failed'), t('common.error'));
      return;
    }
    setBusy(false);
    const [file, destinations] = prepared;
    const destination =
      destinations.length === 1
        ? 'sheet'
        : await pickDestination(
            destinations,
            { instagram: t('story.instagram'), snapchat: t('story.snapchat'), sheet: t('story.more') },
            t('story.pick_destination'),
            t('common.cancel'),
          );
    if (!destination) {
      cleanupStoryImages();
      return;
    }
    await shareStory({
      file,
      destination,
      link,
      message: t('story.share_text', { title }),
      notify: (key) => notify(key === 'link_copied' ? t('story.link_copied_sticker') : t('story.direct_failed')),
    });
  }

  return (
    <Button
      testID="share-story"
      variant="secondary"
      title={t('story.share_to_story')}
      onPress={onPress}
      disabled={busy}
      loading={busy}
    />
  );
}
