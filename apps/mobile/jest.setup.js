jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-GB' }] }));
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
