import { GmScreenConfig, GmScreenApi } from './gridTypes';

declare global {
  interface ModuleConfig {
    'gm-screen-risi': {
      api?: GmScreenApi;
    };
    '_dev-mode': {
      api?: Record<string, (string) => void>;
    };
  }
  interface SettingConfig {
    'gm-screen-risi.columns': number;
    'gm-screen-risi.display-as-drawer': boolean;
    'gm-screen-risi.drawer-height': number;
    'gm-screen-risi.drawer-opacity': number;
    'gm-screen-risi.drawer-width': number;
    'gm-screen-risi.gm-screen-config': GmScreenConfig;
    'gm-screen-risi.migrated': {
      status: boolean;
      version: string;
    };
    'gm-screen-risi.condensedButton': boolean;
    'gm-screen-risi.reset': boolean;
    'gm-screen-risi.right-margin': number;
    'gm-screen-risi.rows': number;
    'gm-screen-risi.tab-overflow': 'scroll' | 'wrap';
    'gm-screen-risi.journal-view-mode': 'default' | 'single' | 'multiple';
    'gm-screen-risi.imported-from-original': boolean;
    'core.uiConfig': {
      colorScheme: {
        interface: 'light' | 'dark';
        applications: 'light' | 'dark';
      };
    };
  }
}

declare module 'fvtt-types/configuration' {
  namespace Hooks {
    interface HookConfig {
      devModeReady: (app: { registerPackageDebugFlag: (moduleId: string) => void }) => void;
    }
  }
}
