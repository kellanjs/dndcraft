/**
 * Projects that emit declarations (libraries, monorepo packages) must be able
 * to export builders and registries. TypeScript then has to write their types
 * into a `.d.ts`, which only works if it can refer to them by an exported name.
 * Runs against the built package, like `package-consumer.test.ts`.
 */
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("lets consumers export builders and registries with declaration: true", () => {
  const fixture = fileURLToPath(
    new URL("./fixtures/exported-registry.ts", import.meta.url),
  );
  const program = ts.createProgram([fixture], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
  });

  let declarations = "";
  const result = program.emit(undefined, (_fileName, text) => {
    declarations += text;
  });
  const errors = [
    ...ts.getPreEmitDiagnostics(program),
    ...result.diagnostics,
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

  expect(errors).toEqual([]);
  expect(declarations).toContain(
    'base: import("@kellanjs/dndcraft").DndcraftBuilder<',
  );
  expect(declarations).toContain(
    'dnd: import("@kellanjs/dndcraft").DndcraftRegistry<',
  );
});
