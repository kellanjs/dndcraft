/**
 * Runtime behavior tests. Type-level behavior (narrowing, rejected typos)
 * lives in `dndcraft.test-d.ts`.
 *
 * Rule of thumb for this file: every test should fail if the behavior it
 * names is removed from the library. In particular, fixture rules must not
 * re-implement library behavior (e.g. a self-drop guard), or they will hide
 * regressions in the library itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dndcraft } from "../src/index.js";

// ============================================================================
// Fixtures
// ============================================================================

type NoteShape = {
  id: string;
  title: string;
  linkedIds: Set<string>;
};

type NotebookShape = {
  id: string;
  name: string;
};

type TagShape = {
  id: string;
  label: string;
};

function createTestRegistry() {
  return (
    dndcraft()
      .entity({ key: "note", shape: {} as NoteShape, getId: (n) => n.id })
      .entity({
        key: "notebook",
        shape: {} as NotebookShape,
        getId: (n) => n.id,
      })
      .entity({ key: "tag", shape: {} as TagShape, getId: (t) => t.id })
      .entity({ key: "pinsButton" })
      .entity({ key: "favoritesButton" })
      // Deliberately no `src.id === tgt.id` check here: self-drop prevention
      // is the library's job, and a guard in the rule would mask it.
      .rule({
        source: "note",
        target: "note",
        evaluate: (src, tgt) => (src.linkedIds.has(tgt.id) ? "unlink" : "link"),
      })
      .rule({
        source: "note",
        target: "notebook",
        evaluate: () => "add-to-notebook",
      })
      .rule({ source: "note", target: "pinsButton", evaluate: () => "pin" })
      .rule({
        source: "note",
        target: "favoritesButton",
        evaluate: () => "favorite",
      })
      .rule({
        source: "notebook",
        target: "notebook",
        evaluate: () => "reorder",
      })
      .build()
  );
}

/** A one-rule registry whose `evaluate` is a spy, to observe when it runs. */
function createSpyRegistry() {
  const evaluate = vi.fn(
    (_source: { id?: string }, _target: { id?: string }): "link" | null =>
      "link",
  );
  const dnd = dndcraft()
    .entity({ key: "note", shape: {} as { id?: string }, getId: (n) => n.id })
    .entity({ key: "tag" })
    .rule({ source: "note", target: "note", evaluate })
    .build();
  return { dnd, evaluate };
}

function createNote(id: string, linkedIds: string[] = []) {
  return {
    $key: "note" as const,
    id,
    title: `Note ${id}`,
    linkedIds: new Set(linkedIds),
  };
}

function createNotebook(id: string) {
  return { $key: "notebook" as const, id, name: `Notebook ${id}` };
}

function createTag(id: string) {
  return { $key: "tag" as const, id, label: `Tag ${id}` };
}

// ============================================================================
// Entity guards ($is)
// ============================================================================

