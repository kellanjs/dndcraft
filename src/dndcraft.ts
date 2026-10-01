/**
 * # DNDCRAFT
 *
 * Type-safe drag-and-drop registry builder with automatic type narrowing.
 *
 * @example
 * ```ts
 * const dnd = dndcraft()
 *   .entity({ key: "note", shape: {} as NoteShape, getId: n => n.id })
 *   .entity({ key: "pinsButton" })
 *   .rule({ source: "note", target: "pinsButton", evaluate: () => "pin" })
 *   .build();
 *
 * // Producing data (type-checked against NoteShape):
 * draggable({ element, getInitialData: () => dnd.note.$data(note) });
 * dropTargetForElements({ element, getData: () => dnd.pinsButton.$data() });
 *
 * // Handling a drop (in a monitor or a drop target's onDrop):
 * dnd.$handle(source.data, target.data, {
 *   pin: (p) => pinNote(p.source.id), // p.source is typed as NoteShape
 * });
 *
 * // Asking what a drop would mean (e.g. for hover feedback):
 * const intent = dnd.$evaluate(source, target)?.intent; // "pin" | undefined
 * ```
 *
 * @remarks
 * - Entities are identified by a `$key` property on the data object
 * - `dnd.<entity>.$data()` builds that data, so producers are type-checked too
 * - Rules define valid source→target pairs and return an intent string
 * - `$handle` routes each intent to its handler with narrowed types
 */

// =============================================================================
// Internal Types
// =============================================================================

/**
 * An object type with no known keys (`keyof Empty` is `never`).
 *
 * Used as the starting point for type accumulators. Do NOT use
 * `Record<string, never>` for this: its index signature means it "has" every
 * string key, so `keyof` becomes `string` and any intersection built on top
 * of it silently accepts unknown keys (typos in rules, `$keys`, entity slots).
 */
type Empty = Record<never, never>;

/**
 * Flattens an intersection like `{ $key: "note" } & NoteShape` into one object
 * type (`{ $key: "note"; id: string; ... }`).
 *
 * Besides reading better in hovers, this matters for compatibility: an
 * anonymous object type counts as having an implicit index signature, but an
 * `interface` does not. Without flattening, an entity whose shape is an
 * interface wouldn't be assignable to `Record<string, unknown>`, which is
 * what Pragmatic's `getData` / `getInitialData` expect.
 *
 * The `& {}` changes nothing about the type. It stops TypeScript from
 * printing `Simplify<...>` by name in hovers and errors, so they show the
 * flattened properties instead. (`& Empty` doesn't have that effect.)
 */
type Simplify<T> = { [P in keyof T]: T[P] } & {};

/**
 * Arguments for an entity's `$data` constructor.
 *
 * - No shape at all → no argument (`dnd.pinsButton.$data()`). This can't just
 *   be an optional `{}` argument: TypeScript skips excess-property checks
 *   against an empty object type, so `$data({ anything: 1 })` would pass.
 * - Every field optional → optional argument. `Empty extends TShape` asks
 *   "would an empty object be a valid shape?".
 * - Otherwise → required argument.
 */
type DataArgs<TShape> = keyof TShape extends never
  ? []
  : Empty extends TShape
    ? [shape?: TShape]
    : [shape: TShape];

/**
 * Compile-time validation for a new entity key, used as `key: K & KeyCheck`.
 *
 * - Valid key → `unknown`, and `K & unknown` is just `K` (no constraint).
 * - Invalid key → an object type holding a message. No string literal is
 *   assignable to `K & { error: ... }`, so the call fails and the compiler
 *   prints the message inside the expected type.
 *   Messages quote names with single quotes: the compiler prints them inside
 *   a string literal type, where double quotes come out escaped (`\"note\"`).
 *
 * Rejected keys:
 * - A plain `string` (e.g. a key read from a variable). `keyof` the registry
 *   would become `string`, so every entity name, including typos in rules,
 *   would be accepted everywhere.
 * - Keys starting with `$`, which would collide with registry members
 *   (`$evaluate`, `$keys`...), since entity slots live on the same object.
 * - `__proto__`: assigning it to an object sets the prototype instead of
 *   creating a property, so the entity's slot would silently not exist.
 */
type KeyCheck<K extends string, TEntities> = string extends K
  ? { error: "Entity keys must be string literals, not type 'string'" }
  : K extends `$${string}`
    ? {
        error: "Entity keys cannot start with '$' (reserved for registry members)";
      }
    : K extends "__proto__"
      ? { error: "'__proto__' cannot be used as an entity key" }
      : K extends keyof TEntities
        ? { error: `Entity '${K}' is already registered` }
        : unknown;

