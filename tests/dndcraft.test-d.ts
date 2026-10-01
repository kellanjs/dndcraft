/**
 * Type-level tests. These never run — they are checked by the TypeScript
 * compiler (`npm run type:test`). A test "fails" when the file stops compiling:
 *
 * - `expectTypeOf(x).toEqualTypeOf<T>()` errors unless `x` is exactly `T`.
 * - `// @ts-expect-error` errors if the next line does NOT have a type error,
 *   so it proves that bad code is rejected.
 */
import { describe, expectTypeOf, it } from "vitest";

import {
  type EntityOf,
  type ExhaustiveHandlersOf,
  type HandlersOf,
  type IntentOf,
  type KeyOf,
  type PayloadOf,
  type ShapelessKeyOf,
  dndcraft,
} from "../src/index.js";

// ============================================================================
// Fixture
// ============================================================================

type NoteShape = { id: string; title: string };

// Stand-ins for Pragmatic's `source.data` / `target.data`. `$evaluate` and
// `$handle` accept `unknown` (drag data can't be trusted), and handler types
// come from the registry, not from these arguments. This file is only
// type-checked, never run, so they don't need real values.
declare const source: unknown;
declare const target: unknown;

const dnd = dndcraft()
  .entity({ key: "note", shape: {} as NoteShape, getId: (n) => n.id })
  .entity({ key: "pinsButton" })
  .rule({ source: "note", target: "pinsButton", evaluate: () => "pin" })
  .rule({ source: "note", target: "note", evaluate: () => "link" })
  .build();

// ============================================================================
// Unknown keys are rejected
// ============================================================================

describe("unknown entity keys", () => {
  it("rejects a rule whose source is not a registered entity", () => {
    dndcraft()
      .entity({ key: "note" })
      // @ts-expect-error "nte" is a typo for "note"
      .rule({ source: "nte", target: "note", evaluate: () => "x" });
  });

  it("rejects a rule whose target is not a registered entity", () => {
    dndcraft()
      .entity({ key: "note" })
      // @ts-expect-error "nope" is not registered
      .rule({ source: "note", target: "nope", evaluate: () => "x" });
  });

  it("rejects unknown $keys", () => {
    // @ts-expect-error "doesNotExist" is not registered
    void dnd.$keys.doesNotExist;
  });

  it("rejects unknown entity slots", () => {
    // @ts-expect-error "doesNotExist" is not registered
    void dnd.doesNotExist;
  });

  it("types $keys as exactly the registered keys", () => {
    expectTypeOf(dnd.$keys).toEqualTypeOf<{
      note: "note";
      pinsButton: "pinsButton";
    }>();
  });
});

// ============================================================================
// Entities without a shape
// ============================================================================

describe("shapeless entities", () => {
  it("only expose `key`, and reject any other property", () => {
    const value: unknown = {};
    if (dnd.pinsButton.$is(value)) {
      expectTypeOf(value.$key).toEqualTypeOf<"pinsButton">();
      // @ts-expect-error shapeless entities have no other properties
      void value.label;
    }
  });
});

// ============================================================================
// Narrowing
// ============================================================================

describe("narrowing", () => {
  it("$is narrows unknown to the entity type", () => {
    const value: unknown = {};
    if (dnd.note.$is(value)) {
      expectTypeOf(value).toEqualTypeOf<{
        $key: "note";
        id: string;
        title: string;
      }>();
    }
  });

  it("checking the intent narrows source and target", () => {
    const p = dnd.$evaluate(source, target);
    if (p === null) return;

    expectTypeOf(p.intent).toEqualTypeOf<"pin" | "link">();

    if (p.intent === "pin") {
      expectTypeOf(p.source.title).toEqualTypeOf<string>();
      expectTypeOf(p.target.$key).toEqualTypeOf<"pinsButton">();
    }
    if (p.intent === "link") {
      expectTypeOf(p.target.title).toEqualTypeOf<string>();
    }
  });

  it("$is narrows to the same type EntityOf names", () => {
    const value: unknown = {};
    if (dnd.note.$is(value)) {
      expectTypeOf(value).toEqualTypeOf<EntityOf<typeof dnd, "note">>();
    }
  });

  it("getId receives the entity shape", () => {
    dndcraft().entity({
      key: "note",
      shape: {} as NoteShape,
      // @ts-expect-error NoteShape has no `uuid`
      getId: (n) => n.uuid,
    });
  });
});

// ============================================================================
// Data constructors ($data) and EntityOf
// ============================================================================

