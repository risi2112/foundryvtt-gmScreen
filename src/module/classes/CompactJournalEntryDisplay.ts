import { JournalViewMode } from '../constants';

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

  constructor(options) {
    super(options);
    this.cellId = options.cellId;
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
      titleElement.textContent = this.title;
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
    }

    if (!this._initialRenderDone) {
      this._initialRenderDone = true;
      // incomplete type definitions
      this.toggleSidebar();
    }
  }

  /** @override */
  get id() {
    return `gmscreen-journal-${this.document.id}`;
  }

  async close(...args) {
    if (args.length === 0) {
      return super.close(...args);
    }
    // prevent closing if esc is pressed
    return Promise.resolve(this);
  }
}
