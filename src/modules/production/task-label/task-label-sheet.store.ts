import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { LABEL_SLOTS } from './task-label-sheet';

// The label sheet loaded in the office printer is ONE physical thing shared by everybody: which of
// its slots were already printed must be the same for every user and computer. It is a few bytes of
// state that only matter until the sheet is used up, so it lives in a JSON file on the server
// (single API instance) instead of a table. Every change goes through one queue and an atomic rename.

const SHEET_FILE =
  process.env.TASK_LABEL_SHEET_FILE || join(homedir(), 'ankaa-data', 'task-label-sheet.json');

export interface LabelSheetState {
  /** changes when "Folha nova" starts a fresh sheet */
  sheetId: string;
  startedAt: string;
  /** slot indexes already printed on this sheet */
  usedSlots: number[];
  updatedAt: string;
}

const freshSheet = (): LabelSheetState => {
  const now = new Date().toISOString();
  return { sheetId: randomUUID(), startedAt: now, usedSlots: [], updatedAt: now };
};

const validSlot = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < LABEL_SLOTS.length;

@Injectable()
export class TaskLabelSheetStore {
  private readonly logger = new Logger(TaskLabelSheetStore.name);
  private queue: Promise<unknown> = Promise.resolve();

  /** Serialises every read-modify-write so two prints can't claim the same slot. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<LabelSheetState> {
    try {
      const parsed = JSON.parse(await fs.readFile(SHEET_FILE, 'utf8')) as Partial<LabelSheetState>;
      if (!parsed.sheetId) return freshSheet();
      return {
        sheetId: parsed.sheetId,
        startedAt: parsed.startedAt ?? new Date().toISOString(),
        usedSlots: [...new Set((parsed.usedSlots ?? []).filter(validSlot))].sort((a, b) => a - b),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        this.logger.warn(`sheet state unreadable, starting fresh: ${(e as Error).message}`);
      return freshSheet();
    }
  }

  private async write(state: LabelSheetState): Promise<LabelSheetState> {
    const next = {
      ...state,
      usedSlots: [...new Set(state.usedSlots)].sort((a, b) => a - b),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(dirname(SHEET_FILE), { recursive: true });
    const tmp = `${SHEET_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, SHEET_FILE);
    return next;
  }

  get(): Promise<LabelSheetState> {
    return this.exclusive(() => this.read());
  }

  /** "Folha nova": every slot is free again. */
  startNewSheet(): Promise<LabelSheetState> {
    return this.exclusive(() => this.write(freshSheet()));
  }

  /** Frees slots by hand (a cut went wrong, or the slot was marked by mistake). */
  release(slots: number[], sheetId?: string): Promise<LabelSheetState> {
    return this.exclusive(async () => {
      const state = await this.read();
      // a failed job from a sheet that was already replaced must not touch the new one
      if (sheetId && sheetId !== state.sheetId) return state;
      const drop = new Set(slots);
      return this.write({ ...state, usedSlots: state.usedSlots.filter(s => !drop.has(s)) });
    });
  }

  /**
   * Claims slots for a print, atomically: throws if any of them is already printed (another user got
   * there first). `isFreshSheet` is true when nothing was printed on this sheet before — the print
   * then carries the orientation mark.
   */
  claim(
    slots: number[],
    onTaken: (taken: number[]) => Error,
  ): Promise<{ state: LabelSheetState; isFreshSheet: boolean }> {
    return this.exclusive(async () => {
      const state = await this.read();
      const taken = slots.filter(s => state.usedSlots.includes(s));
      if (taken.length) throw onTaken(taken);
      const isFreshSheet = state.usedSlots.length === 0;
      return {
        state: await this.write({ ...state, usedSlots: [...state.usedSlots, ...slots] }),
        isFreshSheet,
      };
    });
  }
}