describe("entity guards ($is)", () => {
  const dnd = createTestRegistry();

  it("matches objects whose key equals the entity key", () => {
    expect(dnd.note.$is(createNote("1"))).toBe(true);
    expect(dnd.notebook.$is(createNotebook("1"))).toBe(true);
    expect(dnd.pinsButton.$is({ $key: "pinsButton" })).toBe(true);
  });

  it("rejects objects of another entity type", () => {
    expect(dnd.note.$is(createNotebook("1"))).toBe(false);
    expect(dnd.notebook.$is(createNote("1"))).toBe(false);
  });

  it("rejects objects without a matching key", () => {
    expect(dnd.note.$is({})).toBe(false);
    expect(dnd.note.$is({ $key: "unknown" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(dnd.note.$is(null)).toBe(false);
    expect(dnd.note.$is(undefined)).toBe(false);
    expect(dnd.note.$is("note")).toBe(false);
    expect(dnd.note.$is(123)).toBe(false);
    expect(dnd.note.$is([])).toBe(false);
  });

  it("checks only the key, not the rest of the shape", () => {
    // Documents a known limitation: `$is` trusts that anything carrying
    // `key: "note"` really is a note.
    expect(dnd.note.$is({ $key: "note" })).toBe(true);
  });
});

// ============================================================================
// Data constructors ($data)
// ============================================================================

describe("data constructors ($data)", () => {
  const dnd = createTestRegistry();

  it("adds the entity key to the shape", () => {
    const linkedIds = new Set(["2"]);

    expect(dnd.note.$data({ id: "1", title: "Note 1", linkedIds })).toEqual({
      $key: "note",
      id: "1",
      title: "Note 1",
      linkedIds,
    });
  });

  it("creates key-only data for shapeless entities", () => {
    expect(dnd.pinsButton.$data()).toEqual({ $key: "pinsButton" });
  });

  it("returns a new object without mutating the shape", () => {
    const shape = { id: "1", name: "Notebook 1" };
    const data = dnd.notebook.$data(shape);

    expect(data).not.toBe(shape);
    expect(shape).toEqual({ id: "1", name: "Notebook 1" });
  });

  it("never lets the shape override the key", () => {
    // Simulates a JS caller (or a cast) sneaking in a conflicting key.
    const shape = { id: "1", name: "Notebook 1", $key: "note" };

    expect(dnd.notebook.$data(shape as never).$key).toBe("notebook");
  });

  it("keeps a shape's own `key` field", () => {
    const rows = dndcraft()
      .entity({ key: "row", shape: {} as { key: string; label: string } })
      .build();

    expect(rows.row.$data({ key: "react-key-1", label: "Row" })).toEqual({
      $key: "row",
      key: "react-key-1",
      label: "Row",
    });
  });

  it("produces data that $is and rules recognize", () => {
    const note = dnd.note.$data({
      id: "1",
      title: "Note 1",
      linkedIds: new Set(),
    });
    const pins = dnd.pinsButton.$data();

    expect(dnd.note.$is(note)).toBe(true);
    expect(dnd.pinsButton.$is(pins)).toBe(true);
    expect(dnd.$evaluate(note, pins)?.intent).toBe("pin");
  });
});

// ============================================================================
// Introspection
// ============================================================================

describe("introspection", () => {
  it("$keys maps every entity key to itself", () => {
    expect(createTestRegistry().$keys).toEqual({
      note: "note",
      notebook: "notebook",
      tag: "tag",
      pinsButton: "pinsButton",
      favoritesButton: "favoritesButton",
    });
  });

  it("$entities lists entity keys in registration order", () => {
    expect(createTestRegistry().$entities).toEqual([
      "note",
      "notebook",
      "tag",
      "pinsButton",
      "favoritesButton",
    ]);
  });

  it("$rules lists source/target pairs in definition order", () => {
    expect(createTestRegistry().$rules).toEqual([
      { source: "note", target: "note" },
      { source: "note", target: "notebook" },
      { source: "note", target: "pinsButton" },
      { source: "note", target: "favoritesButton" },
      { source: "notebook", target: "notebook" },
    ]);
  });

  it("an empty registry has no keys, entities or rules", () => {
    const dnd = dndcraft().build();

    expect(dnd.$keys).toEqual({});
    expect(dnd.$entities).toEqual([]);
    expect(dnd.$rules).toEqual([]);
  });
});

// ============================================================================
// Rule matching
// ============================================================================

describe("rule matching", () => {
  const dnd = createTestRegistry();
  const intentOf = (source: unknown, target: unknown) =>
    dnd.$evaluate(source, target)?.intent ?? null;

  it("returns the intent of the rule for the source/target pair", () => {
    const note = createNote("1");

    expect(intentOf(note, createNotebook("1"))).toBe("add-to-notebook");
    expect(intentOf(note, { $key: "pinsButton" })).toBe("pin");
    expect(intentOf(note, { $key: "favoritesButton" })).toBe("favorite");
    expect(intentOf(createNotebook("1"), createNotebook("2"))).toBe("reorder");
  });

  it("lets the intent depend on the entity data", () => {
    const note1 = createNote("1");
    const note2 = createNote("2", ["1"]); // already linked to note1

    expect(intentOf(note1, createNote("3"))).toBe("link");
    expect(intentOf(note2, note1)).toBe("unlink");
  });

  it("treats rules as directional", () => {
    // Only note → notebook is defined.
    expect(intentOf(createNotebook("1"), createNote("1"))).toBeNull();
  });

  it("returns null when no rule exists for the pair", () => {
    expect(intentOf(createNote("1"), createTag("1"))).toBeNull();
  });

  it("returns null when the rule's evaluate returns null", () => {
    const rejecting = dndcraft()
      .entity({ key: "item" })
      .rule({ source: "item", target: "item", evaluate: () => null })
      .build();

    expect(rejecting.$evaluate({ $key: "item" }, { $key: "item" })).toBeNull();
  });

  it("returns null for unregistered entities", () => {
    const unknown = { $key: "unknown", id: "1" };

    expect(intentOf(createNote("1"), unknown)).toBeNull();
    expect(intentOf(unknown, createNote("1"))).toBeNull();
  });

  it("returns null for non-object sources and targets", () => {
    const note = createNote("1");

    expect(intentOf(null, note)).toBeNull();
    expect(intentOf(note, null)).toBeNull();
    expect(intentOf("note", note)).toBeNull();
    expect(intentOf(note, 123)).toBeNull();
  });

  it("uses the last rule when a pair is defined twice", () => {
    const overridden = dndcraft()
      .entity({ key: "item" })
      .entity({ key: "bin" })
      .rule({ source: "item", target: "item", evaluate: () => "first" })
      .rule({ source: "item", target: "bin", evaluate: () => "trash" })
      .rule({ source: "item", target: "item", evaluate: () => "second" })
      .build();

    expect(
      overridden.$evaluate({ $key: "item" }, { $key: "item" })?.intent,
    ).toBe("second");
    // Listed once, at the position of its first definition.
    expect(overridden.$rules).toEqual([
      { source: "item", target: "item" },
      { source: "item", target: "bin" },
    ]);
  });

  it("keeps pairs distinct when entity keys contain separators", () => {
    // Joining keys as "source:target" would turn both pairs into "a:b:c".
    const colons = dndcraft()
      .entity({ key: "a:b" })
      .entity({ key: "c" })
      .entity({ key: "a" })
      .entity({ key: "b:c" })
      .rule({ source: "a:b", target: "c", evaluate: () => "first" })
      .rule({ source: "a", target: "b:c", evaluate: () => "second" })
      .build();

    expect(
      colons.$evaluate(colons["a:b"].$data(), colons.c.$data())?.intent,
    ).toBe("first");
    expect(
      colons.$evaluate(colons.a.$data(), colons["b:c"].$data())?.intent,
    ).toBe("second");
    expect(colons.$rules).toEqual([
      { source: "a:b", target: "c" },
      { source: "a", target: "b:c" },
    ]);
  });

  it("treats non-string results from evaluate as no match", () => {
    // Simulates JS callers (or casts): the types only allow `I | null`.
    const results: unknown[] = [undefined, 0, false, {}, ["intent"]];

    for (const result of results) {
      const odd = dndcraft()
        .entity({ key: "item" })
        .rule({
          source: "item",
          target: "item",
          evaluate: () => result as "x" | null,
        })
        .build();

      expect(odd.$evaluate({ $key: "item" }, { $key: "item" })).toBeNull();
      expect(odd.$canDrop({ $key: "item" }, { $key: "item" })).toBe(false);
    }
  });

  it("never matches rules that reference unregistered entities", () => {
    const withGhostRule = dndcraft()
      .entity({ key: "note" })
      // @ts-expect-error simulates a JS caller bypassing the types
      .rule({ source: "ghost", target: "note", evaluate: () => "haunt" })
      .build();

    expect(withGhostRule.$canDrop({ $key: "ghost" }, { $key: "note" })).toBe(
      false,
    );
  });
});

// ============================================================================
// Rule evaluate function
// ============================================================================

describe("rule evaluate function", () => {
  it("receives the original source and target, in that order", () => {
    const { dnd, evaluate } = createSpyRegistry();
    const source = { $key: "note", id: "1" };
    const target = { $key: "note", id: "2" };

    dnd.$evaluate(source, target);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]?.[0]).toBe(source);
    expect(evaluate.mock.calls[0]?.[1]).toBe(target);
  });

  it("is not called when the drop is rejected before rule lookup", () => {
    const { dnd, evaluate } = createSpyRegistry();
    const note = { $key: "note", id: "1" };

    dnd.$evaluate(null, note); // non-object
    dnd.$evaluate({ $key: "unknown" }, note); // unregistered
    dnd.$evaluate(note, { $key: "tag" }); // no rule for pair
    dnd.$evaluate(note, { $key: "note", id: "1" }); // self-drop

    expect(evaluate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Self-drop prevention
// ============================================================================

describe("self-drop prevention", () => {
  const dnd = createTestRegistry();

  it("rejects dropping an entity onto itself", () => {
    const note = createNote("1");

    expect(dnd.$canDrop(note, note)).toBe(false);
  });

  it("rejects different objects that share an id", () => {
    expect(dnd.$canDrop(createNote("1"), createNote("1"))).toBe(false);
  });

  it("allows entities of the same type with different ids", () => {
    expect(dnd.$canDrop(createNote("1"), createNote("2"))).toBe(true);
  });

  it("does not compare ids across entity types", () => {
    // A note and a notebook can share an id without being "the same thing".
    expect(dnd.$canDrop(createNote("1"), createNotebook("1"))).toBe(true);
  });

  it("is skipped when the entity has no getId", () => {
    const withoutGetId = dndcraft()
      .entity({ key: "item" })
      .rule({ source: "item", target: "item", evaluate: () => "reorder" })
      .build();

    expect(withoutGetId.$canDrop({ $key: "item" }, { $key: "item" })).toBe(
      true,
    );
  });

  it("is skipped when getId returns undefined", () => {
    const { dnd: spyDnd } = createSpyRegistry();

    // Neither object has an id, so they can't be identified as the same.
    expect(spyDnd.$canDrop({ $key: "note" }, { $key: "note" })).toBe(true);
  });

  describe("with numeric ids", () => {
    const rows = dndcraft()
      .entity({
        key: "row",
        shape: {} as { index: number | string },
        getId: (r) => r.index,
      })
      .rule({ source: "row", target: "row", evaluate: () => "reorder" })
      .build();

    it("rejects the same number", () => {
      expect(
        rows.$canDrop({ $key: "row", index: 3 }, { $key: "row", index: 3 }),
      ).toBe(false);
    });

    it("treats 0 as a real id, not as 'no id'", () => {
      expect(
        rows.$canDrop({ $key: "row", index: 0 }, { $key: "row", index: 0 }),
      ).toBe(false);
    });

    it("allows different numbers", () => {
      expect(
        rows.$canDrop({ $key: "row", index: 0 }, { $key: "row", index: 1 }),
      ).toBe(true);
    });

    it("compares with ===, so 1 and '1' are different ids", () => {
      expect(
        rows.$canDrop({ $key: "row", index: 1 }, { $key: "row", index: "1" }),
      ).toBe(true);
    });
  });
});

// ============================================================================
// $evaluate
// ============================================================================

describe("$evaluate", () => {
  const dnd = createTestRegistry();

  it("returns a payload with the original source, target and intent", () => {
    const source = createNote("1");
    const target = createNote("2");

    const payload = dnd.$evaluate(source, target);

    expect(payload).toEqual({ source, target, intent: "link" });
    expect(payload?.source).toBe(source);
    expect(payload?.target).toBe(target);
  });

  it("returns null when nothing matches", () => {
    expect(dnd.$evaluate(createNote("1"), createTag("1"))).toBeNull();
  });

  it("is safe to await, even when nothing matches", async () => {
    // v1 returned an object with a `then` method, which made `await` wait
    // forever for a callback that never came. If that regresses, this test
    // times out instead of passing.
    expect(await dnd.$evaluate(createNote("1"), createTag("1"))).toBeNull();
  });
});

// ============================================================================
// $handle
// ============================================================================

describe("$handle", () => {
  const dnd = createTestRegistry();

  it("calls the handler for the matched intent once, with the payload", () => {
    const source = createNote("1");
    const target = createNote("2");
    const link = vi.fn();

    dnd.$handle(source, target, { link });

    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith({ source, target, intent: "link" });
  });

  it("does not call handlers for other intents", () => {
    const link = vi.fn();
    const unlink = vi.fn();
    const pin = vi.fn();

    dnd.$handle(createNote("1"), createNote("2"), { link, unlink, pin });

    expect(link).toHaveBeenCalledTimes(1);
    expect(unlink).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
  });

  it("returns true when a handler ran", () => {
    expect(
      dnd.$handle(createNote("1"), { $key: "pinsButton" }, { pin: () => {} }),
    ).toBe(true);
  });

  it("returns false when nothing matches", () => {
    const pin = vi.fn();

    expect(dnd.$handle(createNote("1"), createTag("1"), { pin })).toBe(false);
    expect(pin).not.toHaveBeenCalled();
  });

  it("returns false when the matched intent has no handler", () => {
    expect(
      dnd.$handle(createNote("1"), { $key: "pinsButton" }, { link: () => {} }),
    ).toBe(false);
  });

  it("ignores handler-shaped properties inherited from Object.prototype", () => {
    const withBuiltinIntent = dndcraft()
      .entity({ key: "item" })
      .rule({ source: "item", target: "item", evaluate: () => "toString" })
      .build();

    // `{}` inherits a `toString` function; it must not be treated as a handler.
    expect(
      withBuiltinIntent.$handle({ $key: "item" }, { $key: "item" }, {}),
    ).toBe(false);
  });

  it("evaluates the rule once per call", () => {
    const { dnd: spyDnd, evaluate } = createSpyRegistry();

    spyDnd.$handle(
      { $key: "note", id: "1" },
      { $key: "note", id: "2" },
      {
        link: () => {},
      },
    );

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("lets errors thrown by a handler propagate", () => {
    // Swallowing them would hide bugs in app code.
    expect(() =>
      dnd.$handle(createNote("1"), createNote("2"), {
        link: () => {
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
  });
});

// ============================================================================
// $canDrop
// ============================================================================

describe("$canDrop", () => {
  it("agrees with $evaluate for every pair", () => {
    const dnd = createTestRegistry();
    const samples: unknown[] = [
      createNote("1"),
      createNote("2", ["1"]),
      createNotebook("1"),
      createNotebook("2"),
      createTag("1"),
      { $key: "pinsButton" },
      { $key: "favoritesButton" },
      { $key: "unknown" },
      null,
    ];

    for (const source of samples) {
      for (const target of samples) {
        expect(dnd.$canDrop(source, target)).toBe(
          dnd.$evaluate(source, target) !== null,
        );
      }
    }
  });
});

// ============================================================================
// $keyOf
// ============================================================================

describe("$keyOf", () => {
  const dnd = createTestRegistry();

  it("returns the entity key of registered data", () => {
    expect(dnd.$keyOf(createNote("1"))).toBe("note");
    expect(dnd.$keyOf(dnd.pinsButton.$data())).toBe("pinsButton");
  });

  it("returns undefined for unregistered keys", () => {
    expect(dnd.$keyOf({ $key: "unknown" })).toBeUndefined();
    // Inherited names must not count as registered
    expect(dnd.$keyOf({ $key: "toString" })).toBeUndefined();
    expect(dnd.$keyOf({ $key: "__proto__" })).toBeUndefined();
  });

  it("returns undefined for non-objects", () => {
    for (const value of [null, undefined, "note", 1, true]) {
      expect(dnd.$keyOf(value)).toBeUndefined();
    }
  });

  it("returns undefined when $key is missing or not a string", () => {
    expect(dnd.$keyOf({})).toBeUndefined();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(dnd.$keyOf({ key: "note" })).toBeUndefined();
    warn.mockRestore();
    expect(dnd.$keyOf({ $key: 1 })).toBeUndefined();
    expect(dnd.$keyOf({ $key: { toString: () => "note" } })).toBeUndefined();
  });

  it("agrees with $is for every entity", () => {
    const values = [
      createNote("1"),
      createNotebook("1"),
      createTag("1"),
      dnd.pinsButton.$data(),
      dnd.favoritesButton.$data(),
      { $key: "unknown" },
    ];
    for (const value of values) {
      for (const key of dnd.$entities) {
        const slot = dnd[key as keyof typeof dnd.$keys];
        expect(slot.$is(value)).toBe(dnd.$keyOf(value) === key);
      }
    }
  });
});

// ============================================================================
// Hand-built data warning
// ============================================================================

describe("hand-built data warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const silence = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("warns once per key when data has `key` instead of `$key`", () => {
    const warn = silence();
    const dnd = createTestRegistry();
    const handBuilt = { key: "note", id: "1" };

    expect(dnd.note.$is(handBuilt)).toBe(false);
    expect(dnd.$keyOf(handBuilt)).toBeUndefined();
    expect(dnd.$evaluate(handBuilt, dnd.pinsButton.$data())).toBeNull();
    expect(dnd.$canDrop(handBuilt, dnd.pinsButton.$data())).toBe(false);
    expect(
      dnd.$handle(handBuilt, dnd.pinsButton.$data(), { pin: () => {} }),
    ).toBe(false);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('{ key: "note" } has no $key');
    expect(warn.mock.calls[0]?.[0]).toContain("dnd.note.$data(...)");

    dnd.$keyOf({ key: "pinsButton" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn for data it recognizes or does not own", () => {
    const warn = silence();
    const dnd = createTestRegistry();

    dnd.$keyOf(createNote("1"));
    dnd.$keyOf(dnd.pinsButton.$data());
    // Another drop target's data, not managed by dndcraft
    dnd.$evaluate(createNote("1"), { id: "body", entity: "body" });
    // `key` that isn't a registered entity
    dnd.$keyOf({ key: "unknown" });
    // `$key` present, even if invalid: not the hand-built mistake
    dnd.$keyOf({ $key: 1, key: "note" });
    dnd.$keyOf({ $key: "unknown", key: "note" });
    // Non-objects and inherited names
    dnd.$keyOf("note");
    dnd.$keyOf(null);
    dnd.$keyOf({ key: "toString" });

    expect(warn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Builder
// ============================================================================

describe("builder", () => {
  it("never mutates earlier builders, so they can be branched", () => {
    const base = dndcraft().entity({ key: "note" });
    const withTag = base.entity({ key: "tag" });
    const withRule = base.rule({
      source: "note",
      target: "note",
      evaluate: () => "link",
    });

    const baseDnd = base.build();

    expect(baseDnd.$entities).toEqual(["note"]);
    expect(baseDnd.$rules).toEqual([]);
    expect(baseDnd.$canDrop({ $key: "note" }, { $key: "note" })).toBe(false);

    expect(withTag.build().$entities).toEqual(["note", "tag"]);
    expect(withTag.build().$rules).toEqual([]);

    expect(withRule.build().$entities).toEqual(["note"]);
    expect(withRule.build().$canDrop({ $key: "note" }, { $key: "note" })).toBe(
      true,
    );
  });

  it("lets a branch override a rule without affecting the base", () => {
    const base = dndcraft()
      .entity({ key: "note" })
      .entity({ key: "notebook" })
      .rule({ source: "note", target: "notebook", evaluate: () => "move" });
    const readOnly = base.rule({
      source: "note",
      target: "notebook",
      evaluate: () => null,
    });

    const note = { $key: "note" };
    const notebook = { $key: "notebook" };

    expect(base.build().$evaluate(note, notebook)?.intent).toBe("move");
    expect(readOnly.build().$evaluate(note, notebook)).toBeNull();
  });

  it("throws for entity keys starting with $", () => {
    // @ts-expect-error simulates a JS caller bypassing the types
    expect(() => dndcraft().entity({ key: "$canDrop" })).toThrow(
      'dndcraft: entity key "$canDrop" cannot start with "$"',
    );
  });

  it("allows $ anywhere but the start of a key", () => {
    expect(dndcraft().entity({ key: "price$" }).build().$entities).toEqual([
      "price$",
    ]);
  });

  it("throws for __proto__ as an entity key", () => {
    // @ts-expect-error simulates a JS caller bypassing the types
    expect(() => dndcraft().entity({ key: "__proto__" })).toThrow(
      'dndcraft: "__proto__" cannot be used as an entity key',
    );
  });

  it("throws for duplicate entity keys", () => {
    const withNote = dndcraft().entity({ key: "note" });

    // @ts-expect-error simulates a JS caller bypassing the types
    expect(() => withNote.entity({ key: "note" })).toThrow(
      'dndcraft: entity "note" is already registered',
    );
  });

  it("allows the same key in separate branches", () => {
    const base = dndcraft();

    expect(() => {
      base.entity({ key: "note" });
      base.entity({ key: "note" });
    }).not.toThrow();
  });
});
