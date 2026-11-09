// Brand accent for native Android UI (date/time pickers, Switch, alert dialog buttons). Without it they
// use the stock Material teal/blue. Sets colorPrimary/colorAccent/colorControlActivated on AppTheme (the
// platform date/time picker dialogs take their accent from it) and gives alert dialogs the same accent.
// Don't point android:datePickerDialogTheme at the alert theme: its window sizing clips the picker header.
const { AndroidConfig, withAndroidColors, withAndroidStyles } = require('expo/config-plugins');

const DIALOG_THEME = 'Theme.App.Dialog';

function withAndroidAccent(config, { accent = '#FF4D6D' } = {}) {
  config = withAndroidColors(config, (cfg) => {
    for (const name of ['colorPrimary', 'colorAccent']) {
      cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, { name, value: accent });
    }
    return cfg;
  });
  return withAndroidStyles(config, (cfg) => {
    let styles = cfg.modResults;
    const appTheme = { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' };
    const items = [
      ['colorPrimary', '@color/colorPrimary'],
      ['colorAccent', '@color/colorAccent'],
      ['colorControlActivated', '@color/colorAccent'],
      ['android:colorAccent', '@color/colorAccent'],
      ['android:alertDialogTheme', `@style/${DIALOG_THEME}`],
      ['alertDialogTheme', `@style/${DIALOG_THEME}`],
    ];
    for (const [name, value] of items) {
      styles = AndroidConfig.Styles.assignStylesValue(styles, { add: true, parent: appTheme, name, value });
    }
    const dialog = { name: DIALOG_THEME, parent: 'Theme.AppCompat.DayNight.Dialog.Alert' };
    for (const [name, value] of [
      ['colorPrimary', '@color/colorPrimary'],
      ['colorAccent', '@color/colorAccent'],
      ['colorControlActivated', '@color/colorAccent'],
      ['android:colorAccent', '@color/colorAccent'],
    ]) {
      styles = AndroidConfig.Styles.assignStylesValue(styles, { add: true, parent: dialog, name, value });
    }
    cfg.modResults = styles;
    return cfg;
  });
}

module.exports = withAndroidAccent;
