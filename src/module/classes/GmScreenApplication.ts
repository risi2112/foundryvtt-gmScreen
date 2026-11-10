import {
  emptyClose,
  getGame,
  getGridElementsPosition,
  getLocalization,
  getUserCellConfigurationInput,
  getUserViewableGrids,
  isActorOrItemResizable,
  log,
  postRenderV2,
  updateCSSPropertyVariable,
} from '../helpers';
import {
  JOURNAL_VIEW_MODES,
  JournalViewMode,
  MODULE_ABBREV,
  MODULE_ID,
  MySettings,
  TAB_COLORS,
  TAB_GROUP_NAME,
  TAB_ROWS,
  TabRow,
  TEMPLATES,
} from '../constants';
import { GmScreenConfig, GmScreenGrid, GmScreenGridEntry } from '../../gridTypes';

import { GmScreenSettings } from './GmScreenSettings';
import { CompactRollTableDisplay } from './CompactRollTableDisplay';
import { CompactJournalEntryPageDisplay } from './CompactJournalEntryPageDisplay';
import { CompactJournalEntryDisplay } from './CompactJournalEntryDisplay';

enum ClickAction {
  clearGrid = 'clearGrid',
  refresh = 'refresh',
  clearCell = 'clearCell',
  configureCell = 'configureCell',
  open = 'open',
  statBlock = 'statBlock',
  toggleGmScreen = 'toggle-gm-screen',
  tab = 'tab',
  chooseImage = 'chooseImage',
  scrollTabsPrev = 'scrollTabsPrev',
  scrollTabsNext = 'scrollTabsNext',
}

interface CustomOptions {
  cellId: string;
  _injectHTML(html: JQuery): void;
  _replaceHTML(element: JQuery, html: JQuery): void;
  _postRender(): Promise<void>;
}

type GmScreenApp =
  | (ActorSheet & { render: (force?: boolean) => void })
  | (ItemSheet & { render: (force?: boolean) => void })
  | (foundry.applications.sheets.journal.JournalEntrySheet & { render: (force?: boolean) => void })
  | (foundry.applications.sheets.journal.JournalEntryPageHandlebarsSheet & { render: (force?: boolean) => void })
  | (foundry.applications.sheets.RollTableSheet & { render: (force?: boolean) => void })
  | (foundry.applications.sheets.ActorSheetV2 & { render: (force?: boolean) => void })
  | (foundry.applications.sheets.ItemSheetV2 & { render: (force?: boolean) => void });

type ActorV2Constructor = new (
  options: Partial<foundry.applications.sheets.ActorSheetV2.Configuration>
) => foundry.applications.sheets.ActorSheetV2 & CustomOptions;

type JournalEntryPageProseMirrorSheetConstructor = new (
  options: Partial<foundry.applications.sheets.journal.JournalEntryPageProseMirrorSheet.Configuration>
) => foundry.applications.sheets.journal.JournalEntryPageProseMirrorSheet & CustomOptions;

type ItemV2Constructor = new (
  options: Partial<foundry.applications.sheets.ItemSheetV2.Configuration>
) => foundry.applications.sheets.ItemSheetV2 & CustomOptions;

type ItemAndActorV1Constructor = new (
  x: Actor | Item,
  options: {
    width?: string;
    height?: string;
    positioned?: boolean;
    resizable?: boolean;
  }
) => (ItemSheet & CustomOptions) | (ActorSheet & CustomOptions);

interface PendingCellRefresh {
  gridId: string;
  entryId: string;
  cellId: string;
  entry?: Partial<GmScreenGridEntry>;
  expectedData?: GmScreenConfig;
}

