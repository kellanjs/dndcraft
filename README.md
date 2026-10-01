# dndcraft

Type-safe rules for drag and drop in TypeScript.

Drag-and-drop libraries tell you **that** something was dropped. dndcraft
helps you decide **what the drop means**, and keeps your types intact all the
way from the thing being dragged to the code that handles the drop.

## The problem

Drag-and-drop libraries such as [Pragmatic drag and drop][pragmatic] let you
attach data to draggable items and drop targets. But that data is loosely
typed (every value is `unknown`), so the code that handles a drop has to check
and cast it by hand:

```ts
// Without dndcraft
onDrop: ({ source, location }) => {
  const target = location.current.dropTargets[0];

  if (source.data.type === "note" && target?.data.type === "pinsZone") {
    const note = source.data.note as Note; // a cast: nothing checks this
    if (note.isPinned) unpinNote(note.id);
    else pinNote(note.id);
  }
  // ...and another block like this for every kind of drop
};
```

With dndcraft, you declare the rules once, and each drop goes to a handler
with fully typed data:

```ts
// With dndcraft
onDrop: ({ source, location }) => {
  const target = location.current.dropTargets[0];
  if (!target) return;

  dnd.$handle(source.data, target.data, {
    pin: (p) => pinNote(p.source.id), // p.source is typed as a note
    unpin: (p) => unpinNote(p.source.id),
  });
};
```

## What dndcraft does (and doesn't do)

- It **works alongside** your drag-and-drop library; it doesn't replace it.
  Your library still handles the dragging itself: events, elements, previews
  and scrolling. The examples here use Pragmatic, but any library that gives
  you data for the dragged item and the drop target works.
- It **never touches the DOM**, so it works in browsers, Node, web workers and
  server rendering.
- It has **no dependencies**, no React hooks, and keeps no drag state of its
  own.

## Install

```sh
npm install @kellanjs/dndcraft
```

### Requirements

- **TypeScript 5.0 or later, with `strict` enabled** (specifically
  `strictNullChecks`). Rules return `null` to refuse a drop, and without
  `strictNullChecks` TypeScript treats `null` as `any`. A rule that only
  returns `null` then stops `.build()` from compiling, with an error that says
  to enable `strict`. Most projects already have it: it's the default since
  TypeScript 6, and `tsc --init` and `create-next-app` turn it on.
- **An ES2022 runtime**: Node 18 or later, or any current browser
  (Chrome 93+, Firefox 92+, Safari 15.4+).
- The package ships as ES modules.

## Core ideas

| Term         | What it is                                                           | Example                          |
| ------------ | -------------------------------------------------------------------- | -------------------------------- |
| **Entity**   | A kind of thing that can be dragged, or dropped onto.                | `note`, `pinsZone`               |
| **Rule**     | Allows one entity to be dropped on another, and says what it means. | a `note` dropped on a `pinsZone` |
| **Intent**   | The name a rule gives to a drop.                                     | `"pin"`, `"unpin"`               |
| **Registry** | The object you build from your entities and rules.                   | `dnd`                            |
| **Handler**  | Your function that runs for one intent.                              | `pin: (p) => pinNote(...)`       |

Everything dndcraft adds starts with `$`, so it never clashes with your own
names:

- On the registry: `$handle`, `$evaluate` and so on sit next to your entities
  (`dnd.note`). That's also why entity keys can't start with `$`.
- In your drag data: dndcraft stores the entity key in a `$key` field
  (`{ $key: "note", id: "1", ... }`), so your data is free to have a `key`
  field of its own.

## Quick start

This example has notes that can be pinned by dragging them onto a "pins" area,
and linked by dragging one note onto another.

### 1. Create a registry

Declare your entities and rules once, usually in their own file:

