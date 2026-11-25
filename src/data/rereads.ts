// When an open app reads its records again: once a request it saw waiting has
// finished, and while someone's items are held back for a reason that may end
// soon, or the names of their codes are still to come. A try that fails, or
// leaves that so, is followed by others with twice the wait each time, and
// then by none until the app comes to the front.

import { FolderError } from '../model/parse';
import type { Store } from './store';

const FIRST_WAIT_MS = 30_000;
const TRIES = 6;
/** The failed try that says so: the first two may be a passing fault. */
const SAID_AT = 3;

export class Rereads {
  private tries = 0;
  private nextAt = 0;
  private seen = 0;
  private said = false;

  constructor(
    private readonly store: Store,
    private readonly now: () => number,
    /** Tells the person that the records shown are not the folder's. */
    private readonly say: (text: string) => void,
  ) {}

  /** Whether the timer should look now. */
  due(): boolean {
    return (this.store.owed || this.store.mayBring()) && this.tries < TRIES && this.now() >= this.nextAt;
  }

  /** Reads the records again if that is due; at the front, also while anyone's items are held back for any reason. */
  async look(front = false): Promise<void> {
    // Coming to the front, or another finished request, starts the tries over.
    if (front || this.store.finished > this.seen) this.tries = this.nextAt = 0;
    this.seen = this.store.finished;
    if (!this.due() && !(front && this.store.anyHeld())) return;
    this.tries += 1;
    this.nextAt = this.now() + FIRST_WAIT_MS * 2 ** (this.tries - 1);
    try {
      await this.store.reload();
    } catch (e) {
      this.failed(e);
      return;
    }
    this.said = false;
    if (!this.store.owed && !this.store.mayBring()) this.tries = this.nextAt = 0;
  }

  private failed(e: unknown): void {
    const newer = e instanceof FolderError && e.kind === 'newer_format';
    if (this.said || (!newer && this.tries < SAID_AT)) return;
    this.said = true;
    const why = e instanceof Error ? e.message : 'unknown error';
    this.say(newer ? why : `The records could not be read again, so these are from before. ${why}`);
  }
}