export class GmScreenApplication extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  expanded: boolean;

  data: GmScreenConfig;

  apps: Record<string, GmScreenApp>;

  // used to allow players to switch tabs
  currentTab: string;

  draggedTab: HTMLElement | undefined;

  pendingCellRefresh: PendingCellRefresh | undefined;

  tabStripResizeObserver: ResizeObserver | undefined;

  leftToolbarObserver: ResizeObserver | undefined;

  constructor(options = {}) {
    super(options);
    this.expanded = false;
    this.data = getGame().settings.get(MODULE_ID, MySettings.gmScreenConfig);
    this.apps = {};
    this.currentTab = this.data.activeGridId;

    const columns = getGame().settings.get(MODULE_ID, MySettings.columns);
    const rows = getGame().settings.get(MODULE_ID, MySettings.rows);
    const displayDrawer = getGame().settings.get(MODULE_ID, MySettings.displayDrawer);

    const drawerOptions = {
      window: {
        ...this.options.window,
        resizable: false,
        frame: false,
      },
    };

    const gmButtons = [
      {
        action: ClickAction.clearGrid,
        label: getLocalization().localize(`${MODULE_ABBREV}.gmScreen.Reset`),
        class: 'clear',
        icon: 'fas fa-ban',
        onClick: () => this.handleClear.bind(this)(),
      },
    ];

    const popOutOptions = {
      classes: ['window-app', 'gm-screen-popOut'],
      width: Number(columns) * 400,
      height: Number(rows) * 300,
      window: {
        ...this.options.window,
        resizable: true,
        frame: true,
        controls: [
          ...this.options.window.controls,
          {
            action: ClickAction.refresh,
            label: getLocalization().localize(`${MODULE_ABBREV}.gmScreen.Refresh`),
            class: 'refresh',
            icon: 'fas fa-sync',
            onClick: () => this.refresh(),
          },
          ...(getGame().user?.isGM ? gmButtons : []),
        ],
      },
    };

    log(false, {
      displayDrawer,
      options: displayDrawer ? drawerOptions : popOutOptions,
    });

    this.options = {
      ...this.options,
      ...(displayDrawer ? drawerOptions : popOutOptions),
    };
  }

  static PARTS = {
    tabs: {
      template: TEMPLATES.screenTabs,
    },
    content: {
      template: TEMPLATES.screenContent,
    },
  };

  static DEFAULT_OPTIONS = {
    id: 'gm-screen-app',
  };

  get rows() {
    return getGame().settings.get(MODULE_ID, MySettings.rows);
  }

  get columns() {
    return getGame().settings.get(MODULE_ID, MySettings.columns);
  }

  get displayDrawer() {
    return getGame().settings.get(MODULE_ID, MySettings.displayDrawer);
  }

  get userViewableGrids() {
    return getUserViewableGrids(this.data);
  }

  get hasUserViewableGrids() {
    return !!Object.keys(this.userViewableGrids).length;
  }

  get title() {
    return !this.displayDrawer ? getLocalization().localize(`${MODULE_ABBREV}.gmScreen.Title`) : '';
  }

  get activeGrid() {
    return this.data.grids[this.data.activeGridId];
  }

  static getNumOccupiedCells(grid: GmScreenGrid) {
    return Object.values(grid.entries).reduce((acc, entry) => {
      const cellsTaken = (entry.spanCols || 1) * (entry.spanRows || 1);
      return acc + cellsTaken;
    }, 0);
  }

  getUpdatedGridData(newGridData: GmScreenGrid) {
    const newGmScreenConfig = foundry.utils.deepClone(this.data);
    const updated = foundry.utils.setProperty(newGmScreenConfig, `grids.${newGridData.id}`, newGridData);

    if (!updated) {
      log(true, 'error occurred trying to set a grid data');
      return undefined;
    }

    return newGmScreenConfig;
  }

  /**
   * Helper function to update the gmScreenConfig setting with a new grid's worth of data
   */
  async setGridData(newGridData: GmScreenGrid) {
    const newGmScreenConfig = this.getUpdatedGridData(newGridData);
    if (!newGmScreenConfig) {
      return;
    }

    // changing this setting will auto-refresh the screen
    await getGame().settings.set(MODULE_ID, MySettings.gmScreenConfig, newGmScreenConfig);
  }

  /**
   * Updates a grid and arranges for its changed cell to be refreshed when the setting update completes.
   */
  async setGridDataWithPendingCellRefresh(newGridData: GmScreenGrid, pendingCellRefresh?: PendingCellRefresh) {
    if (!pendingCellRefresh) {
      await this.setGridData(newGridData);
      return;
    }

    const newGmScreenConfig = this.getUpdatedGridData(newGridData);
    if (!newGmScreenConfig) {
      return;
    }

    this.pendingCellRefresh = {
      ...pendingCellRefresh,
      expectedData: foundry.utils.deepClone(newGmScreenConfig),
    };

    try {
      await getGame().settings.set(MODULE_ID, MySettings.gmScreenConfig, newGmScreenConfig);
    } catch (error) {
      this.pendingCellRefresh = undefined;
      throw error;
    }
  }

  /**
   * Adds an Entry to the proper place on the active grid's data.
   * Replaces an existing entry if the entryId matches
   */
  async addEntryToActiveGrid(newEntry: GmScreenGridEntry, cellId?: string) {
    const newEntries = { ...this.activeGrid.entries };

    newEntries[newEntry.entryId] = {
      ...newEntries[newEntry.entryId],
      ...newEntry,
    };

    const newGridData: GmScreenGrid = {
      ...this.activeGrid,
      entries: newEntries,
    };

    log(false, 'addEntryToActiveGrid', {
      activeGridData: this.activeGrid,
      newEntries,
      newEntry,
      newGridData,
    });

    await this.setGridDataWithPendingCellRefresh(
      newGridData,
      cellId
        ? {
            gridId: newGridData.id,
            entryId: newEntry.entryId,
            cellId,
          }
        : undefined
    );
  }

  /**
   * Remove a given entry from the Active Grid
   */
  async removeEntryFromActiveGrid(entryId: string, gridCellId?: string) {
    const clearedCell = foundry.utils.deepClone(this.activeGrid.entries[entryId]);
    const shouldKeepCellLayout = clearedCell.spanCols || clearedCell.spanRows;

    delete clearedCell.entityUuid;
    delete clearedCell.type;
    delete clearedCell.isDndNpc;
    delete clearedCell.isDndNpcStatBlock;
    delete clearedCell.imagePath;

    const newEntries = {
      ...this.activeGrid.entries,
    };

    if (shouldKeepCellLayout) {
      newEntries[entryId] = clearedCell;
    } else {
      delete newEntries[entryId];
    }

    if (gridCellId) {
      const appKey = `#${gridCellId}`;
      await this.apps[appKey]?.close();
      delete this.apps[appKey];
    }

    const newGridData: GmScreenGrid = {
      ...this.activeGrid,
      entries: newEntries,
    };

    await this.setGridDataWithPendingCellRefresh(
      newGridData,
      gridCellId
        ? {
            gridId: newGridData.id,
            entryId,
            cellId: gridCellId,
            entry: shouldKeepCellLayout
              ? clearedCell
              : {
                  x: clearedCell.x,
                  y: clearedCell.y,
                },
          }
        : undefined
    );
  }

  bringToFront() {
    if (!this.displayDrawer) {
      super.bringToFront();
      return;
    }
    if (this.position.zIndex === foundry.applications.api.ApplicationV2._maxZ) {
      return;
    }

    foundry.applications.api.ApplicationV2._maxZ += 1;
    this.setPosition({
      zIndex: foundry.applications.api.ApplicationV2._maxZ,
    });
  }

  /**
   * Set the GM Screen Visibility. By default will toggle the current state.
   */
  toggleGmScreenVisibility(expanded = !this.expanded) {
    const el = this.element;
    if (!(el instanceof HTMLElement)) {
      return;
    }

    this.expanded = expanded;

    if (this.expanded) {
      this.bringToFront();
      el.classList.add('expanded');
      el.style.setProperty('z-index', this.position.zIndex.toString());
    } else {
      el.classList.remove('expanded');
    }
  }

  /**
   * Double confirms Clearing the Active Grid
   */
  async handleClear() {
    log(false, 'handleClear');

    const proceed = await foundry.applications.api.DialogV2.confirm({
      title: getLocalization().localize(`${MODULE_ABBREV}.warnings.clearConfirm.Title`),
      content: getLocalization().localize(`${MODULE_ABBREV}.warnings.clearConfirm.Content`),
    });

    if (proceed) {
      this.apps = {};
      await this.setGridData({
        ...this.activeGrid,
        entries: {},
      });
    }
  }

  _dragStartTab(event: DragEvent) {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    this.draggedTab = event.target;
  }

  _dragOverTab(event: DragEvent) {
    if (!this.draggedTab || !(event.target instanceof HTMLElement)) {
      return;
    }

    // only ever drop next to another tab, inside a row of tabs
    const target = event.target.closest('.gm-screen-tabs > button');
    if (!(target instanceof HTMLElement) || target === this.draggedTab) {
      return;
    }

    // left half of the tab you're over = drop before it, right half = after it (works across rows too)
    const rect = target.getBoundingClientRect();
    if (event.clientX > rect.left + rect.width / 2) {
      if (target.nextElementSibling !== this.draggedTab) {
        target.after(this.draggedTab);
      }
    } else if (target.previousElementSibling !== this.draggedTab) {
      target.before(this.draggedTab);
    }
  }


  async _dragEndTab(event: DragEvent) {
    if (!this.draggedTab || !(event.target instanceof HTMLElement)) {
      return;
    }

    const newGmScreenConfig = foundry.utils.deepClone(this.data);
    newGmScreenConfig.grids = {};

    // walk every row, front row first, so tabs keep their order and pick up the row they were dropped in
    const rowIndex = (strip: HTMLElement) => TAB_ROWS.indexOf((strip.dataset.row as TabRow) ?? 'front');
    const strips = [...this.tabStrips].sort((a, b) => rowIndex(a) - rowIndex(b));

    strips.forEach((strip) => {
      Array.from(strip.children).forEach((item) => {
        if (!(item instanceof HTMLElement)) {
          return;
        }

        const gridId = item.dataset.tab;
        if (!gridId || !this.data.grids[gridId]) {
          return;
        }
        newGmScreenConfig.grids[gridId] = {
          ...this.data.grids[gridId],
          // the pop-out shows a single row, so only the drawer can move a tab between rows
          ...(this.displayDrawer && strip.dataset.row ? { tabRow: strip.dataset.row as TabRow } : {}),
        };
      });
    });

    // never drop a tab that wasn't on screen
    Object.keys(this.data.grids).forEach((gridId) => {
      if (!newGmScreenConfig.grids[gridId]) {
        newGmScreenConfig.grids[gridId] = this.data.grids[gridId];
      }
    });

    this.draggedTab = undefined;
    await getGame().settings.set(MODULE_ID, MySettings.gmScreenConfig, newGmScreenConfig);
  }


  async handleClickEvent(e: MouseEvent) {
    e.preventDefault();

    if (!(e.currentTarget instanceof HTMLElement)) {
      return;
    }

    const action = e.currentTarget.dataset.action as ClickAction;
    const entityUuidHtml = e.currentTarget.closest('[data-entity-uuid]');
    const entityUuid = entityUuidHtml instanceof HTMLElement ? entityUuidHtml.dataset.entityUuid : undefined;
    const entryIdHtml = e.currentTarget.closest('[data-entry-id]');
    const entryId = entryIdHtml instanceof HTMLElement ? entryIdHtml.dataset.entryId : undefined;
    const gridCellId = entryIdHtml instanceof HTMLElement ? entryIdHtml.id : undefined;

    log(false, 'handleClickEvent', {
      e,
      action,
    });

    switch (action) {
      case ClickAction.clearCell: {
        if (!entryId) {
          return;
        }

        await this.removeEntryFromActiveGrid(entryId, gridCellId);
        break;
      }
      case ClickAction.clearGrid: {
        await this.handleClear();
        break;
      }
      case ClickAction.configureCell: {
        try {
          if (!(e.target instanceof HTMLElement) || !(e.target.parentElement instanceof HTMLElement)) {
            return;
          }
          const { x, y } = getGridElementsPosition(e.target.parentElement);

          const cellToConfigure: GmScreenGridEntry = entryId
            ? this.activeGrid.entries[entryId]
            : {
                x,
                y,
                entryId: `${x}-${y}`,
              };

          log(false, 'configureCell cellToConfigure', cellToConfigure);

          const { newSpanRows, newSpanCols } = await getUserCellConfigurationInput(cellToConfigure, {
            rows: this.rows,
            columns: this.columns,
          });

          log(false, 'new span values from dialog', {
            newSpanRows,
            newSpanCols,
          });

          const newCell = {
            ...cellToConfigure,
            spanRows: newSpanRows,
            spanCols: newSpanCols,
          };

          const newEntries = {
            ...this.activeGrid.entries,
            [newCell.entryId]: newCell,
          };

          // based on the X, Y, and Span values of `newCell` find all problematic entryIds
          // BRITTLE if entryId's formula changes
          const problemCoordinates = [...Array(newCell.spanCols).keys()]
            .map((_, index) => {
              const problemX = newCell.x + index;

              return [...Array(newCell.spanRows).keys()].map((_k, i) => {
                const problemY = newCell.y + i;
                return `${problemX}-${problemY}`; // problem cell's id
              });
            })
            .flat();

          log(false, {
            problemCoordinates,
          });

          // get any overlapped cells and remove them
          Object.values(newEntries).forEach((entry) => {
            if (problemCoordinates.includes(entry.entryId) && entry.entryId !== newCell.entryId) {
              delete newEntries[entry.entryId];
            }
          });

          log(false, 'newEntries', newEntries);

          const newGridData = {
            ...this.activeGrid,
            entries: newEntries,
          };

          await this.setGridData(newGridData);
        } catch (error) {
          log(false, 'User exited configure cell Dialog.', error);
        }
        break;
      }
      case ClickAction.open: {
        if (!entityUuid || !entryId) {
          return;
        }
        const entry = this.activeGrid.entries[entryId];
        if (entry.type === 'Image') {
          if (!entry.imagePath) {
            return;
          }
          const ip = new foundry.applications.apps.ImagePopout({
            src: entry.imagePath,
            uuid: entityUuid,
            window: { title: entry.imagePath },
          });

          // Display the image popout
          ip.render({ force: true });
          return;
        }

        try {
          const relevantDocument = await this.getRelevantGmScreenDocument(entityUuid);
          const relevantDocumentSheet = relevantDocument?.sheet;
          log(false, 'trying to edit entity', { relevantEntitySheet: relevantDocumentSheet });

          if (!relevantDocumentSheet) {
            return;
          }

          // If the relevantEntitySheet is already rendered:
          if (relevantDocumentSheet.rendered) {
            relevantDocumentSheet.maximize();
            relevantDocumentSheet.bringToFront();
            return;
          }
          if (
            relevantDocument instanceof JournalEntryPage &&
            relevantDocument.type === 'image' &&
            relevantDocumentSheet instanceof foundry.applications.sheets.journal.JournalEntryPageImageSheet
          ) {
            const ip = new foundry.applications.apps.ImagePopout({
              src: relevantDocumentSheet.options.document.src,
              uuid: entityUuid,
              window: { title: relevantDocument.name },
            });

            // Display the image popout
            ip.render({ force: true });
            return;
          }
          // Otherwise render the relevantEntitySheet
          relevantDocumentSheet.render(true);
        } catch (error) {
          log(true, 'error opening entity sheet', error);
        }
        break;
      }
      case ClickAction.refresh: {
        this.refresh();
        break;
      }
      case ClickAction.tab: {
        const newActiveGridId = e.currentTarget.dataset.tab;
        this.currentTab = newActiveGridId ?? this.currentTab;
        // do nothing if we are not the GM or if nothing changes
        if (!getGame().user?.isGM || newActiveGridId === this.data.activeGridId || !newActiveGridId) {
          return;
        }

        log(false, 'trying to set active grid', { newActiveGridId });

        try {
          const newGmScreenConfig = {
            ...this.data,
            activeGridId: newActiveGridId,
          };

          await getGame().settings.set(MODULE_ID, MySettings.gmScreenConfig, newGmScreenConfig);
        } catch (error) {
          log(true, 'error setting active tab', error);
        }
        break;
      }
      case ClickAction.scrollTabsPrev: {
        this.scrollTabStrip(e.currentTarget, -1);
        break;
      }
      case ClickAction.scrollTabsNext: {
        this.scrollTabStrip(e.currentTarget, 1);
        break;
      }
      case ClickAction.toggleGmScreen: {
        try {
          this.toggleGmScreenVisibility();
        } catch (error) {
          log(true, 'error toggling GM Screen', error);
        }
        break;
      }
      case ClickAction.statBlock: {
        if (!gridCellId) {
          return;
        }
        if (!entryId) {
          return;
        }
        const newEntries = {
          ...this.activeGrid.entries,
        };
        newEntries[entryId].isDndNpcStatBlock = !newEntries[entryId].isDndNpcStatBlock;
        const newGridData: GmScreenGrid = {
          ...this.activeGrid,
          entries: newEntries,
        };

        await this.setGridData(newGridData);
        break;
      }
      case ClickAction.chooseImage: {
        const gridCell = e.currentTarget.closest('.gm-screen-grid-cell');
        if (!(gridCell instanceof HTMLElement)) {
          return;
        }

        const gridElementPosition = getGridElementsPosition(gridCell);
        const newEntryId = `${gridElementPosition.x}-${gridElementPosition.y}`;
        const fp = new foundry.applications.apps.FilePicker({
          type: 'image',
          callback: async (path) => {
            const newEntry: GmScreenGridEntry = {
              ...gridElementPosition,
              entryId: newEntryId,
              entityUuid: `Image.${foundry.utils.randomID()}`,
              type: 'Image',
              isDndNpc: false,
              isDndNpcStatBlock: false,
              imagePath: path,
            };

            await this.addEntryToActiveGrid(newEntry, gridCell.id);
          },
        });
        fp.render({ force: true });
        break;
      }
      default:
    }
  }

  async switchTab() {
    const tabs = Object.keys(this.userViewableGrids);
    if (tabs.length <= 1) {
      return;
    }

    const isGM = getGame().user?.isGM;
    const currentIndex = tabs.indexOf(isGM ? this.data.activeGridId : this.currentTab);
    const newIndex = (currentIndex + 1) % tabs.length;
    const newActiveGridId = tabs[newIndex];

    log(false, 'trying to set active grid', { newActiveGridId });

    try {
      this.changeTab(newActiveGridId, TAB_GROUP_NAME);
      this.currentTab = newActiveGridId;

      if (!isGM) {
        return;
      }

      const newGmScreenConfig = {
        ...this.data,
        activeGridId: newActiveGridId,
      };
      await getGame().settings.set(MODULE_ID, MySettings.gmScreenConfig, newGmScreenConfig);
    } catch (error) {
      log(true, 'error setting active tab', error);
    }
  }

  /**
   * @override
   * Keep the newly selected tab visible when the tab strip is scrolled.
   */
  changeTab(tab: string, group: string, options = {}) {
    super.changeTab(tab, group, options);
    if (group === TAB_GROUP_NAME) {
      this.scrollTabIntoView(tab);
    }
  }

  /** Every row of tabs (one in the pop-out, up to three in the drawer) */
  get tabStrips(): HTMLElement[] {
    return Array.from(this.element?.querySelectorAll('.gm-screen-tabs') ?? []).filter(
      (strip): strip is HTMLElement => strip instanceof HTMLElement
    );
  }

  /**
   * Scrolls one row of tabs by most of its visible width. direction: -1 = left, 1 = right
   */
  scrollTabStrip(arrow: HTMLElement, direction: -1 | 1) {
    const strip = arrow.closest('.gm-screen-tabs-scroller')?.querySelector('.gm-screen-tabs');
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    strip.scrollBy({ left: direction * Math.max(strip.clientWidth * 0.75, 100), behavior: 'smooth' });
  }

  scrollTabIntoView(tabId?: string) {
    const button = this.tabStrips
      .flatMap((strip) => Array.from(strip.querySelectorAll('button')))
      .find((btn) => (tabId ? btn.dataset.tab === tabId : btn.classList.contains('active')));
    const strip = button?.parentElement;
    if (!button || !strip || strip.scrollWidth <= strip.clientWidth) {
      return;
    }

    const padding = 24; // leave room so the fade on the edges doesn't cover the tab
    // .gm-screen-tabs is position: relative, so offsetLeft is measured from the strip itself
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < strip.scrollLeft + padding) {
      strip.scrollTo({ left: Math.max(left - padding, 0), behavior: 'smooth' });
    } else if (right > strip.scrollLeft + strip.clientWidth - padding) {
      strip.scrollTo({ left: right - strip.clientWidth + padding, behavior: 'smooth' });
    }
  }

  /**
   * Shows/hides the arrow buttons and edge fades depending on whether there is
   * anything hidden to the left or right of the visible tabs in a row.
   */
  updateTabStripOverflow(strip: HTMLElement) {
    const scroller = strip.closest('.gm-screen-tabs-scroller');
    if (!(scroller instanceof HTMLElement)) {
      return;
    }
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    // compare the tabs with the room the whole row has, not the strip's current width: the strip
    // shrinks when the arrows appear, which would otherwise keep the arrows showing for no reason
    const rowWidth = scroller.parentElement?.clientWidth ?? scroller.clientWidth;
    const rowRoom = rowWidth - (parseFloat(getComputedStyle(scroller).paddingLeft) || 0);
    const overflowing = strip.scrollWidth > rowRoom + 1;
    scroller.classList.toggle('is-overflowing', overflowing);
    scroller.classList.toggle('can-scroll-prev', overflowing && strip.scrollLeft > 1);
    scroller.classList.toggle('can-scroll-next', overflowing && strip.scrollLeft < maxScroll - 1);
  }

  updateAllTabStripOverflow() {
    this.tabStrips.forEach((strip) => this.updateTabStripOverflow(strip));
  }

  bindTabStrip() {
    const strips = this.tabStrips;
    this.tabStripResizeObserver?.disconnect();
    this.tabStripResizeObserver = new ResizeObserver(() => this.updateAllTabStripOverflow());

    strips.forEach((strip) => {
      // a vertical mouse wheel scrolls the tabs sideways
      strip.addEventListener(
        'wheel',
        (event: WheelEvent) => {
          if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            return;
          }
          event.preventDefault();
          strip.scrollBy({ left: event.deltaY });
        },
        { passive: false }
      );
      strip.addEventListener('scroll', () => this.updateTabStripOverflow(strip), { passive: true });
      this.tabStripResizeObserver?.observe(strip);
    });

    this.updateAllTabStripOverflow();
    // wait a frame so widths are final before scrolling the active tab into view
    requestAnimationFrame(() => {
      this.scrollTabIntoView();
      this.updateAllTabStripOverflow();
    });
  }

  /**
   * Drawer only: start the tab shelves just right of Foundry's left toolbar so the two never overlap.
   * The screen itself keeps its full width.
   */
  updateTabsLeftOffset() {
    if (!this.displayDrawer || !(this.element instanceof HTMLElement)) {
      return;
    }
    // measure the toolbar's visible buttons, not its container, which can be much wider than what you see
    const toolbar = document.getElementById('scene-controls');
    const buttonsRight = Array.from(toolbar?.querySelectorAll('button, a, li') ?? []).reduce((right, el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return right;
      }
      return Math.max(right, rect.right);
    }, 0);
    const drawerLeft = this.element.getBoundingClientRect().left;
    const offset = buttonsRight > 0 ? Math.max(0, Math.round(buttonsRight - drawerLeft + 6)) : 0;
    this.element.style.setProperty('--gm-screen-tabs-left-offset', `${offset}px`);
  }

  watchLeftToolbar() {
    if (!this.displayDrawer) {
      return;
    }
    this.updateTabsLeftOffset();

    if (!this.leftToolbarObserver) {
      this.leftToolbarObserver = new ResizeObserver(() => this.updateTabsLeftOffset());
      window.addEventListener('resize', () => this.updateTabsLeftOffset());
    }
    const toolbar = document.getElementById('scene-controls');
    this.leftToolbarObserver.disconnect();
    if (toolbar) {
      this.leftToolbarObserver.observe(toolbar);
    }
  }

  updateClassesAndFixButtons() {
    if (this.displayDrawer) {
      return;
    }

    const gmScreenApp = document.getElementById('gm-screen-app');
    if (!gmScreenApp) {
      return;
    }
    gmScreenApp?.classList.add('application');
    const header = gmScreenApp?.querySelector('.window-header');
    if (!header) {
      return;
    }
    gmScreenApp?.querySelector('.window-content')?.prepend(header);
  }

  async _renderFrame(options) {
    if (!this.displayDrawer) {
      return super._renderFrame(options);
    }

    const templateString = await foundry.applications.handlebars.renderTemplate(
      TEMPLATES.screen,
      await this._prepareContext(this.options)
    );
    const wrapper = document.createElement('div');
    wrapper.innerHTML = templateString;

    if (!(wrapper.children[0] instanceof HTMLElement)) {
      throw new Error('Failed to render GmScreenApplication frame template');
    }

    return wrapper.children[0];
  }

  /**
   * @override
   */
  render(...args) {
    if (!this.hasUserViewableGrids && this.rendered) {
      this.close();
    }

    return super.render(...args);
  }

  /**
   * Re-renders and replaces one grid while preserving the rest of the application.
   */
  async refreshGrid(gridId: string) {
    const previousGrid = Array.from(this.element.querySelectorAll('.gm-screen-container')).find(
      (grid) => grid instanceof HTMLElement && grid.dataset.tab === gridId
    );
    const grid = this.getHydratedGrids()[gridId];

    if (!(previousGrid instanceof HTMLElement) || !grid) {
      return false;
    }

    const context = await this._prepareContext(this.options);
    const renderedGrid = await foundry.applications.handlebars.renderTemplate(TEMPLATES.screenGrid, {
      ...context,
      ...grid,
    });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderedGrid;
    const replacementGrid = wrapper.firstElementChild;

    if (!(replacementGrid instanceof HTMLElement)) {
      return false;
    }

    previousGrid.replaceWith(replacementGrid);
    this.bindGridDragDrop(replacementGrid);
    this.addListeners(replacementGrid);
    this.injectCellContents(replacementGrid);
    this.updateGridCellWidths(replacementGrid);

    return true;
  }

  async refreshGridCell(gridId: string, entryId: string, cellId: string, fallbackEntry?: Partial<GmScreenGridEntry>) {
    const previousCell = document.getElementById(cellId);
    const entry = this.data.grids[gridId]?.entries[entryId] ?? fallbackEntry;

    if (!(previousCell instanceof HTMLElement) || !entry) {
      return false;
    }

    const context = await this._prepareContext(this.options);
    const renderedCell = await foundry.applications.handlebars.renderTemplate(TEMPLATES.screenCell, {
      ...context,
      ...entry,
      gridId,
    });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderedCell;
    const replacementCell = wrapper.firstElementChild;

    if (!(replacementCell instanceof HTMLElement)) {
      return false;
    }

    replacementCell.id = cellId;
    previousCell.replaceWith(replacementCell);
    this.bindDropToCell(replacementCell);
    this.addListeners(replacementCell);
    this.injectCellContents(replacementCell);
    replacementCell.style.setProperty('--this-cell-width', getComputedStyle(replacementCell).width);

    return true;
  }

  bindDropToCell(cell: HTMLElement) {
    cell.addEventListener('dragover', (event) => {
      if (getGame().user?.isGM) {
        event.preventDefault();
      }
    });
    cell.addEventListener('drop', this._onDrop.bind(this));
  }

  bindGridDragDrop(element: HTMLElement) {
    const dragDrop = new foundry.applications.ux.DragDrop({
      dragSelector: '.gm-screen-grid-cell',
      dropSelector: '.gm-screen-grid-cell',
      permissions: { dragstart: () => !!getGame().user?.isGM, drop: () => !!getGame().user?.isGM },
      callbacks: { drop: this._onDrop.bind(this) },
    });
    dragDrop.bind(element);
  }

  isExpectedPendingUpdate(newData: GmScreenConfig, pendingCellRefresh: PendingCellRefresh) {
    const { expectedData } = pendingCellRefresh;
    if (!expectedData) {
      return false;
    }

    return (
      Object.keys(foundry.utils.diffObject(expectedData, newData)).length === 0 &&
      Object.keys(foundry.utils.diffObject(newData, expectedData)).length === 0
    );
  }

  async refresh() {
    const newData = getGame().settings.get(MODULE_ID, MySettings.gmScreenConfig);
    const oldData = foundry.utils.deepClone(this.data);
    const diffData: Partial<GmScreenConfig> = foundry.utils.diffObject(oldData, newData);

    log(false, 'refreshing gm screen', {
      newData: foundry.utils.deepClone(newData),
      data: oldData,
      diffData,
    });

    this.data = newData;
    const { pendingCellRefresh } = this;
    this.pendingCellRefresh = undefined;

    if (
      pendingCellRefresh &&
      this.isExpectedPendingUpdate(newData, pendingCellRefresh) &&
      (await this.refreshGridCell(
        pendingCellRefresh.gridId,
        pendingCellRefresh.entryId,
        pendingCellRefresh.cellId,
        pendingCellRefresh.entry
      ))
    ) {
      log(false, 'refreshed only the changed cell', pendingCellRefresh);
      return;
    }

    // diffObject only reports added or changed keys, so check for deleted tabs (or a new order) separately
    const tabsAddedRemovedOrMoved = Object.keys(oldData.grids).join('|') !== Object.keys(newData.grids).join('|');

    if (Object.keys(diffData).length && !tabsAddedRemovedOrMoved) {
      if (
        Object.keys(diffData).every((key) => key === 'activeGridId') ||
        Object.values(diffData.grids || {}).every((grid) => Object.keys(grid).every((key) => key === 'cssClass'))
      ) {
        log(false, 'not rerendering because only activeGridId changed or cssClass changed');
        return;
      }

      const diffGridIds = Object.keys(diffData?.grids ?? {});
      const myNewGridIds = Object.keys(this.userViewableGrids);
      const myOldGridIds = Object.keys(getUserViewableGrids(oldData));

      // 1. check if the gridIds in diffData have no overlap with the gridIds I can currently see

      const diffOverlapsNewGridIds = !diffGridIds.filter((gridId) => myNewGridIds.includes(gridId)).length;
      // expect this to be false if there is overlap;

      // 2. check if the gridIds I can currently see are the same as before the diff

      const oldAndNewGridIdsAreEqual =
        myNewGridIds.length === myOldGridIds.length && myNewGridIds.every((gridId) => myOldGridIds.includes(gridId));
      // expect this to be true if same

      // 3. IF 1 AND 2; don't rerender

      const shouldNotRerender = diffOverlapsNewGridIds && oldAndNewGridIdsAreEqual;

      log(false, 'gridIdChecks', {
        diffGridIds,
        myOldGridIds,
        myNewGridIds,
        diffOverlapsNewGridIds,
        oldAndNewGridIdsAreEqual,
        shouldNotRerender,
      });

      if (shouldNotRerender) {
        log(false, 'not rerendering because none of my visible grids changed');
        return;
      }

      const changedGridIsEntriesOnly =
        diffGridIds.length === 1 &&
        Object.keys(diffData.grids?.[diffGridIds[0]] ?? {}).every((key) => key === 'entries' || key === 'cssClass');

      if (changedGridIsEntriesOnly && oldAndNewGridIdsAreEqual && (await this.refreshGrid(diffGridIds[0]))) {
        log(false, 'refreshed only the grid with changed entries', { gridId: diffGridIds[0] });
        return;
      }
    }

    if (!this.displayDrawer) {
      await this.close();
    }

    this.render(true);
  }

  async _onRender() {
    this.bindGridDragDrop(this.element);

    const dragDropTabs = new foundry.applications.ux.DragDrop({
      dragSelector: '.gm-screen-tabs button',
      dropSelector: '.gm-screen-tabs button',
      permissions: { dragstart: () => !!getGame().user?.isGM, drop: () => !!getGame().user?.isGM },
      callbacks: {
        dragstart: this._dragStartTab.bind(this),
        dragover: this._dragOverTab.bind(this),
        dragend: this._dragEndTab.bind(this),
      },
    });
    dragDropTabs.bind(this.element);

    this.addListeners();
    this.watchLeftToolbar();
    this.bindTabStrip();

    if (this.displayDrawer) {
      this.setPosition({
        left: NaN,
        top: NaN,
      });
    } else {
      this.setPosition({
        width: Number(this.columns) * 400,
        height: Number(this.rows) * 300,
      });
    }

    // stop here if there are no user viewable grids
    if (!this.hasUserViewableGrids) {
      return;
    }

    this.injectCellContents();
    this.updateClassesAndFixButtons();

    this.updateGridCellWidths();
  }

  updateGridCellWidths(element: HTMLElement = this.element) {
    const vanillaGridElement = this.element.querySelector('.gm-screen-grid');
    if (!vanillaGridElement) {
      return;
    }

    const vanillaGridElementStyles = getComputedStyle(vanillaGridElement);
    const colWidth = vanillaGridElementStyles['grid-template-columns'].split(' ')[0];

    element.querySelectorAll('.gm-screen-grid').forEach((gridElement) => {
      if (gridElement instanceof HTMLElement) {
        gridElement.style.setProperty('--grid-cell-width', colWidth);
      }
    });
  }

  addListeners(element: HTMLElement = this.element) {
    element.querySelectorAll('.gm-screen-actions button, .gm-screen-grid-cell-header a').forEach((btn) => {
      btn.addEventListener('click', this.handleClickEvent.bind(this));
    });

    element.querySelector('.gm-screen-button')?.addEventListener('contextmenu', async () => {
      if (!getGame().user?.isGM) {
        return;
      }

      const config = new GmScreenSettings({});
      await config.render({ force: true });
    });
  }

  /**
   * Utility method to help typescript understand that these are only
   * actors, items, journals, or rolltables
   *
   */
  async getRelevantGmScreenDocument(
    entityUuid
  ): Promise<Actor | Item | JournalEntry | RollTable | JournalEntryPage | undefined> {
    const relevantDocument = await fromUuid(entityUuid);

    if (
      !(
        relevantDocument instanceof Actor ||
        relevantDocument instanceof Item ||
        relevantDocument instanceof JournalEntry ||
        relevantDocument instanceof RollTable ||
        relevantDocument instanceof JournalEntryPage
      )
    ) {
      return undefined;
    }

    return relevantDocument;
  }

  /**
   * create and cache the custom Application when we need to during GmScreenApplication.render();
   * and then use that cached Application instance to render
   *
   */
  async getCellApplicationClass(
    entityUuid: string,
    cellId: string,
    dndNpc: boolean,
    dndNpcStatBlock: boolean
  ): Promise<GmScreenApp | undefined> {
    const relevantDocument = await this.getRelevantGmScreenDocument(entityUuid);
    // Foundry keeps one window per id, so ids include the cell: the same document can then sit in
    // several cells (or tabs) at once without them stealing each other's content
    const cellKey = cellId.replace('#', '');

    if (!relevantDocument) {
      await this.apps[cellId]?.close();
      delete this.apps[cellId];

      // eslint-disable-next-line no-console
      console.warn('One of the grid cells tried to render an entity that does not exist.', entityUuid);
      return undefined;
    }

    /* If there is an old app here which isn't this entity's, destroy it */
    if (this.apps[cellId] && this.apps[cellId]?.document.uuid !== entityUuid) {
      await this.apps[cellId].close();
      delete this.apps[cellId];
    }

    const { sheet } = relevantDocument;
    const SheetClass = sheet?.constructor;

    /* If the currently cached sheet class does not match the sheet class, destroy it */
    if (this.apps[cellId] && this.apps[cellId].constructor.name !== SheetClass?.name) {
      await this.apps[cellId].close();
      delete this.apps[cellId];
    }

    /* If the currently cached sheet class does match the sheet class, return it */
    if (this.apps[cellId] && this.apps[cellId].constructor.name === SheetClass?.name) {
      // when dealing with DnD5e NPC stat blocks, we need to make sure we re-create the sheet if the user toggled the stat block option
      if (!dndNpc || this.apps[cellId].id.includes(dndNpcStatBlock ? 'gmscreen-npc-' : 'gmscreen-actor-')) {
        log(false, `using cached application instance for "${relevantDocument.name}"`, {
          entityUuid,
          app: this.apps[cellId],
        });

        return this.apps[cellId];
      }
    }

    log(false, 'relevantEntity sheet', {
      sheet,
      name: SheetClass?.name,
    });

    if (!SheetClass) {
      log(true, 'no sheet class found for relevantDocument', {
        relevantDocument,
        entityUuid,
      });
      return undefined;
    }

    switch (true) {
      case relevantDocument instanceof JournalEntry:
        log(false, `creating compact journal entry for "${relevantDocument.name}"`, {
          cellId,
        });

        if (sheet instanceof foundry.applications.sheets.journal.JournalEntrySheet) {
          this.apps[cellId] = new CompactJournalEntryDisplay({
            document: relevantDocument,
            editable: false,
            cellId,
            id: `gmscreen-journal-${relevantDocument.id}-${cellKey}`,
            window: {
              ...sheet.options.window,
              positioned: false,
              resizable: false,
            },
          });
          return this.apps[cellId];
        }

        this.apps[cellId] = new CompactJournalEntryDisplay({
          document: relevantDocument,
          editable: false,
          cellId,
          id: `gmscreen-journal-${relevantDocument.id}-${cellKey}`,
          window: {
            positioned: false,
            resizable: false,
          },
        });
        break;

      // a single text page: show its journal locked to that page, so it looks and behaves like a journal cell
      case relevantDocument instanceof JournalEntryPage &&
        relevantDocument.type === 'text' &&
        relevantDocument.parent instanceof JournalEntry:
        log(false, `creating compact journal locked to page "${relevantDocument.name}"`, { cellId });

        this.apps[cellId] = new CompactJournalEntryDisplay({
          document: relevantDocument.parent,
          editable: false,
          cellId,
          lockedPageId: relevantDocument.id,
          id: `gmscreen-journal-${relevantDocument.parent.id}-page-${relevantDocument.id}-${cellKey}`,
          window: {
            positioned: false,
            resizable: false,
          },
        });
        break;

      // special case when the sheet is a journal text page. We need to use the SheetClass to resolve UUID links
      case sheet instanceof foundry.applications.sheets.journal.JournalEntryPageProseMirrorSheet &&
        relevantDocument instanceof JournalEntryPage &&
        sheet.options.document.type === 'text':
        log(false, `creating compact JournalEntryPage for "${relevantDocument.name}"`, {
          cellId,
        });

        // eslint-disable-next-line no-case-declarations
        const TextDocumentSheet: foundry.applications.sheets.journal.JournalEntryPageProseMirrorSheet & CustomOptions =
          new (SheetClass as JournalEntryPageProseMirrorSheetConstructor)({
            ...sheet.options,
            mode: 'view',
            id: `gmscreen-text-${sheet.document.id}-${cellKey}`,
            // needed to show the journal page with styles
            classes: ['application', 'sheet', 'journal-sheet', 'journal-entry', 'maximizing'],
            document: relevantDocument,
            window: {
              ...sheet.options.window,
              frame: false,
              positioned: false,
              resizable: false,
            },
          });

        TextDocumentSheet._postRender = async function internalPostRender() {
          this.cellId = cellId;

          const cell = document.getElementById(this.cellId.replace('#', ''));
          if (!cell) {
            return;
          }
          const titleElement = cell.querySelector('.gm-screen-grid-cell-title');
          if (titleElement) {
            titleElement.textContent = this.options.document.name;
          }

          const gridCellContent = cell.querySelector('.gm-screen-grid-cell-content');
          if (!gridCellContent) {
            return;
          }

          gridCellContent.classList.remove(...gridCellContent.classList);
          gridCellContent.classList.add('gm-screen-grid-cell-content');

          gridCellContent.replaceChildren(this.form);

          const wrapper = document.createElement('section');
          wrapper.classList.add('journal-entry-content', 'journal-entry-page', 'overflow-y');

          wrapper.replaceChildren(...gridCellContent.children[0].childNodes);

          gridCellContent.children[0].replaceChildren(wrapper);

          gridCellContent.querySelector('.window-header')?.remove();
        };

        TextDocumentSheet.close = emptyClose;

        this.apps[cellId] = TextDocumentSheet;
        break;

      case relevantDocument instanceof JournalEntryPage:
        log(false, `creating compact JournalEntryPage for "${relevantDocument.name}"`, {
          cellId,
        });

        this.apps[cellId] = new CompactJournalEntryPageDisplay({
          document: relevantDocument,
          id: `gmscreen-journalentrypage-${relevantDocument.id}-${cellKey}`,
          cellId,
        });
        break;

      case relevantDocument instanceof RollTable:
        log(false, `creating compact rollTableDisplay for "${relevantDocument.name}"`, {
          cellId,
        });

        this.apps[cellId] = new CompactRollTableDisplay({
          document: relevantDocument,
          id: `gmscreen-rolltable-${relevantDocument.id}-${cellKey}`,
          cellId,
        });
        break;

      case sheet instanceof foundry.applications.sheets.ActorSheetV2 && relevantDocument instanceof Actor:
        log(false, `creating ActorSheetV2 for "${relevantDocument.name}"`, {
          cellId,
        });

        // eslint-disable-next-line no-case-declarations
        const ActorDocumentSheet: foundry.applications.sheets.ActorSheetV2 & CustomOptions =
          new (SheetClass as ActorV2Constructor)({
            ...sheet.options,
            id: dndNpcStatBlock
              ? `gmscreen-npc-${sheet.document.id}-${cellKey}`
              : `gmscreen-actor-${sheet.document.id}-${cellKey}`,
            classes: [],
            document: relevantDocument,
            window: {
              ...sheet.options.window,
              frame: true,
              positioned: false,
              resizable: isActorOrItemResizable(relevantDocument.constructor.name),
            },
          });

        ActorDocumentSheet._postRender = async function postRender() {
          this.cellId = cellId;

          const cell = document.getElementById(this.cellId.replace('#', ''));
          if (!cell) {
            return;
          }
          const titleElement = cell.querySelector('.gm-screen-grid-cell-title');
          if (titleElement) {
            titleElement.textContent = this.title;
          }

          const gridCellContent = cell.querySelector('.gm-screen-grid-cell-content');
          if (!gridCellContent) {
            return;
          }
          gridCellContent.classList.remove(...gridCellContent.classList);
          gridCellContent.classList.add('gm-screen-grid-cell-content');
          gridCellContent.replaceChildren(this.form);

          if (!dndNpcStatBlock) {
            const header = gridCellContent.querySelector('.window-header');
            if (header instanceof HTMLElement) {
              header.style.visibility = 'hidden';
            }
            return;
          }

          gridCellContent.classList.add('dnd5e2');

          const pureHTML =
            (await relevantDocument.toEmbed({
              label: '',
              values: ['statblock'],
              inline: false,
              cite: true,
              caption: false,
              captionPosition: 'bottom',
            })) || this.form;
          const wrapper = document.createElement('div');
          wrapper.classList.add('dnd5e2-journal', 'journal-entry-content', 'journal-page-content');
          wrapper.appendChild(pureHTML);
          gridCellContent.replaceChildren(wrapper);
        };
        ActorDocumentSheet.close = emptyClose;

        this.apps[cellId] = ActorDocumentSheet;
        break;

      case sheet instanceof foundry.applications.api.DocumentSheetV2 && relevantDocument instanceof Item:
        log(false, `creating ItemSheetV2 for "${relevantDocument.name}"`, {
          cellId,
        });

        // eslint-disable-next-line no-case-declarations
        const ItemDocumentSheet: foundry.applications.sheets.ItemSheetV2 & CustomOptions =
          new (SheetClass as ItemV2Constructor)({
            ...sheet.options,
            id: `gmscreen-item-${sheet.document.id}-${cellKey}`,
            document: relevantDocument,
            window: {
              ...sheet.options.window,
              frame: true,
              positioned: false,
              resizable: false,
            },
          });

        ItemDocumentSheet._postRender = postRenderV2(cellId);
        ItemDocumentSheet.close = emptyClose;

        this.apps[cellId] = ItemDocumentSheet;
        break;

      default:
        log(false, `creating compact generic for "${relevantDocument.name}"`, {
          cellId,
        });

        // eslint-disable-next-line no-case-declarations
        const CompactDocumentSheet: (ItemSheet & CustomOptions) | (ActorSheet & CustomOptions) =
          new (SheetClass as ItemAndActorV1Constructor)(relevantDocument, {
            ...sheet.options,
            width: '100%',
            height: '100%',
            positioned: false,
            resizable: isActorOrItemResizable(relevantDocument.constructor.name),
          });

        CompactDocumentSheet.options.id = `gmscreen-compact-${relevantDocument.id}`;
        CompactDocumentSheet.options.editable = false;
        CompactDocumentSheet.options.popOut = false;
        CompactDocumentSheet.cellId = cellId;

        CompactDocumentSheet._injectHTML = function injectHTML(html) {
          const cell = document.getElementById(this.cellId.replace('#', ''));
          if (!cell) {
            return;
          }
          const titleElement = cell.querySelector('.gm-screen-grid-cell-title');
          if (titleElement) {
            titleElement.textContent = this.title;
          }

          const gridCellContent = cell.querySelector('.gm-screen-grid-cell-content');
          if (!gridCellContent) {
            return;
          }

          const pureHTML = html.get(0);
          if (!pureHTML) {
            return;
          }

          log(false, 'CompactEntitySheet overwritten _injectHTML', {
            targetElement: gridCellContent,
            gridCellContent,
            cellId: this.cellId,
            pureHTML,
          });

          const wrapper = document.createElement('section');
          wrapper.classList.add('window-content');
          wrapper.appendChild(pureHTML);
          gridCellContent.replaceChildren(wrapper);
          this._element = html;
        };

        CompactDocumentSheet._replaceHTML = function replaceHTML(element, html) {
          const cell = document.getElementById(this.cellId.replace('#', ''));
          if (!cell) {
            return;
          }
          const titleElement = cell.querySelector('.gm-screen-grid-cell-title');
          if (titleElement) {
            titleElement.textContent = this.title;
          }

          const gridCellContent = cell.querySelector('.gm-screen-grid-cell-content');
          if (!gridCellContent) {
            return;
          }

          const pureHTML = html.get(0);
          if (!pureHTML) {
            return;
          }

          const wrapper = document.createElement('section');
          wrapper.classList.add('window-content');
          wrapper.appendChild(pureHTML);
          gridCellContent.replaceChildren(wrapper);
          this._element = html;
        };

        log(false, `created compact generic for "${relevantDocument.name}"`, {
          sheet: CompactDocumentSheet,
        });

        this.apps[cellId] = CompactDocumentSheet;
    }

    return this.apps[cellId];
  }

  injectCellContents(element: HTMLElement = this.element) {
    const gridEntries = element.matches('[data-entity-uuid]')
      ? [element, ...element.querySelectorAll('[data-entity-uuid]')]
      : element.querySelectorAll('[data-entity-uuid]');

    gridEntries.forEach((gridEntry) => {
      try {
        if (!(gridEntry instanceof HTMLElement)) {
          return;
        }
        // `this` is the parent .gm-screen-grid-cell
        const relevantUuid = gridEntry.dataset.entityUuid;
        if (!relevantUuid) {
          return;
        }
        const cellId = `#${gridEntry.id}`;
        const { entryId, dndNpc, dndNpcStatBlock, imagePath } = gridEntry.dataset;

        log(false, 'gridEntry with uuid defined found', { relevantUuid, cellId, gridEntry, imagePath });
        if (imagePath) {
          // we will show the image directly in the cell; no application needed
          return;
        }

        this.getCellApplicationClass(relevantUuid, cellId, dndNpc === 'true', dndNpcStatBlock === 'true')
          .then(async (application) => {
            log(false, `got application for "${cellId}"`, {
              application,
            });

            if (!application) {
              if (entryId) {
                // remove old applications that can't be rendered
                await this.removeEntryFromActiveGrid(entryId, cellId.replace('#', ''));
              }

              throw new Error('no application exists to render');
            }

            const gridCellContent = gridEntry.querySelector('.gm-screen-grid-cell-content');
            if (application.options.classes.length > 0) {
              gridCellContent?.classList.add(...application.options.classes);
            }

            if (application instanceof CompactJournalEntryDisplay && application.lockedPageId) {
              application.renderLockedPage();
              return;
            }

            if (application instanceof CompactJournalEntryDisplay) {
              const container = gridEntry.closest('.gm-screen-container');
              const gridId = container instanceof HTMLElement ? container.dataset.tab : undefined;
              const viewMode = this.getJournalViewMode(gridId);
              // only push the mode when it changed so a quick toggle in the cell isn't undone by every refresh
              if (application.renderWithViewMode(viewMode)) {
                return;
              }
            }

            application.render(true);
          })
          .catch((e) => {
            log(true, 'error trying to render a gridEntry', {
              gridEntry,
              cellId,
              relevantUuid,
              error: e,
            });
          });
      } catch (e) {
        log(false, 'erroring', e, {
          gridEntry,
        });
      }
    });

    // set some CSS Variables for child element use
    updateCSSPropertyVariable(element, '.gm-screen-grid-cell', 'width', '--this-cell-width');
  }

  /**
   * Which journal view a tab should use: the tab's own choice from the Tabs Config,
   * otherwise this client's default setting (which Force Client Settings can lock).
   * undefined means leave it to Foundry.
   */
  getJournalViewMode(gridId?: string): JournalViewMode | undefined {
    const tabMode = gridId ? this.data.grids[gridId]?.journalViewMode : undefined;
    if (tabMode && JOURNAL_VIEW_MODES.includes(tabMode)) {
      return tabMode;
    }
    const clientMode = getGame().settings.get(MODULE_ID, MySettings.journalViewMode);
    return JOURNAL_VIEW_MODES.find((mode) => mode === clientMode);
  }

  /**
   * All grids with entries hydrated with empty cells
   */
  getHydratedGrids() {
    log(false, 'getHydratedGrids', {
      userViewableGrids: this.userViewableGrids,
    });

    return Object.values(this.userViewableGrids).reduce<
      Record<string, { grid: GmScreenGrid; gridEntries: Partial<GmScreenGridEntry>[] }>
    >((acc, grid: GmScreenGrid) => {
      const gridColumns = grid.columnOverride ?? this.columns;
      const gridRows = grid.rowOverride ?? this.rows;

      const emptyCellsNum = Number(gridColumns) * Number(gridRows) - GmScreenApplication.getNumOccupiedCells(grid);
      const emptyCells: Partial<GmScreenGridEntry>[] =
        emptyCellsNum > 0 ? Array.from({ length: emptyCellsNum }).map(() => ({})) : [];

      acc[grid.id] = {
        grid,
        gridEntries: [...Object.values(grid.entries), ...emptyCells],
      };

      return acc;
    }, {});
  }

  /**
   * @override
   */
  async _prepareContext(options) {
    const rightMargin = getGame().settings.get(MODULE_ID, MySettings.rightMargin);
    const drawerWidth = getGame().settings.get(MODULE_ID, MySettings.drawerWidth);
    const drawerHeight = getGame().settings.get(MODULE_ID, MySettings.drawerHeight);
    const drawerOpacity = getGame().settings.get(MODULE_ID, MySettings.drawerOpacity);
    const condensedButton = getGame().settings.get(MODULE_ID, MySettings.condensedButton);
    const tabOverflow = getGame().settings.get(MODULE_ID, MySettings.tabOverflow) === 'wrap' ? 'wrap' : 'scroll';

    const grids = this.getHydratedGrids();

    const currentIndex = Object.keys(grids).indexOf(this.data.activeGridId);
    this.tabGroups[TAB_GROUP_NAME] = currentIndex !== -1 ? this.data.activeGridId : Object.keys(grids)[0];
    Object.keys(grids).forEach((gridId) => {
      grids[gridId].grid.cssClass = this.tabGroups[TAB_GROUP_NAME] === grids[gridId].grid.id ? 'active' : '';
    });

    const newAppData = foundry.utils.mergeObject(options, {
      grids,
      isGM: !!getGame().user?.isGM,
      condensedButton,
      tabOverflow,
      tabColors: TAB_COLORS,
      data: this.data,
      columns: this.columns,
      rows: this.rows,
      drawerWidth,
      drawerHeight,
      rightMargin,
      drawerOpacity,
      expanded: this.expanded,
      hidden: !this.hasUserViewableGrids,
      displayDrawer: this.displayDrawer,
      darkThemeUI: getGame().settings.get('core', 'uiConfig')?.colorScheme?.interface === 'dark',
      darkThemeApps: getGame().settings.get('core', 'uiConfig')?.colorScheme?.applications === 'dark',
    });

    newAppData.tabs = Object.keys(grids).map((id) => ({
      id: grids[id].grid.id,
      group: TAB_GROUP_NAME,
      label: grids[id].grid.name,
      cssClass: grids[id].grid.cssClass,
      color: grids[id].grid.tabColor ? TAB_COLORS[grids[id].grid.tabColor] : undefined,
      row: this.displayDrawer && TAB_ROWS.includes(grids[id].grid.tabRow as TabRow) ? grids[id].grid.tabRow : 'front',
    }));

    // back row first so it renders on top; empty rows (e.g. a player with no shared tabs there) are skipped
    newAppData.tabRows = [...TAB_ROWS]
      .reverse()
      .map((row) => ({ id: row, tabs: newAppData.tabs.filter((tab) => tab.row === row) }))
      .filter((row) => row.tabs.length > 0);

    log(false, '_prepareContext', {
      data: this.data,
      newAppData,
    });

    return newAppData;
  }

  async _onDrop(event: DragEvent) {
    event.stopPropagation();

    // do nothing if this user is not the gm
    if (!getGame().user?.isGM) return;

    // Try to extract the data
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event) as {
      type: 'JournalEntry' | 'JournalEntryPage' | 'RollTable' | 'Item' | 'Actor';
      uuid: string;
      pack?: string;
    } | null;
    if (!data) return;

    if (!event.currentTarget || !event.target) {
      return;
    }

    log(false, 'onDrop', {
      event,
      data,
      closestGridCell:
        event.currentTarget instanceof HTMLElement ? event.currentTarget.closest('.gm-screen-grid-cell') : null,
    });

    if (!['JournalEntry', 'JournalEntryPage', 'RollTable', 'Item', 'Actor'].includes(data.type)) {
      return;
    }

    const entityUuid = data.pack ? `Compendium.${data.pack}.${data.uuid}` : data.uuid;

    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    const gridCell = event.target.closest('.gm-screen-grid-cell');
    if (!(gridCell instanceof HTMLElement)) {
      return;
    }

    const gridElementPosition = getGridElementsPosition(gridCell);
    const newEntryId = `${gridElementPosition.x}-${gridElementPosition.y}`;

    const relevantDocument = await this.getRelevantGmScreenDocument(entityUuid);

    const newEntry: GmScreenGridEntry = {
      ...gridElementPosition,
      entryId: newEntryId,
      entityUuid,
      type: data.type,
      isDndNpc:
        relevantDocument instanceof Actor &&
        getGame().system.id === 'dnd5e' &&
        relevantDocument?.sheet?.constructor.name === 'NPCActorSheet',
      isDndNpcStatBlock: false,
    };

    await this.addEntryToActiveGrid(newEntry, gridCell.id);
  }
}