```ts
// dnd.ts
import { dndcraft } from "@kellanjs/dndcraft";

type Note = { id: string; title: string; isPinned: boolean };

export const dnd = dndcraft()
  // Entities: the kinds of things that can be dragged, or dropped onto
  .entity({ key: "note", shape: {} as Note, getId: (note) => note.id })
  .entity({ key: "pinsZone" }) // a drop target with no data of its own

  // Rules: which drops are allowed, and what each one means
  .rule({
    source: "note",
    target: "pinsZone",
    evaluate: (note) => (note.isPinned ? "unpin" : "pin"),
  })
  .rule({
    source: "note",
    target: "note",
    evaluate: () => "link",
  })
  .build();
```

- `shape: {} as Note` only tells TypeScript what data a note carries. The
  value itself is never used.
- `getId` is optional. Here it stops a note from being linked to itself.
- `evaluate` looks at the dragged data and the target data, and returns an
  intent. It can also return `null` to refuse the drop.

### 2. Attach data to draggables and drop targets

Wherever your drag-and-drop library asks for data, create it with the
entity's `$data` function:

```ts
// NoteCard.ts
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

import { dnd } from "./dnd";

draggable({
  element,
  getInitialData: () => dnd.note.$data(note),
});

// Notes are drop targets too, for the "link" rule
dropTargetForElements({
  element,
  getData: () => dnd.note.$data(note),
});
```

```ts
// PinsZone.ts
dropTargetForElements({
  element,
  getData: () => dnd.pinsZone.$data(), // no shape, so no argument
});
```

`$data` checks the data against the entity's shape (passing something that
isn't a `Note` is a compile error), then adds `$key: "note"`. That `$key` is
how dndcraft recognizes the data when it's dropped.

**Always create drag data with `$data`, never by hand.** Drag-and-drop
libraries accept any object as data, so TypeScript can't check an object you
write yourself, and a mistake like `{ key: "note" }` (instead of `$key`) would
make the drop silently do nothing. dndcraft logs a warning, once per entity,
when it sees data shaped like that.

> In React, set these up inside `useEffect`, as Pragmatic's own examples do.

### 3. Handle drops

Pass the dragged data and the target data to `$handle`, with one handler per
intent:

```ts
// App.ts
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

import { dnd } from "./dnd";

monitorForElements({
  onDrop: ({ source, location }) => {
    const target = location.current.dropTargets[0]; // the innermost target
    if (!target) return; // dropped outside every target

    dnd.$handle(source.data, target.data, {
      pin: (p) => pinNote(p.source.id),
      unpin: (p) => unpinNote(p.source.id),
      link: (p) => linkNotes(p.source.id, p.target.id),
    });
  },
});
```

