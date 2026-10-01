/**
 * A consumer module that exports a builder and a registry. Compiled with
 * `declaration: true` by `tests/declaration-emit.test.ts`.
 */
import { dndcraft } from "@kellanjs/dndcraft";

export const base = dndcraft()
  .entity({ key: "note", shape: {} as { id: string } })
  .rule({ source: "note", target: "note", evaluate: () => "link" });

export const dnd = base.build();
