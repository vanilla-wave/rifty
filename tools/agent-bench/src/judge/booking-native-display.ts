import type { ElementHandle } from '@playwright/test';
import type { JudgeContext } from './context.ts';
import { publicReadOnlyText, publicRecordValuePattern } from './public-record-display.ts';
import { reservationDisplay } from './reservation-display.ts';
import type { ReservationRecord } from './reservation-records.ts';

/** Declared native columns own their values; another row never supplies a missing date. */
export async function bookingReservationDisplay(
  ctx: JudgeContext,
  record: ReservationRecord,
  known: readonly ReservationRecord[],
): ReturnType<typeof reservationDisplay> {
  const ownedTables: ElementHandle<SVGElement | HTMLElement>[] = [];
  const found = [];
  try {
    for (const table of await ctx.view.getByRole('table').all()) {
      if (!(await table.isVisible())) continue;
      const headers = await table.getByRole('columnheader').allTextContents();
      const index = (name: RegExp) => headers.findIndex((value) => name.test(value.trim()));
      const columns = {
        room: index(/^room(?: name)?$/i),
        date: index(/^(?:calendar )?date$/i),
        start: index(/^start(?: time)?$/i),
        end: index(/^end(?: time)?$/i),
        time: index(/^(?:time|time interval)$/i),
        seats: index(/^(?:seats|guests)$/i),
      };
      if (
        columns.room < 0 ||
        columns.date < 0 ||
        columns.seats < 0 ||
        ((columns.start < 0 || columns.end < 0) && columns.time < 0)
      )
        continue;
      const handle = await table.elementHandle();
      if (handle) ownedTables.push(handle);
      for (const row of await table.getByRole('row').all()) {
        if (!(await row.isVisible())) continue;
        let editing = false;
        for (const field of await row
          .locator(
            'input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),select:not([disabled]),[contenteditable="true"]',
          )
          .all())
          if (await field.isVisible()) editing = true;
        if (editing) continue;
        const cells = await row.getByRole('cell').or(row.getByRole('rowheader')).all();
        if (cells.length < headers.length) continue;
        const texts = await Promise.all(cells.map(publicReadOnlyText));
        const times =
          columns.start >= 0 && columns.end >= 0
            ? [texts[columns.start], texts[columns.end]]
            : (texts[columns.time]!.match(/\b\d{2}:\d{2}\b/g) ?? []);
        const seats = /^\s*(\d+)\s*(?:seats?|guests?)?\s*$/i.exec(texts[columns.seats]!);
        if (
          publicRecordValuePattern(record.room).test(texts[columns.room]!) &&
          publicRecordValuePattern({ calendarDate: record.date }).test(texts[columns.date]!) &&
          times.length === 2 &&
          times[0]?.trim() === record.start &&
          times[1]?.trim() === record.end &&
          seats !== null &&
          Number(seats[1]) === record.seats
        )
          found.push(row);
      }
    }
    const other = await reservationDisplay(ctx, record, known, ownedTables);
    const count = found.length + other.count;
    const bounds = count === 1 && found.length === 1 ? await found[0]!.boundingBox() : null;
    return {
      present: count === 1,
      count,
      position: count !== 1 ? null : bounds ? { top: bounds.y, left: bounds.x } : other.position,
    };
  } finally {
    await Promise.all(ownedTables.map((table) => table.dispose()));
  }
}
