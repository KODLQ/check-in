// Snap Creative Kit's Android project still uses jcenter(), which Gradle 9 removed, so it can't be
// built. Android leaves it unlinked and "Share to Story" uses the share sheet there until the SDK is
// updated (see openspec/changes/add-story-share-card/design.md, Implementation notes).
module.exports = {
  dependencies: {
    '@snapchat/snap-kit-react-native': {
      platforms: { android: null },
    },
  },
};
