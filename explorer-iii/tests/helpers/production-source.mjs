import { readFile } from "node:fs/promises";
import ts from "typescript";

// Keep structural assertions independent of the production module boundaries.
export async function readProductionSource(entry) {
  const visited = new Set();
  const imports = new Map();
  const declarations = [];

  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const text = await readFile(url, "utf8");
    const source = ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true,
      url.pathname.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith(".") && !specifier.endsWith(".json")) {
        const target = new URL(specifier, url);
        if (target.pathname.endsWith("/worker/deregistration")) continue;
        let resolved = false;
        for (const extension of [".ts", ".tsx"]) {
          const candidate = new URL(target.href + extension);
          try {
            await readFile(candidate, "utf8");
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
          await visit(candidate);
          resolved = true;
          break;
        }
        if (!resolved) throw new Error(`Missing production module: ${target.pathname}`);
      } else {
        imports.set(statement.getText(source), statement.getText(source));
      }
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) || ts.isExportAssignment(statement)) continue;
      if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
        && statement.expression.text === "use client") continue;
      const start = statement.getStart(source);
      let declaration = statement.getText(source);
      for (const modifier of [...(statement.modifiers || [])].reverse()) {
        if (modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) {
          declaration = declaration.slice(0, modifier.getStart(source) - start)
            + declaration.slice(modifier.end - start);
        }
      }
      declarations.push(declaration.trim());
    }
  }

  await visit(entry);
  return [...imports.values(), ...declarations].join("\n\n");
}
