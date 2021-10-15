import { TypedEmitter } from "tiny-typed-emitter";
import { IBPasteAction, IBCutAction, IBClipboardData, isIBClipboardData, IBMoveInSlotAction, IBMoveBetweenSlotsAction } from "./action";
import { BlockHandler, BlockInfo } from "./BlockHandler";
import { DraggingContext } from "./DraggingContext";
import { find, head } from "./itertools";
import { SlotHandler, SlotInfo } from "./SlotHandler";

interface WithModifierKeys {
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface BlockContextEvents {
  activeElementChanged(ctx: BlockContext): void;
  focus(ctx: BlockContext): void;
  blur(ctx: BlockContext): void;
  paste(action: IBPasteAction): void;
  cut(action: IBCutAction): void;
  moveInSlot(action: IBMoveInSlotAction): void;
  moveBetweenSlots(action: IBMoveBetweenSlotsAction): void;
}

export interface BlockContextOptions {
  /**
   * whether unset all active blocks & slot's `active` state when click nothing on the page
   *
   * default is true
   */
  deactivateHandlersWhenBlur?: boolean;

  /**
   * whether navigate with arrow keys when focused.
   *
   * default is true.
   *
   * Note: to add your own keyboard logic, `blockContext.hiddenInput.addEventListener("keydown", ...)`
   */
  navigateWithArrowKeys?: boolean;

  /**
   * when user press delete key, whether perform cut action without updating clipboard.
   *
   * default is true.
   *
   * Note: to add your own keyboard logic, `blockContext.hiddenInput.addEventListener("keydown", ...)`
   */
  handleDeleteKey?: boolean;

  /**
   * default is true
   */
  multipleSelect?: boolean;
}

const defaultOptions: Required<BlockContextOptions> = {
  deactivateHandlersWhenBlur: true,
  navigateWithArrowKeys: true,
  handleDeleteKey: true,
  multipleSelect: true,
};

export class BlockContext extends TypedEmitter<BlockContextEvents> {
  hiddenInput: HTMLTextAreaElement;
  private _lastActiveElement: HTMLElement | Element | null = null;

  hasFocus = false;
  options: Required<BlockContextOptions>;

  uuid = `${Date.now().toString(36)}-${Math.random().toString(36)}`;
  dragging = new DraggingContext(this);

  constructor(options: BlockContextOptions = {}) {
    super();
    this.options = { ...defaultOptions, ...options };

    document.addEventListener("pointerup", this.handleGlobalPointerUp, false);

    const hiddenInput = this.hiddenInput = document.createElement("textarea");
    hiddenInput.style.cssText = "opacity:0;left:0;top:0;position:fixed;width:2px;height:2px";
    hiddenInput.tabIndex = -1;
    hiddenInput.inputMode = "none";
    hiddenInput.ownerDocument.body.appendChild(hiddenInput);

    const populateClipboard = (ev: ClipboardEvent) => {
      const text = this.getTextForClipboard();
      if (!text) return;

      ev.preventDefault();
      ev.clipboardData?.setData("text/plain", text);
    };
    hiddenInput.addEventListener("copy", (ev) => {
      populateClipboard(ev);
    }, false);
    hiddenInput.addEventListener("cut", (ev) => {
      populateClipboard(ev);
      this.deleteActiveBlocks();
    }, false);
    hiddenInput.addEventListener("paste", (ev) => {
      ev.preventDefault();

      // const info = this.activeElementInfo;
      // if (info?.type !== "block") return;

      try {
        const text = ev.clipboardData?.getData("text/plain");
        if (!text) return;

        const data = JSON.parse(text);
        this.pasteWithData(data);
      } catch (err) {
        console.error("Failed to paste!", err);
      }
    }, false);
    hiddenInput.addEventListener("focus", () => {
      this.hasFocus = true;
      this.emit("focus", this);
    }, false);
    hiddenInput.addEventListener("blur", () => {
      this.hasFocus = false;
      this._lastActiveElement = null;
      this.emit("blur", this);
    }, false);
    hiddenInput.addEventListener("keydown", (ev) => {
      const opts = this.options;

      switch (ev.code) {
        case "KeyA":
          if (opts.multipleSelect && (ev.ctrlKey || ev.metaKey)) {
            this.activeBlocks.clear();
            Array.from(this.slotOfActiveBlocks?.items || []).sort((a, b) => a.index - b.index).forEach(block => this.activeBlocks.add(block));
            this.syncActiveElementStatus();
          }
          break;

        case "ArrowUp":
          if (opts.navigateWithArrowKeys) this.activeNextBlock(-1, ev.shiftKey || ev.ctrlKey || ev.metaKey);
          break;

        case "ArrowDown":
          if (opts.navigateWithArrowKeys) this.activeNextBlock(+1, ev.shiftKey || ev.ctrlKey || ev.metaKey);
          break;

        case "ArrowLeft":
          if (opts.navigateWithArrowKeys) this.activeParentBlock();
          break;

        case "ArrowRight":
          if (opts.navigateWithArrowKeys) this.activeChildrenBlocks();
          break;

        case "Delete":
        case "Backspace":
          if (opts.handleDeleteKey) this.deleteActiveBlocks();
          break;

        case "Tab":
          {
            const el = this._lastActiveElement;
            if (el && "focus" in el) {
              const nextEl = (el.tabIndex === -1) && el.querySelector("[tabIndex], button, textarea, input, select, a, [contentEditable]") as HTMLElement;
              if (!nextEl || !("focus" in nextEl)) el.focus();
              else nextEl.focus();
            }
            ev.preventDefault();
          }
          break;
      }
    }, false);
  }

