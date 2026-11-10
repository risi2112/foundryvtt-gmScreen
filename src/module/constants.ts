export const MODULE_ID = 'gm-screen';
export const MODULE_ABBREV = 'GMSCR';

export const TEMPLATES = {
  settings: `modules/${MODULE_ID}/templates/settings.hbs`,
  screen: `modules/${MODULE_ID}/templates/screen.hbs`,
  screenContent: `modules/${MODULE_ID}/templates/parts/screen-content.hbs`,
  screenTabs: `modules/${MODULE_ID}/templates/parts/screen-tabs.hbs`,
  screenCell: `modules/${MODULE_ID}/templates/parts/screen-cell.hbs`,
  screenGrid: `modules/${MODULE_ID}/templates/parts/screen-grid.hbs`,
  grids: {
    tableRow: `modules/${MODULE_ID}/templates/parts/settings-grid-config-table-row.hbs`,
  },
};

export const TAB_GROUP_NAME = 'gmScreen-primary';

export enum MySettings {
  columns = 'columns',
  displayDrawer = 'display-as-drawer',
  drawerHeight = 'drawer-height',
  drawerOpacity = 'drawer-opacity',
  drawerWidth = 'drawer-width',
  gmScreenConfig = 'gm-screen-config',
  migrated = 'migrated',
  condensedButton = 'condensedButton',
  reset = 'reset',
  rightMargin = 'right-margin',
  rows = 'rows',
  tabOverflow = 'tab-overflow',
  journalViewMode = 'journal-view-mode',
}

/**
 * Soft pastel palette for tab colour-coding. Keys are what gets stored in the
 * world config, so the actual shades can be tuned later without migrating data.
 */
export const TAB_COLORS: Record<string, string> = {
  rose: '#f2a7b5',
  peach: '#f5c29e',
  butter: '#f2dd9a',
  sage: '#bfd6a0',
  mint: '#a9dfc2',
  sky: '#a5cdee',
  periwinkle: '#b6bdf5',
  lavender: '#cdb8ef',
  blush: '#efbfd9',
  sand: '#dccbb4',
  slate: '#b3bfcb',
};

export type JournalViewMode = 'single' | 'multiple';

export const JOURNAL_VIEW_MODES: JournalViewMode[] = ['single', 'multiple'];

export enum MyKeybindings {
  openCloseScreen = 'openCloseScreen',
  changeTab = 'changeTab',
}

export const numberRegex = /([+-]?(?=\.\d|\d)(?:\d+)?(?:\.?\d*))(?:[eE]([+-]?\d+))?/;

export const RESIZABLE_DOCUMENTS = ['DeltaGreenActor', 'DeltaGreenItem'];