describe("$data", () => {
  it("returns the full entity type, key included", () => {
    const note = dnd.note.$data({ id: "1", title: "Hello" });

    expectTypeOf(note).toEqualTypeOf<EntityOf<typeof dnd, "note">>();
    expectTypeOf(note.$key).toEqualTypeOf<"note">();
  });

  it("requires the shape when it has required fields", () => {
    // @ts-expect-error the note shape is required
    dnd.note.$data();
  });

  it("rejects missing fields", () => {
    // @ts-expect-error `title` is missing
    dnd.note.$data({ id: "1" });
  });

  it("rejects fields with the wrong type", () => {
    // @ts-expect-error `id` must be a string
    dnd.note.$data({ id: 1, title: "Hello" });
  });

  it("rejects unknown fields", () => {
    // @ts-expect-error `color` is not part of the note shape
    dnd.note.$data({ id: "1", title: "Hello", color: "red" });
  });

  it("rejects `$key`, which the constructor adds itself", () => {
    // @ts-expect-error `$key` is not part of the shape
    dnd.note.$data({ id: "1", title: "Hello", $key: "note" });
  });

  it("takes no argument for shapeless entities", () => {
    expectTypeOf(dnd.pinsButton.$data().$key).toEqualTypeOf<"pinsButton">();

    // @ts-expect-error shapeless entities accept no fields
    dnd.pinsButton.$data({ label: "Pins" });
  });

  it("makes the shape optional when all of its fields are optional", () => {
    const withOptional = dndcraft()
      .entity({ key: "item", shape: {} as { id?: string } })
      .build();

    expectTypeOf(withOptional.item.$data().$key).toEqualTypeOf<"item">();
    expectTypeOf(withOptional.item.$data({ id: "1" }).id).toEqualTypeOf<
      string | undefined
    >();
  });
});

describe("EntityOf", () => {
  it("names an entity's full data type, flattened into one object", () => {
    expectTypeOf<EntityOf<typeof dnd, "note">>().toEqualTypeOf<{
      $key: "note";
      id: string;
      title: string;
    }>();
  });

  it("works with interface shapes where Record<string, unknown> is expected", () => {
    // Interfaces have no implicit index signature, so without flattening this
    // would fail. Pragmatic's getData/getInitialData expect this type.
    interface CardShape {
      id: string;
    }
    const cards = dndcraft()
      .entity({ key: "card", shape: {} as CardShape })
      .build();

    expectTypeOf(cards.card.$data({ id: "1" })).toExtend<
      Record<string, unknown>
    >();
  });

  it("rejects unknown entity keys", () => {
    // @ts-expect-error "doesNotExist" is not registered
    expectTypeOf<EntityOf<typeof dnd, "doesNotExist">>();
  });

  it("rejects registry members that are not entities", () => {
    // @ts-expect-error `$evaluate` is a registry method, not an entity
    expectTypeOf<EntityOf<typeof dnd, "$evaluate">>();
  });
});

// ============================================================================
// $keyOf
// ============================================================================

describe("$keyOf", () => {
  it("returns a registered key or undefined", () => {
    expectTypeOf(dnd.$keyOf(source)).toEqualTypeOf<
      "note" | "pinsButton" | undefined
    >();
  });

  it("can be switched over, and rejects unknown keys", () => {
    switch (dnd.$keyOf(target)) {
      case "note":
      case "pinsButton":
      case undefined:
        break;
      // @ts-expect-error "notebook" is not an entity in this registry
      case "notebook":
        break;
    }
  });
});

// ============================================================================
// $evaluate and $handle
// ============================================================================

describe("$evaluate", () => {
  it("returns the payload union or null", () => {
    type Payload = NonNullable<ReturnType<typeof dnd.$evaluate>>;

    expectTypeOf(dnd.$evaluate(source, target)).toEqualTypeOf<Payload | null>();
    expectTypeOf<Payload["intent"]>().toEqualTypeOf<"pin" | "link">();
  });

  it("must be null-checked before use", () => {
    // @ts-expect-error the result may be null
    void dnd.$evaluate(source, target).intent;
  });
});