  focus() {
    if (document.activeElement === this.hiddenInput) return;
    // if (this.activeBlocks.size == 0 && !this.activeSlot) return;

    this._lastActiveElement = document.activeElement;
    this.hiddenInput.focus();
  }

  /**
   * prepare text to write to clipboard
   *
   * @returns `undefined` if cannot copy. otherwise returns text
   */
  getTextForClipboard() {
    const data: IBClipboardData = {
      isIBClipboardData: true,
      ibContextUUID: this.uuid,
      blocksData: [],
    };

    this.activeBlocks.forEach(block => {
      data.blocksData.push(block.data);
    });

    // nothing to copy?
    if (data.blocksData.length === 0) return;

    return JSON.stringify(data);
  }

  /**
   * Focus the hidden input and write selected blocks' data to the clipboard.
   */
  copy() {
    this.hiddenInput.focus();
    document.execCommand("copy");
  }

  pasteWithData(data: IBClipboardData, targetIndex?: number) {
    if (!isIBClipboardData(data)) throw new Error("Invalid IBClipboardData");

    const slot = this.activeSlot;
    if (!slot) return;

    const activeBlock = head(this.activeBlocks);
    const index = targetIndex ?? (
      slot === activeBlock?.ownerSlot
        ? activeBlock.index  // insert before current selected
        : Math.max(0, ...Array.from(slot.items.values(), x => 1 + x.index)) // insert after last item inside slot
    );

    // ----------------------------
    // event "paste"

    const action = new IBPasteAction({
      type: "paste",
      ctx: this,
      data,
      slot,
      index,
    });
    slot.info.onPaste?.(action);
    this.emit("paste", action);

    if (action.returnValue === false) return;


    // ----------------------------
    // active new blocks

    setTimeout(() => {
      // auto select the new block, if created
      // TODO: use subscriber instead of timer
      const maxIndex = data.blocksData.length + index - 1;
      const newBlocks = Array.from(slot.items).filter(block => block.index >= index && block.index <= maxIndex);
      if (newBlocks.length) {
        this.activeSlot = slot;
        this.activeBlocks.clear();
        newBlocks.forEach(block => this.activeBlocks.add(block));
        this.syncActiveElementStatus();
      }
    }, 100);
  }

  /**
   * Make a Cut Action and send to activeSlot.
   *
   * `cut` event will be emitted on the slot and this context.
   *
   * clipboard not affected. Call `copy` before this, if needed.
   *
   * @return `true` if action is handled and not `preventDefault`-ed
   */
  deleteActiveBlocks() {
    const blocks = Array.from(this.activeBlocks.values());

    const slot = blocks[0]?.ownerSlot;
    if (!slot) return false;

    const block0index = blocks[0]!.index;

    const action = new IBCutAction({
      type: "cut",
      blocks,
      ctx: this,
      slot,
    });

    slot.info.onCut?.(action);
    this.emit("cut", action);

    // if successful cut, select the next block
    if (action.returnValue) {
      const nextBlock = find(slot.items, x => x.index === block0index);
      if (nextBlock) this.addBlockToSelection(nextBlock);
    }
    return action.returnValue;
  }