/**
 * Compile-time validation for an entity's shape, used as `shape: E & ShapeCheck`
 * (same technique as `KeyCheck`).
 *
 * `$key` is where the entity key is stored in the data, so a shape field with
 * that name would be silently overwritten by `$data`. Shapes with an index
 * signature (`Record<string, unknown>`) can't be told apart from shapes that
 * really declare `$key`, so they are allowed.
 */
type ShapeCheck<E> = string extends keyof E
  ? unknown
  : "$key" extends keyof E
    ? {
        error: "Entity shapes cannot have a '$key' field (dndcraft stores the entity key there)";
      }
    : unknown;

/**
 * One error message per rule whose intents widened to plain `string` or to
 * `any` (`never` if there are none).
 *
 * `any` gets its own message because its usual cause is a config problem, not
 * the rule: with `strictNullChecks` off, TypeScript widens `null` to `any`, so
 * a rule that only returns `null` would otherwise be reported as `string`.
 * (`0 extends 1 & I` is only true when `I` is `any`, and `null extends string`
 * is only true when `strictNullChecks` is off.)
 */
type WideIntentRules<TPayloads> = TPayloads extends {
  source: { $key: infer S extends string };
  target: { $key: infer T extends string };
  intent: infer I;
}
  ? 0 extends 1 & I
    ? `Rule '${S}' → '${T}' returns type 'any'. Intents must be string literals${NullHint}`
    : string extends I
      ? `Rule '${S}' → '${T}' returns type 'string'. Intents must be string literals`
      : never
  : never;

/** Advice appended to `any` errors, only when `strictNullChecks` is off. */
type NullHint = null extends string
  ? " (with strictNullChecks off, 'null' becomes 'any': enable 'strict')"
  : "";

/**
 * The type of `.build`: a normal function, or, when a rule's intents widened
 * to `string`, an object holding the error message. Calling that object fails
 * with "This expression is not callable", followed directly by the message.
 * (Checking through a `this` parameter also works, but TypeScript then prints
 * the whole builder type, twice, before the message.)
 *
 * Intents are collected into a union of string literals, and that union is
 * what makes handler maps checkable. A rule returning a plain `string` (e.g. a
 * computed value) adds `string` to the union, so every intent name would be
 * accepted and misspelled handlers would compile.
 *
 * This can't be checked in `.rule()`: any extra use of the intent type there
 * changes how TypeScript infers it, and literal intents like
 * `isPinned ? "unpin" : "pin"` widen to `string`. By `.build()`, every intent
 * has already been inferred, so checking them is free.
 */
type BuildFn<
  TEntities extends Record<string, { $key: string }>,
  TPayloads extends RulePayload<unknown, unknown, string>,
> = [WideIntentRules<TPayloads>] extends [never]
  ? () => Registry<TEntities, TPayloads>
  : { error: WideIntentRules<TPayloads> };

/**
 * What `getId` may return. Ids are compared with `===`, so `1` and `"1"` are
 * different ids, and `0` is a valid id (only `undefined` means "no id").
 */
type EntityId = string | number;

/** Runtime representation of an entity: a type guard and a data constructor */
type EntitySlot<T extends { $key: string }> = {
  /** Type guard to check if an object matches this entity */
  $is: (obj: unknown) => obj is T;

  /**
   * Create this entity's drag/drop data. The shape is type-checked against
   * the entity's registered shape, and `$key` is added for you.
   *
   * @example
   * ```ts
   * draggable({ element, getInitialData: () => dnd.note.$data({ id, title }) });
   * dropTargetForElements({ element, getData: () => dnd.pinsButton.$data() });
   * ```
   */
  $data: (...args: DataArgs<Simplify<Omit<T, "$key">>>) => T;
};

/** Internal function signature for rule evaluation */
type EvaluateFn = (source: unknown, target: unknown) => string | null;

/**
 * Distributive conditional type that creates a union of payloads.
 * Each rule contributes one member to the union with its specific types.
 */
type RulePayload<S, T, I extends string> = I extends unknown
  ? { source: S; target: T; intent: I }
  : never;