describe("$handle", () => {
  it("narrows each handler's payload to its intent", () => {
    dnd.$handle(source, target, {
      pin: (p) => {
        expectTypeOf(p.intent).toEqualTypeOf<"pin">();
        expectTypeOf(p.source.title).toEqualTypeOf<string>();
        expectTypeOf(p.target.$key).toEqualTypeOf<"pinsButton">();
      },
      link: (p) => {
        expectTypeOf(p.intent).toEqualTypeOf<"link">();
        expectTypeOf(p.target.title).toEqualTypeOf<string>();
      },
    });
  });

  it("allows handling only some intents (or none)", () => {
    dnd.$handle(source, target, { pin: () => {} });
    dnd.$handle(source, target, {});
  });

  it("rejects handlers for unknown intents", () => {
    // @ts-expect-error "pinn" is a typo for "pin"
    dnd.$handle(source, target, { pinn: () => {} });
  });

  it("accepts async handlers", () => {
    dnd.$handle(source, target, { pin: async () => {} });
  });

  it("returns whether a handler ran", () => {
    expectTypeOf(dnd.$handle(source, target, {})).toEqualTypeOf<boolean>();
  });

  it("gives a union payload when several rules share an intent", () => {
    const shared = dndcraft()
      .entity({ key: "note", shape: {} as NoteShape })
      .entity({ key: "tag", shape: {} as { label: string } })
      .entity({ key: "trash" })
      .rule({ source: "note", target: "trash", evaluate: () => "delete" })
      .rule({ source: "tag", target: "trash", evaluate: () => "delete" })
      .build();

    shared.$handle(source, target, {
      delete: (p) => {
        expectTypeOf(p.source.$key).toEqualTypeOf<"note" | "tag">();

        // Narrow further by checking the source entity.
        if (shared.note.$is(p.source)) {
          expectTypeOf(p.source.title).toEqualTypeOf<string>();
        }
      },
    });
  });
});

// ============================================================================
// Entity key validation
// ============================================================================

describe("entity key validation", () => {
  it("rejects keys starting with $", () => {
    // @ts-expect-error `$` is reserved for registry members
    dndcraft().entity({ key: "$evaluate" });
  });

  it("rejects duplicate keys", () => {
    dndcraft()
      .entity({ key: "note" })
      // @ts-expect-error "note" is already registered
      .entity({ key: "note" });
  });

  it("rejects keys typed as plain `string`", () => {
    const name: string = "note";
    // @ts-expect-error `string` would make every entity name valid
    dndcraft().entity({ key: name });
  });

  it("rejects __proto__", () => {
    // @ts-expect-error `__proto__` can't be an object property
    dndcraft().entity({ key: "__proto__" });
  });

  it("allows `$` in the middle of a key", () => {
    const withDollar = dndcraft().entity({ key: "price$" }).build();
    expectTypeOf(withDollar.$keys).toEqualTypeOf<{ price$: "price$" }>();
  });
});

// ============================================================================
// Shape validation
// ============================================================================

describe("shape validation", () => {
  it("rejects shapes with a `$key` field, which `$data` would overwrite", () => {
    // @ts-expect-error `$key` is where dndcraft stores the entity key
    dndcraft().entity({ key: "row", shape: {} as { $key: string } });
  });

  it("rejects an optional `$key` on an interface", () => {
    interface Row {
      $key?: number;
      id: string;
    }
    // @ts-expect-error `$key` is where dndcraft stores the entity key
    dndcraft().entity({ key: "row", shape: {} as Row });
  });

  it("keeps a shape's own `key` field", () => {
    const rows = dndcraft()
      .entity({ key: "row", shape: {} as { key: string; id: string } })
      .build();

    expectTypeOf(rows.row.$data({ key: "k1", id: "1" })).toEqualTypeOf<{
      $key: "row";
      key: string;
      id: string;
    }>();
  });

  it("allows shapes with an index signature", () => {
    const loose = dndcraft()
      .entity({ key: "loose", shape: {} as Record<string, unknown> })
      .build();
    expectTypeOf(loose.$keys).toEqualTypeOf<{ loose: "loose" }>();
  });
});

// ============================================================================
// Overriding a rule
// ============================================================================

describe("overriding a rule", () => {
  const overridden = dndcraft()
    .entity({ key: "item" })
    .entity({ key: "bin" })
    .rule({ source: "item", target: "item", evaluate: () => "first" })
    .rule({ source: "item", target: "bin", evaluate: () => "trash" })
    .rule({ source: "item", target: "item", evaluate: () => "second" })
    .build();

  it("replaces the earlier rule's intents in the types", () => {
    type Intent = IntentOf<typeof overridden>;
    expectTypeOf<Intent>().toEqualTypeOf<"trash" | "second">();
  });

  it("rejects handlers for the replaced intent", () => {
    // @ts-expect-error "first" was overridden by "second"
    overridden.$handle(source, target, { first: () => {} });
  });
});

// ============================================================================
// Intent inference edge cases
// ============================================================================