  /**
   * Focus the hidden input and select next n-th block.
   *
   * @param n the relative number to current block. could be negative
   */
  activeNextBlock(n: number, multipleSelectMode = false) {
    const multipleSelect = multipleSelectMode && this.options.multipleSelect;
    this.focus();

    let somethingWasSelected = true;
    let blocks = Array.from(this.activeBlocks);
    if (!blocks.length) {
      // no block is selected
      // try select someone inside current slot
      blocks = Array.from(this.activeSlot?.items || []);
      somethingWasSelected = false;

      // still nothing inside? do nothing
      if (!blocks.length) return;
    }

    const slot = blocks[0]!.ownerSlot;
    let maxIdx = blocks[0]!.index, minIdx = maxIdx;
    let maxBlk = blocks[0]!, minBlk = maxBlk;

    blocks.slice(1).forEach(block => {
      if (block.ownerSlot !== slot) return;

      const index = block.index;
      if (index > maxIdx) { maxIdx = index; maxBlk = block; }
      if (index < minIdx) { minIdx = index; minBlk = block; }
    });

    const index = n > 0 ? (maxIdx + n) : (minIdx + n);
    const newBlock = find(slot?.items, x => x.index === index);

    if (!newBlock) {
      if (somethingWasSelected) {
        // something was selected
        if (!multipleSelect) {
          this.activeBlocks.clear();
          if (blocks.length > 1) {
            // collapse to single selection
            if (n > 0) this.activeBlocks.add(maxBlk);
            else this.activeBlocks.add(minBlk);
          }
          this.syncActiveElementStatus();
        }
      } else {
        // nothing was selected
        this.activeBlocks.clear();
        if (multipleSelect) blocks.forEach(b => this.activeBlocks.add(b));
        else if (n > 0) this.activeBlocks.add(minBlk);
        else this.activeBlocks.add(maxBlk);
        this.syncActiveElementStatus();
      }

      return;
    }

    if (!multipleSelect) this.activeBlocks.clear();
    this.activeBlocks.add(newBlock);
    this.activeSlot = slot;
    this.syncActiveElementStatus();
  }

  /**
   * Focus the hidden input and select parent block of current block.
   */
  activeParentBlock() {
    const newBlock = this.activeSlot?.ownerBlock;
    const newSlot = newBlock?.ownerSlot;

    this.activeSlot = newSlot || null;
    this.activeBlocks.clear();
    if (newBlock) this.activeBlocks.add(newBlock);
    this.syncActiveElementStatus();
  }

  /**
   * Focus the hidden input and select current block's first slot and its children.
   */
  activeChildrenBlocks() {
    const block = head(this.activeBlocks);
    const slot = head(block?.slots);
    if (!slot) return;

    this.activeSlot = slot;
    this.activeBlocks.clear();
    if (this.options.multipleSelect) {
      slot.items.forEach(block => this.activeBlocks.add(block));
    } else {
      const block = head(slot.items);
      if (block) this.activeBlocks.add(block);
    }
    this.syncActiveElementStatus();
  }

  /**
   * the current active blocks.
   *
   * WARN:
   * 1. they must be in the same slot!
   * 2. always invoke `syncActiveElementStatus` after mutating this.
   */
  activeBlocks = new Set<BlockHandler>();
  slotOfActiveBlocks: SlotHandler | null = null;

  /**
   * the current active slot.
   *
   * WARN:
   * 1. this is NOT ALWAYS related to `activeBlocks`. See `slotOfActiveBlocks` if needed.
   * 2. always invoke `syncActiveElementStatus` after mutating this.
   */
  activeSlot: SlotHandler | null = null;
  private lastActiveSlot: SlotHandler | null = null;
  private lastActiveBlocks?: Set<BlockHandler>;

  /**
   * invoke this when `activeElements` is mutated!
   */
  syncActiveElementStatus() {
    let hasChanges = false;
    const lastBlocks = this.lastActiveBlocks;
    const lastSlot = this.lastActiveSlot;

    const activeBlocksArray = Array.from(this.activeBlocks);
    const slotOfBlocks = activeBlocksArray[0]?.ownerSlot || null;

    if (activeBlocksArray.length > 1 && slotOfBlocks !== this.activeSlot) {
      // if multiple blocks are selected, enforce the ownerSlot is active
      this.activeSlot = slotOfBlocks;
    }

    if (!this.activeSlot && slotOfBlocks) {
      // always active one slot
      this.activeSlot = slotOfBlocks;
    }

    activeBlocksArray.forEach((item, index) => {
      lastBlocks?.delete(item);
      hasChanges = item.setSelectStatus(index) || hasChanges;
    });

    lastBlocks?.forEach(item => {
      hasChanges = item.setSelectStatus(false) || hasChanges;
    });

    if (this.activeSlot !== lastSlot) {
      lastSlot?.setActive(false);
      this.activeSlot?.setActive(true);
      this.lastActiveSlot = this.activeSlot;
      hasChanges = true;
    }

    this.lastActiveBlocks = new Set(this.activeBlocks);
    this.slotOfActiveBlocks = slotOfBlocks;

    if (hasChanges) this.emit("activeElementChanged", this);
  }