/**
 * A map of intent → handler, passed to `$handle`.
 *
 * For each intent `I`, `Extract` picks the payload union members whose intent
 * is `I`, so every handler receives `source`/`target` already narrowed. All
 * handlers are optional: list only the intents the call site cares about.
 *
 * With no intents at all, the mapped type would be `{}`, and TypeScript skips
 * excess-property checks against `{}`, so any handler map would compile.
 * `Record<string, never>` rejects every handler instead.
 *
 * `[TPayloads] extends [never]` needs the brackets: `TPayloads` is a bare type
 * parameter, so an unwrapped check would distribute over the union. For
 * `never` that always yields `never`; for a real union it would build one
 * handler map per payload instead of a single map covering all of them.
 */
type Handlers<TPayloads extends { intent: string }> = [TPayloads] extends [
  never,
]
  ? Record<string, never>
  : {
      [I in TPayloads["intent"]]?: (
        payload: Extract<TPayloads, { intent: I }>,
      ) => void;
    };

/** Internal rule storage */
type RuleEntry = {
  source: string;
  target: string;
  evaluate: EvaluateFn;
};

/**
 * The `rules` map key for a source→target pair.
 *
 * JSON keeps every pair distinct. Joining with a separator would not: with
 * `"a:b"`→`"c"` and `"a"`→`"b:c"`, both pairs would become `"a:b:c"`, and the
 * second rule would silently replace the first.
 */
const ruleId = (source: string, target: string) =>
  JSON.stringify([source, target]);

/**
 * Internal registry data accumulated during building.
 *
 * `rules` is keyed by `ruleId`. Redefining a pair calls `Map.set` on an
 * existing key, which replaces the entry but keeps its original position, so
 * `$rules` stays in definition order without listing a pair twice.
 */
type RegistryData = {
  entities: Map<string, ((e: unknown) => EntityId | undefined) | undefined>;
  rules: Map<string, RuleEntry>;
};

// =============================================================================
// Registry Factory
// =============================================================================

/**
 * Builds the final registry object from accumulated builder data.
 * This is called internally by Builder.build().
 */
function buildRegistry<
  TEntities extends Record<string, { $key: string }>,
  TPayloads extends RulePayload<unknown, unknown, string>,
>(data: RegistryData): Registry<TEntities, TPayloads> {
  // Create entity slots. Their precise types come from the final cast to
  // Registry; at runtime every slot is the same two functions.
  const slots = {} as Record<string, EntitySlot<{ $key: string }>>;
  // Keys already warned about, so each hand-built shape is reported once.
  const warned = new Set<string>();

  // Data with no `$key` but a `key` naming a registered entity was almost
  // certainly built by hand (or with an older `key`-based format), and would
  // otherwise be silently ignored. The types can't catch it: drag data is a
  // loose record everywhere it's created. Only reached when `$key` is missing,
  // so recognized data pays nothing.
  const warnIfHandBuilt = (record: Record<string, unknown>) => {
    const key = record.key;
    if (typeof key !== "string" || !data.entities.has(key)) return;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(
      `dndcraft: drag data { key: "${key}" } has no $key, so it isn't recognized. Create it with the entity's $data() instead, e.g. dnd.${key}.$data(...).`,
    );
  };

  // The entity key of a value, if it's data for a registered entity. Looking
  // the key up in `entities` (a Map) means inherited names like "toString"
  // can't match. Every entry point ($is, $keyOf, $evaluate, $handle,
  // $canDrop) goes through here.
  const keyOf = (value: unknown): string | undefined => {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const key = record.$key;
    if (typeof key === "string" && data.entities.has(key)) return key;
    if (key === undefined) warnIfHandBuilt(record);
    return undefined;
  };

  for (const [name] of data.entities) {
    slots[name] = {
      // Checks only `$key`, by design: `$data` makes producers type-safe, so
      // full shape validation would only matter for data from outside the app.
      $is: (obj: unknown): obj is { $key: string } => keyOf(obj) === name,
      // `$key` goes last so a shape can never override it.
      $data: (shape?: object) => ({ ...shape, $key: name }),
    };
  }

  // Core evaluation logic
  const evaluateInternal = (
    source: unknown,
    target: unknown,
  ): string | null => {
    const srcKey = keyOf(source);
    const tgtKey = keyOf(target);
    if (srcKey === undefined || tgtKey === undefined) return null;

    // Prevent dropping an entity onto itself (requires getId)
    if (srcKey === tgtKey) {
      const getId = data.entities.get(srcKey);
      if (getId) {
        const srcId = getId(source);
        const tgtId = getId(target);
        if (srcId !== undefined && srcId === tgtId) {
          return null;
        }
      }
    }

    const rule = data.rules.get(ruleId(srcKey, tgtKey));
    if (!rule) return null;

    // Only a string counts as a match. The types already require `I | null`,
    // but a JS caller (or a cast) could return `undefined` or anything else,
    // and that must not be mistaken for a valid intent.
    const intent: unknown = rule.evaluate(source, target);
    return typeof intent === "string" ? intent : null;
  };

  const $evaluate = (source: unknown, target: unknown): TPayloads | null => {
    const intent = evaluateInternal(source, target);
    if (intent === null) return null;
    return { source, target, intent } as unknown as TPayloads;
  };

  const $handle = (
    source: unknown,
    target: unknown,
    handlers: Handlers<TPayloads>,
  ): boolean => {
    const payload = $evaluate(source, target);
    if (payload === null) return false;

    // `hasOwn` guard: without it, an intent like "toString" would find
    // Object.prototype.toString through the prototype chain and call it.
    const handler = Object.hasOwn(handlers, payload.intent)
      ? (handlers[payload.intent as keyof Handlers<TPayloads>] as
          ((payload: TPayloads) => void) | undefined)
      : undefined;
    if (!handler) return false;

    handler(payload);
    return true;
  };

  // Build $keys for autocomplete
  const keys = {} as Record<string, string>;
  for (const [name] of data.entities) {
    keys[name] = name;
  }

  return {
    ...slots,
    $evaluate,
    $handle,
    $canDrop: (s: unknown, t: unknown) => evaluateInternal(s, t) !== null,
    $keyOf: keyOf,
    $keys: keys,
    $entities: Array.from(data.entities.keys()) as readonly string[],
    $rules: Array.from(data.rules.values(), (r) => ({
      source: r.source,
      target: r.target,
    })) as ReadonlyArray<{ source: string; target: string }>,
  } as Registry<TEntities, TPayloads>;
}