describe("intent inference", () => {
  it("adds no intents for a rule that only returns null", () => {
    const withRejectingRule = dndcraft()
      .entity({ key: "item" })
      .entity({ key: "bin" })
      .rule({ source: "item", target: "bin", evaluate: () => "trash" })
      .rule({ source: "item", target: "item", evaluate: () => null })
      .build();

    type Intent = IntentOf<typeof withRejectingRule>;
    expectTypeOf<Intent>().toEqualTypeOf<"trash">();

    // @ts-expect-error intents must not have widened to `string`
    withRejectingRule.$handle(source, target, { anything: () => {} });
  });

  it("removes an intent when a branch overrides its rule with null", () => {
    const base = dndcraft()
      .entity({ key: "note" })
      .entity({ key: "notebook" })
      .rule({ source: "note", target: "notebook", evaluate: () => "move" });
    const readOnly = base
      .rule({ source: "note", target: "notebook", evaluate: () => null })
      .build();

    // @ts-expect-error "move" no longer exists in the read-only branch
    readOnly.$handle(source, target, { move: () => {} });
  });

  it("keeps literal intents from ternaries and template strings", () => {
    const edge = "left" as "left" | "right";
    const tabs = dndcraft()
      .entity({ key: "tab", shape: {} as { pinned: boolean } })
      .entity({ key: "bin" })
      .rule({ source: "tab", target: "tab", evaluate: () => `move-${edge}` })
      .rule({
        source: "tab",
        target: "bin",
        evaluate: (tab) => (tab.pinned ? null : "trash"),
      })
      .build();

    expectTypeOf<IntentOf<typeof tabs>>().toEqualTypeOf<
      "move-left" | "move-right" | "trash"
    >();
    // @ts-expect-error intents are still checked
    tabs.$handle(source, target, { "move-up": () => {} });
  });

  it("rejects building a registry whose rule returns plain `string`", () => {
    const computed: string = "trash";
    const wide = dndcraft()
      .entity({ key: "item" })
      .entity({ key: "bin" })
      .rule({ source: "item", target: "bin", evaluate: () => computed });

    // @ts-expect-error `string` would make every handler name valid
    wide.build();

    // Also when `string` comes from an annotation
    const annotated = dndcraft()
      .entity({ key: "item" })
      .rule({
        source: "item",
        target: "item",
        evaluate: (): string | null => null,
      });

    // @ts-expect-error `string` would make every handler name valid
    annotated.build();
  });

  it("rejects building a registry whose rule returns `any`", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the case under test
    const loose: any = "trash";
    const wide = dndcraft()
      .entity({ key: "item" })
      .rule({ source: "item", target: "item", evaluate: () => loose });

    // @ts-expect-error `any` would make every handler name valid
    wide.build();
  });

  it("builds again once a branch overrides the `string` rule", () => {
    const computed: string = "trash";
    const fixed = dndcraft()
      .entity({ key: "item" })
      .entity({ key: "bin" })
      .rule({ source: "item", target: "bin", evaluate: () => computed })
      .rule({ source: "item", target: "bin", evaluate: () => "trash" })
      .build();

    expectTypeOf<IntentOf<typeof fixed>>().toEqualTypeOf<"trash">();
    // @ts-expect-error intents are checked again
    fixed.$handle(source, target, { trsh: () => {} });
  });
});

// ============================================================================
// Helper types: PayloadOf, IntentOf, HandlersOf
// ============================================================================

describe("helper types", () => {
  it("PayloadOf is the non-null result of $evaluate", () => {
    expectTypeOf<PayloadOf<typeof dnd> | null>().toEqualTypeOf(
      dnd.$evaluate(source, target),
    );
  });

  it("IntentOf is the union of every intent", () => {
    expectTypeOf<IntentOf<typeof dnd>>().toEqualTypeOf<"pin" | "link">();
  });

  it("IntentOf is never for a registry without rules", () => {
    const _noRules = dndcraft().entity({ key: "item" }).build();
    expectTypeOf<IntentOf<typeof _noRules>>().toEqualTypeOf<never>();
  });

  it("HandlersOf types a handler map built outside the call", () => {
    const handlers: HandlersOf<typeof dnd> = {
      pin: (p) => {
        expectTypeOf(p.target.$key).toEqualTypeOf<"pinsButton">();
      },
    };

    dnd.$handle(source, target, handlers);
  });

  it("HandlersOf rejects unknown intents", () => {
    const handlers: HandlersOf<typeof dnd> = {
      // @ts-expect-error "pinn" is a typo for "pin"
      pinn: () => {},
    };
    void handlers;
  });

  it("makes exhaustive handling possible with `satisfies Required<...>`", () => {
    // Every intent handled: compiles.
    const all = {
      pin: () => {},
      link: () => {},
    } satisfies Required<HandlersOf<typeof dnd>>;
    dnd.$handle(source, target, all);

    // @ts-expect-error "link" is missing
    const missing = { pin: () => {} } satisfies Required<
      HandlersOf<typeof dnd>
    >;
    void missing;

    // Intents handled elsewhere can be excluded explicitly.
    const allButLink = { pin: () => {} } satisfies Required<
      Omit<HandlersOf<typeof dnd>, "link">
    >;
    dnd.$handle(source, target, allButLink);
  });
});