  isFocusingBlock?: BlockHandler;
  isFocusingSlot?: SlotHandler;

  /**
   * clear selection
   */
  clearSelection() {
    this.activeBlocks.clear();
    this.activeSlot = null;
    this.syncActiveElementStatus();
  }

  /**
   * select a block or add it to selection ( if multipleSelect is not `none`)
   *
   * note: if in multipleSelect mode, `activeSlot` will be affected
   */
  addBlockToSelection(
    currBlock: BlockHandler,
    multipleSelect: "none" | "ctrl" | "shift" | WithModifierKeys = "none"
  ): void {
    if (typeof multipleSelect === "object") {
      if (multipleSelect.ctrlKey || multipleSelect.metaKey) multipleSelect = "ctrl";
      else if (multipleSelect.shiftKey) multipleSelect = "shift";
      else multipleSelect = "none";
    }

    if (!this.options.multipleSelect) multipleSelect = "none";

    if (multipleSelect === "ctrl") {
      // discontinuous multiple-selection

      // ensure that they're in the same slot
      if (currBlock.ownerSlot !== this.slotOfActiveBlocks) this.activeBlocks.clear();

      this.activeBlocks.add(currBlock);
      this.activeSlot = currBlock.ownerSlot || null;
    } else if (multipleSelect === "shift") {
      // continuous selection

      const slot = currBlock.ownerSlot;
      // ensure that they're in the same slot
      if (slot !== this.slotOfActiveBlocks) this.activeBlocks.clear();

      const currIndex = currBlock.index;
      let minIndex = currIndex, maxIndex = currIndex;

      this.activeBlocks.forEach(block => {
        const index = block.index;
        if (minIndex > index) minIndex = index;
        if (maxIndex < index) maxIndex = index;
      });

      if (slot) {
        // make a continuous selection
        this.activeBlocks.clear();
        slot.items.forEach(block => {
          const index = block.index;
          if (index >= minIndex && index <= maxIndex) this.activeBlocks.add(block);
        });
        this.activeSlot = slot;
      } else {
        // anonymous root slot
        this.activeBlocks.add(currBlock);
        this.activeSlot = null;
      }

    } else {
      // single selection
      this.activeBlocks.clear();
      this.activeBlocks.add(currBlock);
    }

    this.syncActiveElementStatus();
  }

  handleSlotPointerUp = (slot: SlotHandler, isCapture?: boolean) => {
    if (!isCapture && this.isFocusingSlot) return;  // capture and bubbling
    this.isFocusingSlot = slot;
  };

  handleBlockPointerUp = (block: BlockHandler, isCapture?: boolean) => {
    if (!isCapture && this.isFocusingBlock) return;  // capture and bubbling
    this.isFocusingBlock = block;
  };

  handleGlobalPointerUp = (ev: PointerEvent) => {
    const currBlock = this.isFocusingBlock;
    const currSlot = this.isFocusingSlot;
    this.isFocusingBlock = void 0;
    this.isFocusingSlot = void 0;

    if (!currBlock) {
      // nothing was clicked
      if (this.options.deactivateHandlersWhenBlur && this.activeBlocks.size > 0) {
        this.activeBlocks.clear();
      }
    } else {
      this.activeSlot = currSlot || null;
      this.addBlockToSelection(currBlock, (ev.ctrlKey || ev.metaKey) ? "ctrl" : (ev.shiftKey ? "shift" : "none"));
    }

    this.syncActiveElementStatus();
  };

  dispose() {
    this.dragging.dispose();
    this.hiddenInput.parentElement?.removeChild(this.hiddenInput);
    document.removeEventListener("pointerup", this.handleGlobalPointerUp, false);
  }

  createBlock(info: BlockInfo, ownerSlot: SlotHandler | null = null) {
    return new BlockHandler(this, ownerSlot, info);
  }

  createSlot(info: SlotInfo, ownerBlock: BlockHandler | null = null) {
    return new SlotHandler(this, ownerBlock, info);
  }
}
