import { CBCutAction, CBPasteAction } from ".";
import type { BlockContext } from "./BlockContext";
import type { BlockHandler, BlockInfo } from "./BlockHandler";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SlotInfo {
  onCut?(action: CBCutAction): void;
  onPaste?(action: CBPasteAction): void;
  onActiveStatusChange?(slot: SlotHandler): void;
}

export class SlotHandler {
  readonly type = "slot";

  readonly ctx: BlockContext;
  readonly ownerBlock: BlockHandler | null;
  readonly items = new Set<BlockHandler>();
  info: SlotInfo;

  handlePointerUp = () => this.ctx.handleSlotPointerUp(this);
  handlePointerUpCapture = () => this.ctx.handleSlotPointerUp(this, true);

  constructor(ctx: BlockContext, ownerBlock: BlockHandler | null, info: SlotInfo) {
    this.ctx = ctx;
    this.ownerBlock = ownerBlock;
    if (ownerBlock) ownerBlock.slots.add(this);
    this.info = info;
  }

  createBlock(info: BlockInfo) {
    return this.ctx.createBlock(info, this);
  }


  private _isActive = false;

  get isActive() {
    return this._isActive;
  }

  /**
   * @internal NEVER CALL THIS! unless you know what's going on!
   * @param value new activeNumber
   * @returns whether activeNumber is actually changed
   */
  setActive(value: boolean) {
    if (this._isActive === value) return false;
    this._isActive = value;
    this.info.onActiveStatusChange?.(this);
    return true;
  }

  dispose() {
    let needSync = false;
    if (this.ctx.slotOfActiveBlocks === this) {
      this.ctx.activeBlocks.clear();
      needSync = true;
    }
    if (this.ctx.activeSlot === this) {
      this.ctx.activeSlot = null;
      needSync = true;
    }
    if (needSync) this.ctx.syncActiveElementStatus();

    this.ownerBlock?.slots.delete(this);
    this.items.forEach(child => child.dispose());
    this.items.clear();
  }
}