/**
 * The built registry type with all entities, rules, and utility methods.
 *
 * @typeParam TEntities - Record of entity keys to their shapes
 * @typeParam TPayloads - Discriminated union of all rule payloads
 */
export type Registry<
  TEntities extends Record<string, { $key: string }>,
  TPayloads extends RulePayload<unknown, unknown, string>,
> = {
  [K in keyof TEntities]: EntitySlot<TEntities[K]>;
} & {
  /**
   * Ask what a drop would mean, without acting on it. Returns the matched
   * payload, or `null` if no rule matches. Useful for hover feedback.
   *
   * @example
   * ```ts
   * const intent = dnd.$evaluate(dragSource, dnd.pinsButton.$data())?.intent;
   * const label = intent === "unpin" ? "Unpin note" : "Pin note";
   * ```
   */
  $evaluate: (source: unknown, target: unknown) => TPayloads | null;

  /**
   * Evaluate a drop and run the handler for its intent, if one is given.
   * Each handler receives a payload narrowed to its intent. Returns `true`
   * if a handler ran, `false` if nothing matched or the intent had no handler.
   *
   * @example
   * ```ts
   * dnd.$handle(source.data, target.data, {
   *   pin: (p) => pinNote(p.source.id),
   *   link: (p) => linkNotes(p.source.id, p.target.id),
   * });
   * ```
   */
  $handle: (
    source: unknown,
    target: unknown,
    handlers: Handlers<TPayloads>,
  ) => boolean;

  /** Returns true if a valid rule exists for the source→target pair */
  $canDrop: (source: unknown, target: unknown) => boolean;

  /**
   * The entity key of a value, or `undefined` if it isn't data for a
   * registered entity. Like `$is`, it only checks `$key`.
   *
   * @example
   * ```ts
   * switch (dnd.$keyOf(target.data)) {
   *   case "note": ...
   *   case "pinsZone": ...
   * }
   * ```
   */
  $keyOf: (value: unknown) => (keyof TEntities & string) | undefined;

  /** Entity key constants for autocomplete (e.g., `dnd.$keys.note`) */
  $keys: { [K in keyof TEntities]: K };

  /** List of all registered entity keys */
  $entities: readonly string[];

  /** List of all registered rules (source→target pairs), in definition order */
  $rules: ReadonlyArray<{ source: string; target: string }>;
};

/**
 * The full data type of one entity in a built registry, including `$key`.
 * Lets the registry stay the single source of truth for entity types.
 *
 * @example
 * ```ts
 * type DndNote = EntityOf<typeof dnd, "note">; // { $key: "note"; ...NoteShape }
 * ```
 */
export type EntityOf<
  TRegistry extends { $keys: object },
  K extends keyof TRegistry["$keys"] & keyof TRegistry,
