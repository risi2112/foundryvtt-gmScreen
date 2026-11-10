import { getGame, log } from './helpers';
import { MODULE_ID, MySettings, ORIGINAL_MODULE_ID } from './constants';

/**
 * This module used to share the original GM Screen's id ("gm-screen"). Now that it has its own id,
 * its settings live under a new name, so the first time it runs it copies the old ones across.
 * Nothing is copied over settings this module already has, and the original's settings are left untouched.
 */

const WORLD_KEYS = [MySettings.gmScreenConfig, MySettings.columns, MySettings.rows];

const CLIENT_KEYS = [
  MySettings.displayDrawer,
  MySettings.rightMargin,
  MySettings.drawerWidth,
  MySettings.drawerHeight,
  MySettings.drawerOpacity,
  MySettings.condensedButton,
  MySettings.tabOverflow,
  MySettings.journalViewMode,
];

/**
 * Per-browser settings are kept in localStorage. Run during init, before anything reads them.
 */
export function importOriginalClientSettings() {
  try {
    CLIENT_KEYS.forEach((key) => {
      const newKey = `${MODULE_ID}.${key}`;
      const oldValue = window.localStorage.getItem(`${ORIGINAL_MODULE_ID}.${key}`);
      if (oldValue !== null && window.localStorage.getItem(newKey) === null) {
        window.localStorage.setItem(newKey, oldValue);
      }
    });
  } catch (error) {
    log(true, 'could not copy display settings from the original GM Screen', error);
  }
}

function findWorldSetting(key: string) {
  const storage = getGame().settings.storage.get('world') as unknown as
    | { find: (predicate: (setting: { key: string; value: unknown }) => boolean) => { value: unknown } | undefined }
    | undefined;
  return storage?.find((setting) => setting.key === key);
}

function parseSettingValue(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * World settings (the tab layouts, default rows/columns). GM only, once per world.
 */
export async function importOriginalWorldSettings() {
  const game = getGame();
  if (!game.user?.isGM || game.settings.get(MODULE_ID, MySettings.importedFromOriginal)) {
    return;
  }

  let importedSomething = false;
  try {
    // eslint-disable-next-line no-restricted-syntax
    for (const key of WORLD_KEYS) {
      const alreadySet = findWorldSetting(`${MODULE_ID}.${key}`);
      const original = findWorldSetting(`${ORIGINAL_MODULE_ID}.${key}`);
      if (!alreadySet && original) {
        // eslint-disable-next-line no-await-in-loop
        await game.settings.set(MODULE_ID, key, parseSettingValue(original.value) as never);
        importedSomething = true;
      }
    }
  } catch (error) {
    log(true, 'could not copy tab layouts from the original GM Screen', error);
    return;
  }

  await game.settings.set(MODULE_ID, MySettings.importedFromOriginal, true);
  if (importedSomething) {
    ui.notifications?.info('GM Screen (Arri’s): brought over your tabs and layout from the original GM Screen.');
  }
}
