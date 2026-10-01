/**
 * Consumes the built package (`dist/`) through its `exports` map, the way an
 * app would. `npm test` builds first; `npm run type:test` type-checks this
 * file against the emitted `.d.ts`, so the type assertions below cover the
 * published declarations rather than the source.
 */
import {
  type EntityOf,
  type ExhaustiveHandlersOf,
  type HandlersOf,
  type IntentOf,
  type KeyOf,
  type PayloadOf,
  type ShapelessKeyOf,
  dndcraft,
} from "@kellanjs/dndcraft";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

type Note = { id: string; isPinned: boolean };

const dnd = dndcraft()
  .entity({ key: "note", shape: {} as { note: Note }, getId: (n) => n.note.id })
  .entity({ key: "pinsZone" })
  .rule({ source: "note", target: "note", evaluate: () => "link" })
  .rule({
    source: "note",
    target: "pinsZone",
    evaluate: (src) => (src.note.isPinned ? "unpin" : "pin"),
  })
  .build();

describe("built package consumer surface", () => {
  it("supports the core API through package exports", () => {
    const note = dnd.note.$data({ note: { id: "n1", isPinned: false } });
    const other = dnd.note.$data({ note: { id: "n2", isPinned: true } });
    const zone = dnd.pinsZone.$data();

    const pin = vi.fn();
    const link = vi.fn();

    expect(dnd.$handle(note, zone, { pin, link })).toBe(true);
    expect(pin).toHaveBeenCalledExactlyOnceWith({
      source: note,
      target: zone,
      intent: "pin",
    });

    expect(dnd.$handle(note, other, { pin, link })).toBe(true);
    expect(link).toHaveBeenCalledOnce();

    expect(dnd.$evaluate(other, zone)?.intent).toBe("unpin");
    expect(dnd.$canDrop(note, note)).toBe(false); // self-drop
    expect(dnd.$keys).toEqual({ note: "note", pinsZone: "pinsZone" });
    expect(dnd.$keyOf(zone)).toBe("pinsZone");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(dnd.$keyOf({ key: "note" })).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce(); // hand-built data is reported
    warn.mockRestore();
    expect(dnd.$rules).toEqual([
      { source: "note", target: "note" },
      { source: "note", target: "pinsZone" },
    ]);
  });

  it("keeps full type inference in the published declarations", () => {
    expectTypeOf<EntityOf<typeof dnd, "note">>().toEqualTypeOf<{
      $key: "note";
      note: Note;
    }>();
    expectTypeOf<IntentOf<typeof dnd>>().toEqualTypeOf<
      "link" | "pin" | "unpin"
    >();
    expectTypeOf<PayloadOf<typeof dnd>["intent"]>().toEqualTypeOf<
      IntentOf<typeof dnd>
    >();

    const handlers: HandlersOf<typeof dnd> = {
      pin: (p) => {
        expectTypeOf(p.source).toEqualTypeOf<{ $key: "note"; note: Note }>();
        expectTypeOf(p.target).toEqualTypeOf<{ $key: "pinsZone" }>();
      },
      // @ts-expect-error misspelled intents are rejected
      pinn: () => {},
    };
    void handlers;

    expectTypeOf<KeyOf<typeof dnd>>().toEqualTypeOf<"note" | "pinsZone">();
    expectTypeOf<ShapelessKeyOf<typeof dnd>>().toEqualTypeOf<"pinsZone">();
    const exhaustive = {
      pin: () => {},
      unpin: () => {},
    } satisfies ExhaustiveHandlersOf<typeof dnd, "link">;
    void exhaustive;
  });
});