> = TRegistry[K] extends { $is: (obj: unknown) => obj is infer T } ? T : never;

/** The minimal shape of a built registry, for the helper types below. */
type AnyRegistry = {
  $evaluate: (source: unknown, target: unknown) => { intent: string } | null;
};

/**
 * The payload union of a registry: one `{ source, target, intent }` member
 * per rule and intent.
 *
 * @example
 * ```ts
 * function describeDrop(payload: PayloadOf<typeof dnd>) { ... }
 * ```
 */
export type PayloadOf<TRegistry extends AnyRegistry> = NonNullable<
  ReturnType<TRegistry["$evaluate"]>
>;

/**
 * The union of all intents in a registry.
 *
 * @example
 * ```ts
 * const labels: Record<IntentOf<typeof dnd>, string> = { pin: "Pin", ... };
 * ```
 */
export type IntentOf<TRegistry extends AnyRegistry> =
  PayloadOf<TRegistry>["intent"];

/**
 * The handler-map type `$handle` accepts, for building a map outside the
 * call (e.g. in a hook, or shared between call sites).
 *
 * @example
 * ```ts
 * const handlers: HandlersOf<typeof dnd> = {
 *   pin: (p) => pinNote(p.source.id), // `p` is still narrowed
 * };
 * dnd.$handle(source, target, handlers);
 * ```
 */
export type HandlersOf<TRegistry extends AnyRegistry> = Handlers<
  PayloadOf<TRegistry>
>;

/**
 * A handler map that must handle every intent, except the ones listed in
 * `TExcept`. Use it with `satisfies`, so adding a rule with a new intent is a
 * compile error until it's handled, while every `p` stays narrowed.
 *
 * `TExcept` must name real intents, so a misspelled or stale exclusion is an
 * error too.
 *
 * @example
 * ```ts
 * const handlers = {
 *   pin: (p) => pinNote(p.source.id),
 *   unpin: (p) => unpinNote(p.source.id),
 * } satisfies ExhaustiveHandlersOf<typeof dnd, "link">; // "link" handled elsewhere
 * ```
 */
export type ExhaustiveHandlersOf<
  TRegistry extends AnyRegistry,
  TExcept extends IntentOf<TRegistry> = never,
> = Required<Omit<HandlersOf<TRegistry>, TExcept>>;

/**
 * The union of all entity keys in a registry.
 *
 * Both key types end in `extends infer K ? (K extends string ? K : never)`,
 * written inline. It changes nothing about the result, but TypeScript then
 * prints the keys themselves in errors and hovers (`'"note" | "pinsZone"'`)
 * instead of the alias with the whole registry type inside it. Imported
 * aliases keep their name otherwise, even when their body is `Extract<...>`,
 * `keyof X & string`, or another helper alias.
 *
 * @example
 * ```ts
 * type Key = KeyOf<typeof dnd>; // "note" | "pinsZone"
 * ```
 */
export type KeyOf<TRegistry extends { $keys: object }> =
  keyof TRegistry["$keys"] extends infer K
    ? K extends string
      ? K
      : never
    : never;

/**
 * The keys of entities registered without a shape, whose `$data()` takes no
 * argument. Useful for reusable drop-target components that receive the
 * entity key as a prop.
 *
 * @example
 * ```ts
 * function DropZone({ dndKey }: { dndKey: ShapelessKeyOf<typeof dnd> }) {
 *   // ...getData: () => dnd[dndKey].$data()
 * }
 * ```
 */
export type ShapelessKeyOf<TRegistry extends { $keys: object }> = {
  [K in KeyOf<TRegistry>]: K extends keyof TRegistry
    ? TRegistry[K] extends { $is: (obj: unknown) => obj is infer T }
      ? keyof T extends "$key"
        ? K
        : never
      : never
    : never;
}[KeyOf<TRegistry>] extends infer K
  ? K extends string
    ? K
    : never
  : never;

// =============================================================================
// Builder
// =============================================================================

/**
 * Fluent builder for constructing a type-safe DnD registry.
 * Accumulates entities and rules, then produces a Registry via `.build()`.
 */
export class Builder<
  TEntities extends Record<string, { $key: string }> = Empty,
  TPayloads extends RulePayload<unknown, unknown, string> = never,
