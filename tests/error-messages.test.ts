/**
 * Checks the text of compile errors, which type tests can't see: they only
 * assert that an error happens, not what it says. Compiles intentionally
 * wrong code against the built package, like `package-consumer.test.ts`, so
 * the messages are the ones consumers get.
 *
 * Several of these depend on how a type is written rather than what it means
 * (see the comments on `KeyOf` and `BuildFn`), so a harmless-looking
 * refactor could make them unreadable again.
 */
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

// TypeScript works with forward slashes, even on Windows.
const file = fileURLToPath(
  new URL("./__error-messages__.ts", import.meta.url),
).replaceAll("\\", "/");

const code = `
import { type KeyOf, type ShapelessKeyOf, dndcraft } from "@kellanjs/dndcraft";

declare const computed: string;

const dnd = dndcraft()
  .entity({ key: "note", shape: {} as { id: string } })
  .entity({ key: "pinsZone" })
  .entity({ key: "trash" })
  .build();

export const key: KeyOf<typeof dnd> = "doesNotExist";
export const shapeless: ShapelessKeyOf<typeof dnd> = "note";

dndcraft().entity({ key: "note" }).entity({ key: "note" });

dndcraft()
  .entity({ key: "item" })
  .entity({ key: "bin" })
  .rule({ source: "item", target: "bin", evaluate: () => computed })
  .build();
`;

/** Type-checks `code` as a file in this folder and returns each error's text. */
function errors(): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (name) => name === file || fileExists(name);
  host.readFile = (name) => (name === file ? code : readFile(name));
  host.getSourceFile = (name, version, ...rest) =>
    name === file
      ? ts.createSourceFile(name, code, version)
      : getSourceFile(name, version, ...rest);

  const program = ts.createProgram([file], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

const messages = errors();
const find = (text: string) => messages.find((m) => m.includes(text));

it("produces exactly the intended errors", () => {
  expect(messages).toHaveLength(4);
});

it("lists the allowed keys for KeyOf and ShapelessKeyOf", () => {
  expect(find('"doesNotExist"')).toContain(
    `type '"note" | "pinsZone" | "trash"'`,
  );
  expect(find(`Type '"note"' is not assignable`)).toContain(
    `type '"pinsZone" | "trash"'`,
  );
});

it("names the rule in a short .build() error", () => {
  const message = find("returns type 'string'");
  expect(message).toContain(
    "Rule 'item' → 'bin' returns type 'string'. Intents must be string literals",
  );
  expect(message?.length).toBeLessThan(300);
});

it("quotes names with single quotes, so they print unescaped", () => {
  expect(find("already registered")).toContain(
    "Entity 'note' is already registered",
  );
});