// ============================================================================
// KeyOf and ShapelessKeyOf
// ============================================================================

describe("KeyOf and ShapelessKeyOf", () => {
  const mixed = dndcraft()
    .entity({ key: "note", shape: {} as { id: string } })
    .entity({ key: "settings", shape: {} as { tab?: string } })
    .entity({ key: "loose", shape: {} as Record<string, unknown> })
    .entity({ key: "pinsZone" })
    .entity({ key: "trash" })
    .build();

  it("KeyOf is every entity key", () => {
    expectTypeOf<KeyOf<typeof mixed>>().toEqualTypeOf<
      "note" | "settings" | "loose" | "pinsZone" | "trash"
    >();
  });

  it("ShapelessKeyOf is only the entities registered without a shape", () => {
    expectTypeOf<ShapelessKeyOf<typeof mixed>>().toEqualTypeOf<
      "pinsZone" | "trash"
    >();
  });

  it("ShapelessKeyOf works as a prop for reusable drop targets", () => {
    const dataFor = (dndKey: ShapelessKeyOf<typeof mixed>) =>
      mixed[dndKey].$data();

    dataFor("pinsZone");
    // @ts-expect-error "note" needs data, so it isn't shapeless
    dataFor("note");
  });

  it("is never for a registry with no entities", () => {
    const empty = dndcraft().build();
    expectTypeOf<KeyOf<typeof empty>>().toEqualTypeOf<never>();
    expectTypeOf<ShapelessKeyOf<typeof empty>>().toEqualTypeOf<never>();
    expectTypeOf(empty.$keyOf(source)).toEqualTypeOf<undefined>();
  });
});

// ============================================================================
// ExhaustiveHandlersOf
// ============================================================================

describe("ExhaustiveHandlersOf", () => {
  it("accepts a map that handles every intent, with narrowed payloads", () => {
    const handlers = {
      pin: (p) => {
        expectTypeOf(p.target.$key).toEqualTypeOf<"pinsButton">();
      },
      link: (p) => {
        expectTypeOf(p.target.$key).toEqualTypeOf<"note">();
      },
    } satisfies ExhaustiveHandlersOf<typeof dnd>;
    dnd.$handle(source, target, handlers);
  });

  it("rejects a map with a missing intent", () => {
    const handlers = {
      pin: () => {},
      // @ts-expect-error "link" has no handler
    } satisfies ExhaustiveHandlersOf<typeof dnd>;
    void handlers;
  });

  it("lets listed intents be handled elsewhere", () => {
    const handlers = {
      pin: () => {},
    } satisfies ExhaustiveHandlersOf<typeof dnd, "link">;
    void handlers;
  });

  it("rejects misspelled or stale exclusions", () => {
    // @ts-expect-error "lnk" is not an intent of this registry
    type Stale = ExhaustiveHandlersOf<typeof dnd, "lnk">;
    expectTypeOf<Stale>().not.toBeNever();
  });

  it("rejects misspelled handler names", () => {
    const handlers = {
      pin: () => {},
      link: () => {},
      // @ts-expect-error "pinn" is not an intent
      pinn: () => {},
    } satisfies ExhaustiveHandlersOf<typeof dnd>;
    void handlers;
  });
});

// ============================================================================
// Entity ids
// ============================================================================

describe("getId", () => {
  it("accepts string and number ids", () => {
    dndcraft().entity({
      key: "row",
      shape: {} as { index: number },
      getId: (r) => r.index,
    });
    dndcraft().entity({
      key: "note",
      shape: {} as { id: string },
      getId: (n) => n.id,
    });
  });

  it("rejects other id types", () => {
    dndcraft().entity({
      key: "flag",
      shape: {} as { on: boolean },
      // @ts-expect-error ids must be strings or numbers
      getId: (f) => f.on,
    });
  });
});