> {
  private data: RegistryData;

  constructor(data?: RegistryData) {
    this.data = data ?? {
      entities: new Map(),
      rules: new Map(),
    };
  }

  /**
   * Register a draggable/droppable entity.
   *
   * @param def.key - Unique identifier stored in the data's `$key` property.
   *   Must be a string literal, must not start with `$` (reserved for registry
   *   members), and must not be `__proto__` or repeat a key.
   * @param def.shape - Type hint for the entity's data shape (use `{} as MyType`).
   *   Must not have a `$key` field.
   * @param def.getId - Optional function to extract unique ID (enables self-drop prevention)
   *
   * @example
   * ```ts
   * .entity({ key: "note", shape: {} as NoteShape, getId: n => n.id })
   * .entity({ key: "pinsButton" })  // Simple drop target, no shape needed
   * ```
   */
  entity<K extends string, E extends object = Empty>(def: {
    key: K & KeyCheck<K, TEntities>;
    shape?: E & ShapeCheck<E>;
    getId?: (entity: E) => EntityId | undefined;
  }): Builder<
    // Flattened at every step, so hovers show `{ note: ...; tag: ... }`
    // instead of a growing `Empty & Record<"note", ...> & ...` intersection.
    Simplify<TEntities & Record<K, Simplify<{ $key: K } & E>>>,
    TPayloads
  > {
    // Runtime twins of KeyCheck, for JS callers and casts.
    if (def.key.startsWith("$")) {
      throw new Error(
        `dndcraft: entity key "${def.key}" cannot start with "$" (reserved for registry members)`,
      );
    }
    if (def.key === "__proto__") {
      throw new Error('dndcraft: "__proto__" cannot be used as an entity key');
    }
    if (this.data.entities.has(def.key)) {
      throw new Error(`dndcraft: entity "${def.key}" is already registered`);
    }

    const newEntities = new Map(this.data.entities);
    newEntities.set(
      def.key,
      def.getId as ((e: unknown) => EntityId | undefined) | undefined,
    );
    return new Builder({ entities: newEntities, rules: this.data.rules });
  }

  /**
   * Define a rule for a source→target entity pair.
   *
   * @param def.source - Entity key for the dragged item
   * @param def.target - Entity key for the drop target
   * @param def.evaluate - Function returning an intent string, or null to reject
   *
   * Defining a pair again replaces the earlier rule (last wins), e.g. to
   * override one rule in a branch of a shared builder.
   *
   * @example
   * ```ts
   * .rule({
   *   source: "note",
   *   target: "notebook",
   *   evaluate: (src, tgt) => src.isInNotebook(tgt.id) ? "remove" : "add",
   * })
   * ```
   */
  rule<
    S extends keyof TEntities & string,
    T extends keyof TEntities & string,
    // The whole return type is inferred, then `null` is stripped below. The
    // more obvious `evaluate: (...) => I | null` breaks for rules that only
    // return `null`: TypeScript infers `I` as `string`, which widens every
    // intent in the registry. Inferring `R` gives `null` → `never` instead.
    R extends string | null,
  >(def: {
    source: S;
    target: T;
    evaluate: (source: TEntities[S], target: TEntities[T]) => R;
  }): Builder<
    TEntities,
    // Drop payloads from an earlier rule for the same pair, so an overridden
    // rule's intents disappear from the types just as they do at runtime.
    | Exclude<TPayloads, { source: { $key: S }; target: { $key: T } }>
    | RulePayload<TEntities[S], TEntities[T], Exclude<R, null>>
  > {
    const newRules = new Map(this.data.rules);
    newRules.set(ruleId(def.source, def.target), {
      source: def.source,
      target: def.target,
      evaluate: def.evaluate as EvaluateFn,
    });
    return new Builder({ entities: this.data.entities, rules: newRules });
  }

  /**
   * Build the final registry with all entities and rules.
   * @returns Registry object with entity slots, `$evaluate`, `$handle`, etc.
   */
  // A property rather than a method, so its type can depend on the rules
  // (see `BuildFn`). The cast is needed because the function can't satisfy a
  // conditional type that hasn't been resolved yet.
  build: BuildFn<TEntities, TPayloads> = (() =>
    buildRegistry<TEntities, TPayloads>(this.data)) as never;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a new DnD registry builder.
 *
 * @returns A fluent builder for defining entities and rules
 *
 * @example
 * ```ts
 * const dnd = dndcraft()
 *   .entity({ key: "note", shape: {} as NoteShape, getId: n => n.id })
 *   .entity({ key: "pinsButton" })
 *   .rule({ source: "note", target: "pinsButton", evaluate: () => "pin" })
 *   .build();
 * ```
 */
export function dndcraft() {
  return new Builder();
}