Each handler receives `p`, which has three properties: `source` (the dragged
data), `target` (the drop target's data) and `intent`. TypeScript knows exactly
which entities they are: in `link`, both `p.source` and `p.target` are notes.

A misspelled intent is a compile error. You can leave intents out: a drop
whose intent has no handler is ignored.

### 4. Show what a drop would do (optional)

`$evaluate` asks what a drop _would_ mean, without doing anything. It returns
`{ source, target, intent }`, or `null` if no rule matches. It's useful for
hover feedback, so your rules stay the single source of truth:

```ts
dropTargetForElements({
  element,
  getData: () => dnd.pinsZone.$data(),
  onDragEnter: ({ source, self }) => {
    const intent = dnd.$evaluate(source.data, self.data)?.intent;
    setLabel(intent === "unpin" ? "Drop to unpin" : "Drop to pin");
  },
});
```

## How a drop is matched

`$handle`, `$evaluate` and `$canDrop` all follow the same steps:

1. Source and target must both be objects whose `$key` is a registered
   entity.
2. If both are the same entity, and it has `getId`, the drop is refused when
   the ids are equal (an item can't be dropped onto itself).
3. dndcraft looks up the rule for that source and target. If there isn't one,
   the drop is refused.
4. The rule's `evaluate` runs. If it returns an intent, that's the match. If
   it returns `null`, the drop is refused.
5. `$handle` then calls the handler for that intent, if your map has one.

## Guide

### Entities

```ts
.entity({ key, shape, getId })
```

- **`key`** (required): the entity's name. It's stored in the data's `$key`
  field (`{ $key: "note", ... }`). Keys must be:
  - written as a string literal (`"note"`), not a variable of type `string`,
    which would stop TypeScript from checking entity names at all;
  - unique;
  - not starting with `$`, and not `__proto__`.

  Breaking any of these is a compile error. Duplicates, `$` and `__proto__`
  also throw at runtime.
- **`shape`** (optional): the type of the entity's data, written as
  `{} as YourType`. Leave it out for entities that carry no data, such as
  buttons and drop zones. A shape can't have a `$key` field, since that's
  where dndcraft stores the key (a compile error).
- **`getId`** (optional): returns a `string` or `number` id. It enables
  [self-drop prevention](#self-drop-prevention).

Each entity becomes a property on the registry, with two functions:

| Function              | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `dnd.note.$data(...)` | Creates the entity's data: checks it against the shape, adds `$key`. |
| `dnd.note.$is(value)` | Checks whether a value is note data. A TypeScript type guard.    |

`$data` takes the shape as its argument. The argument is optional if every
field in the shape is optional, and there's no argument at all if the entity
has no shape.

### Rules and intents

```ts
.rule({ source, target, evaluate: (source, target) => intent or null })
```

- A rule only works in one direction: `note → notebook` doesn't allow
  `notebook → note`.
- `evaluate` receives the dragged data and the target data, both fully typed.
  It returns an intent string, or `null` to refuse the drop.
- The intent can depend on the data: `note.isPinned ? "unpin" : "pin"`.
- **Intents must be string literals**, like `"pin"`. dndcraft collects every
  rule's intents into a list of possible values, and that's what lets
  TypeScript check your handlers. Ternaries (`isPinned ? "unpin" : "pin"`) and
  template strings built from literal types (`` `move-${edge}` ``, where
  `edge` is `"left" | "right"`) are fine. A general `string`, such as a value
  computed at runtime, would let any handler name through, so `.build()`
  reports it as a compile error that names the rule. The same goes for `any`.
- A rule that only ever returns `null` is fine. It adds no intents.
- Defining a rule for the same source and target again replaces the earlier
  one. See [variations of a registry](#variations-of-a-registry).

### Self-drop prevention

If an entity has `getId`, dropping it onto another entity of the same kind with
the same id is refused, before any rule runs. For example, a note can't be
linked to itself.

- Ids are only compared within one entity: a note and a notebook may share an
  id.
- If `getId` returns `undefined`, the item has no id, and is never treated as
  "itself".
- Ids are compared with `===`: `0` is a valid id, and `1` and `"1"` are
  different ids.

### Handling drops with `$handle`

```ts
const handled = dnd.$handle(source, target, {
  pin: (p) => { ... },
  unpin: (p) => { ... },
});
```

- Every handler is optional. Intents without a handler are ignored.
- Handlers can be `async`, but `$handle` doesn't wait for them. That also
  means it can't catch their errors: a rejected promise becomes an unhandled
  rejection, so catch errors inside async handlers.
- It returns `true` if a handler ran, and `false` if no rule matched **or** the
  intent had no handler in this map.
- If a handler throws, the error reaches the code that called `$handle`.

When several rules share an intent, its handler receives any of their data.
Use `$is` to find out which one you have:

```ts
// Both notes and tags can be dropped in the trash
.rule({ source: "note", target: "trash", evaluate: () => "delete" })
.rule({ source: "tag", target: "trash", evaluate: () => "delete" })

// Handler
dnd.$handle(source.data, target.data, {
  delete: (p) => {
    if (dnd.note.$is(p.source)) trashNote(p.source.id);
    if (dnd.tag.$is(p.source)) deleteTag(p.source.id);
  },
});
```

### Finding out what a value is

`$keyOf` returns the entity key of any value, or `undefined` if it isn't data
for a registered entity. The result is typed as one of your keys, so you can
`switch` over it, for example to show what's under the pointer:

```ts
switch (dnd.$keyOf(target.data)) {
  case "note":
    return "Drop on a note to link it";
  case "pinsZone":
    return "Drop here to pin";
  case undefined:
    return "Nothing to drop on";
}
```

Use `$keyOf` instead of reading `$key` yourself: drag data is loosely typed, so
a hand-written `data.$key` gets no help from TypeScript, and a typo quietly
gives `undefined`.

`$keyOf` only tells you the key. To use the data itself with its type, check
it with the entity's `$is`, which narrows it.

### Types from the registry

These helper types let you reuse the registry's types in your own code:

```ts
import type {
  EntityOf,
  ExhaustiveHandlersOf,
  HandlersOf,
  IntentOf,
  KeyOf,
  PayloadOf,
  ShapelessKeyOf,
} from "@kellanjs/dndcraft";

type Key = KeyOf<typeof dnd>; // "note" | "pinsZone"
type TargetKey = ShapelessKeyOf<typeof dnd>; // "pinsZone": entities with no shape
type DndNote = EntityOf<typeof dnd, "note">; // { $key: "note"; id: string; ... }
type Intent = IntentOf<typeof dnd>; // "pin" | "unpin" | "link"
type Payload = PayloadOf<typeof dnd>; // what $evaluate returns, minus null
type Handlers = HandlersOf<typeof dnd>; // the handler map $handle accepts
type AllHandlers = ExhaustiveHandlersOf<typeof dnd>; // ...with every intent required
```

`ShapelessKeyOf` is useful for reusable drop-target components that receive
the entity key as a prop, since `$data()` needs no argument for those
entities:

```ts
function DropZone({ dndKey }: { dndKey: ShapelessKeyOf<typeof dnd> }) {
  // ...
  dropTargetForElements({ element, getData: () => dnd[dndKey].$data() });
}
```

Because the component creates the data itself, callers pass only a key, so
none of them can build drag data by hand. Reusable hooks can work the same way.

The package also exports `DndcraftBuilder` and `DndcraftRegistry`, the types
of a builder and a registry. You'll rarely write them yourself, but they let
TypeScript describe your registry when your project generates `.d.ts` files
(for example, a shared package in a monorepo that exports its registry).

## API reference

| Member                             | Returns                  | Notes                                                           |
| ---------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `dndcraft()`                       | builder                  | Starts a registry.                                              |
| `.entity(def)`                     | builder                  | Adds an entity.                                                 |
| `.rule(def)`                       | builder                  | Adds a rule.                                                    |
| `.build()`                         | registry                 | Finishes the registry.                                          |
| `dnd.<entity>.$data(shape?)`       | entity data              | Creates data for that entity.                                   |
| `dnd.<entity>.$is(value)`          | `boolean`                | Type guard. Checks `$key` only.                                 |
| `dnd.$handle(source, target, map)` | `boolean`                | Runs the handler for the drop's intent.                         |
| `dnd.$evaluate(source, target)`    | `{ source, target, intent }` or `null` | Tells you what a drop would mean.                 |
| `dnd.$canDrop(source, target)`     | `boolean`                | `true` if a rule matches.                                       |
| `dnd.$keyOf(value)`                | entity key or `undefined` | The entity key of a value.                                    |
| `dnd.$keys`                        | `{ note: "note", ... }`  | Entity keys, for when you need the string itself.               |
| `dnd.$entities`                    | `string[]`               | Every entity key, in the order they were added.                 |
| `dnd.$rules`                       | `{ source, target }[]`   | Every rule's source and target, in the order they were added.   |

Builders never change: each `.entity()` or `.rule()` call returns a new
builder, and leaves the old one as it was.

The `source`, `target` and `value` you pass in are typed `unknown`. Drag data
can come from anywhere, so dndcraft checks it at runtime instead of trusting
its type.

## Recipes

### Handling drops

#### Make sure every intent has a handler

Handlers are optional by default. To make a forgotten intent a compile error,
check the map with `satisfies ExhaustiveHandlersOf<typeof dnd>`:

```ts
const handlers = {
  pin: (p) => pinNote(p.source.id),
  unpin: (p) => unpinNote(p.source.id),
  link: (p) => linkNotes(p.source.id, p.target.id),
} satisfies ExhaustiveHandlersOf<typeof dnd>;

dnd.$handle(source.data, target.data, handlers);
```

Now adding a rule with a new intent is an error until you handle it. Each `p`
is still fully typed.

The error message is long, because TypeScript prints your whole handler map.
The missing intent is named at the start of its second line:
`Property 'link' is missing in type ...`.

If some intents are deliberately handled elsewhere, list them as the second
type argument, so each exception is a visible decision:

```ts
} satisfies ExhaustiveHandlersOf<typeof dnd, "link">;
```

The list is checked too: naming an intent that doesn't exist (a typo, or a
rule you've since removed) is a compile error.

#### Build a handler map somewhere else

When the handler map is put together outside the `$handle` call (in a hook,
from several files, or shared between call sites), type it with `HandlersOf`.
Handlers keep their typed `p`, and misspelled intents are still errors:

```ts
const handlers: HandlersOf<typeof dnd> = {
  pin: (p) => pinNote(p.source.id),
  unpin: (p) => unpinNote(p.source.id),
};

dnd.$handle(source.data, target.data, handlers);
```

`IntentOf` is useful for anything keyed by intent, such as labels:

```ts
const labels: Record<IntentOf<typeof dnd>, string> = {
  pin: "Pin",
  unpin: "Unpin",
  link: "Link",
};
```

#### Handle a drop inside one component

`$handle` is a plain function, so it works anywhere you have both pieces of
data. When a drop only matters to one component (for example, it needs a
callback prop), call it from that drop target's `onDrop`:

```ts
dropTargetForElements({
  element,
  getData: () => dnd.searchBar.$data(),
  onDrop: ({ source, self }) =>
    dnd.$handle(source.data, self.data, {
      "open-link-picker": (p) => onNoteDropped(p.source),
    }),
});
```

Each `$handle` call runs the rules once. For drops handled centrally, prefer
**one monitor with one handler map** over several monitors that each call
`$handle` for the same drop.

#### Catch drops that nobody handled

`$handle` returns `false` when nothing ran, which lets you spot a matched
intent with no handler:

```ts
const handled = dnd.$handle(source.data, target.data, handlers);
if (!handled && dnd.$canDrop(source.data, target.data)) {
  console.warn(
    "Unhandled drop:",
    dnd.$evaluate(source.data, target.data)?.intent,
  );
}
```

This only catches it when the drop happens. To catch it while you write the
code, see [make sure every intent has a handler](#make-sure-every-intent-has-a-handler).

### Drop targets

#### Let the rules decide what a target accepts

Instead of repeating your rules in each drop target's `canDrop`, ask the
registry:

```ts
dropTargetForElements({
  element,
  getData: () => dnd.pinsZone.$data(),
  canDrop: ({ source }) => dnd.$canDrop(source.data, dnd.pinsZone.$data()),
});
```

If you later remove the rule, the target stops accepting the drop.

#### Nested drop targets

Pragmatic lists every drop target under the pointer, innermost first. Usually
the innermost one is the right target:

```ts
const target = location.current.dropTargets[0];
```

If the innermost target has no rule for the dragged item, you may want the
drop to go to the next target out instead. dndcraft leaves that choice to you,
and it's one line:

```ts
const target = location.current.dropTargets.find((t) =>
  dnd.$canDrop(source.data, t.data),
);
```

Be careful with [hover-only targets](#hover-only-targets): with this approach,
dropping on one would trigger whatever is behind it.

#### Many similar targets: one entity with data

If you find yourself writing many near-identical rules, make the targets one
entity whose data says which one it is:

```ts
// Instead of notesButton, tagsButton, trashButton..., each with its own rule:
.entity({ key: "navButton", shape: {} as { panel: "notes" | "tags" | "trash" } })
.rule({ source: "note", target: "navButton", evaluate: () => "open-panel" })

// Drop target
getData: () => dnd.navButton.$data({ panel: "tags" }),

// Handler
"open-panel": (p) => openPanel(p.target.panel),
```

Entities are _kinds of things_, not individual elements on the page.

#### Hover-only targets

Some targets only react while something is dragged over them, like a button
that opens a panel after a short delay. Register them as entities, but give
them **no rules**. `$data` still gives them typed data, and dropping on them
does nothing.

#### Reordering with edges

Pragmatic's hitbox package stores the closest edge inside the target's data,
so a rule can read it directly:

```ts
import {
  attachClosestEdge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

// Rule
.rule({
  source: "tab",
  target: "tab",
  evaluate: (_source, target) =>
    extractClosestEdge(target) === "left" ? "move-before" : "move-after",
})

// Drop target
getData: ({ input, element }) =>
  attachClosestEdge(dnd.tab.$data({ id }), {
    input,
    element,
    allowedEdges: ["left", "right"],
  }),
```

### Variations of a registry

Because builders never change, you can start from a shared base and override
a rule. Defining a rule for the same source and target again replaces it:

```ts
const base = dndcraft()
  .entity({ key: "note" })
  .entity({ key: "notebook" })
  .rule({ source: "note", target: "notebook", evaluate: () => "move" });

export const dnd = base.build();

export const readOnlyDnd = base
  .rule({ source: "note", target: "notebook", evaluate: () => null })
  .build();
```

The old rule is gone everywhere: at runtime, in `$rules`, and in the types (a
handler for `"move"` on `readOnlyDnd` is a compile error).

## Good to know

- **Keep `evaluate` quick and free of side effects.** It runs every time a
  drop is checked: for hover feedback, in `canDrop`, and again when the drop
  happens. It should only look at the data and return an intent. Do the work
  in your handlers.
- **Keep shapes plain objects.** `$data` copies your data with an object
  spread, which drops class methods and `#private` fields. To drag a class
  instance, nest it in a field: `shape: {} as { note: NoteModel }`.
- **`$is` and `$keyOf` only check `$key`.** Anything with `$key: "note"`
  counts as a note.
  That's safe when all your drag data is created with `$data`, but data from
  outside your app (for example, dragged in from another window) isn't
  checked.
- **Interfaces work as shapes.** Pragmatic's `getData` expects
  `Record<string, unknown>`, which an `interface` normally doesn't satisfy.
  dndcraft converts entity types to plain object types, so they fit.
- **Build the registry once.** Create it at the top level of a module and
  import it. Don't rebuild it inside a component on every render.

## Development

```sh
npm install
npm run ci
```

- `npm test` builds the package, then runs the tests with Vitest:
  - `tests/dndcraft.test.ts`: runtime behavior.
  - `tests/package-consumer.test.ts`: imports the built package the way an
    app would.
  - `tests/declaration-emit.test.ts`: checks that a project generating
    `.d.ts` files can export a builder and a registry.
  - `tests/error-messages.test.ts`: checks the text of key compile errors,
    which type tests can't see.
- `npm run type:test` type-checks every test file. `tests/dndcraft.test-d.ts`
  holds the type-level tests: they never run, the compiler checks them, and
  `@ts-expect-error` lines assert that invalid code is rejected.
- `npm run ci` runs lint, type checks, the build, type tests, the formatting
  check, the export check ([Are the Types Wrong?][attw]) and the tests.

## License

MIT

[attw]: https://github.com/arethetypeswrong/arethetypeswrong.github.io
[pragmatic]: https://atlassian.design/components/pragmatic-drag-and-drop
