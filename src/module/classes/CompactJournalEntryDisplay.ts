import { getGame, getLocalization } from '../helpers';
import { JournalViewMode, MODULE_ABBREV } from '../constants';

export class CompactJournalEntryDisplay extends foundry.applications.sheets.journal.JournalEntrySheet {
  cellId: string;

  _initialRenderDone?: boolean;

  /** The view mode the GM Screen last pushed to this sheet (undefined = Foundry's own default) */
  appliedViewMode?: JournalViewMode;

  static toFoundryViewMode(mode?: JournalViewMode) {
    const { VIEW_MODES } = foundry.applications.sheets.journal.JournalEntrySheet;
    if (mode === 'single') {
      return VIEW_MODES.SINGLE;
    }
    if (mode === 'multiple') {
      return VIEW_MODES.MULTIPLE;
    }
    return undefined;
  }

  /**
   * Renders with the given view mode if it differs from the one last applied.
   * Returns false (and does nothing) when the mode is unchanged.
   */
  renderWithViewMode(mode?: JournalViewMode) {
    if (mode === this.appliedViewMode) {
      return false;
    }
    this.appliedViewMode = mode;
    this.render({ force: true, mode: CompactJournalEntryDisplay.toFoundryViewMode(mode) });
    return true;
  }

  /** Set when a single page was dropped on the cell: the journal is shown locked to that page */
  lockedPageId?: string;

  constructor(options) {
    super(options);
    this.cellId = options.cellId;
    this.lockedPageId = options.lockedPageId;
  }

  get lockedPage() {
    return this.lockedPageId ? this.document.pages.get(this.lockedPageId) : undefined;
  }

  /** Shows only the dropped page, in single page view */
  renderLockedPage() {
    const renderOptions = {
      force: true,
      mode: foundry.applications.sheets.journal.JournalEntrySheet.VIEW_MODES.SINGLE,
      pageId: this.lockedPageId,
    };
    this.render(renderOptions);
  }

  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  get isEditable() {
    return false;
  }

  _replaceHTML(element, html, options) {
    super._replaceHTML(element, html, options);
    if (!this.form) {
      return;
    }

    const cell = document.getElementById(this.cellId.replace('#', ''));
    if (!cell) {
      return;
    }
    const titleElement = cell.querySelector('.gm-screen-grid-cell-title');
    if (titleElement) {
      titleElement.textContent = this.lockedPage?.name ?? this.title;
    }

    const gridCellContent = cell.querySelector('.gm-screen-grid-cell-content');
    if (gridCellContent) {
      // a pop-out journal remembers a fixed window size; inside a cell it has to follow the cell instead
      ['width', 'height', 'min-width', 'max-width', 'left', 'top'].forEach((property) =>
        this.form?.style.removeProperty(property)
      );
      gridCellContent.replaceChildren(this.form);
      const windowHeader = gridCellContent.querySelector('.window-header');
      if (windowHeader) {
        windowHeader.remove();
      }
      gridCellContent.classList.remove(...gridCellContent.classList);
      gridCellContent.classList.add('gm-screen-grid-cell-content');

      // in single page view the journal sidebar is hidden (see the stylesheet) to give the page more room,
      // so the page arrows move up into the cell's title bar instead
      const isSinglePage = this.mode === foundry.applications.sheets.journal.JournalEntrySheet.VIEW_MODES.SINGLE;
      gridCellContent.classList.toggle('gm-journal-single-page', isSinglePage);
      this.updateHeaderPageNav(cell, isSinglePage);
    }

    if (!this._initialRenderDone) {
      this._initialRenderDone = true;
      // incomplete type definitions
      this.toggleSidebar();
    }
  }

  get visiblePageCount() {
    const { user } = getGame();
    return this.document.pages.filter((page) => !user || page.testUserPermission(user, 'OBSERVER')).length;
  }

  /**
   * Adds ‹ › buttons next to the cell title when a single page journal has more than one page.
   * They press the journal's own (hidden) previous/next page buttons.
   */
  updateHeaderPageNav(cell: HTMLElement, isSinglePage: boolean) {
    const header = cell.querySelector('.gm-screen-grid-cell-header');
    header?.querySelector('.gm-journal-page-nav')?.remove();
    if (!header || !isSinglePage || this.lockedPageId || this.visiblePageCount < 2) {
      return;
    }

    const nav = document.createElement('span');
    nav.classList.add('gm-journal-page-nav');
    [
      { action: 'previousPage', icon: 'fa-chevron-left', label: 'PreviousPage' },
      { action: 'nextPage', icon: 'fa-chevron-right', label: 'NextPage' },
    ].forEach(({ action, icon, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tooltip = getLocalization().localize(`${MODULE_ABBREV}.journalView.${label}`);
      button.innerHTML = `<i class="fas ${icon}"></i>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const sheetButton = (this.form ?? this.element)?.querySelector(`[data-action="${action}"]`);
        if (sheetButton instanceof HTMLElement) {
          sheetButton.click();
        }
      });
      nav.append(button);
    });

    const title = header.querySelector('.gm-screen-grid-cell-title');
    if (title) {
      title.after(nav);
    } else {
      header.append(nav);
    }
  }

  /** @override */
  get id() {
    return this.lockedPageId
      ? `gmscreen-journal-${this.document.id}-page-${this.lockedPageId}`
      : `gmscreen-journal-${this.document.id}`;
  }

  async close(...args) {
    if (args.length === 0) {
      return super.close(...args);
    }
    // prevent closing if esc is pressed
    return Promise.resolve(this);
  }
}
