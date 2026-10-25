// Bounded source fragments share the pinned upstream scope, not another runtime graph.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";

const directory = new URL("./parser-adaptations/", import.meta.url);

export function parserAdaptationFiles() {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((entry) => {
      assert(entry.isFile(), "Parser adaptation inputs must be ordinary files");
      assert(/^(?:[a-z-]+\.ts|tsconfig\.json)$/.test(entry.name));
      return `scripts/parser-adaptations/${entry.name}`;
    });
}

/** Compile checked source; typechecking is separately enforced by npm run typecheck. */
export function parserAdaptationSource(name) {
  assert(/^[a-z-]+$/.test(name));
  const filename = `${name}.ts`;
  const source = readFileSync(new URL(filename, directory), "utf8");
  return compileParserAdaptation(source, filename);
}

/** Modern source only: no extra runtime dependency, export surface or helper. */
export function compileParserAdaptation(source, filename) {
  assert.equal(ts.version, "6.0.3", "Review changed parser fragment compiler");
  const input = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  function inspectInput(node) {
    assert(
      !ts.isModuleDeclaration(node) && !ts.isEnumDeclaration(node),
      "Parser fragments cannot generate namespace or enum helpers",
    );
    ts.forEachChild(node, inspectInput);
  }
  inspectInput(input);
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  assert.equal(compiled.diagnostics?.length, 0, `Invalid parser fragment: ${filename}`);
  const code = compiled.outputText;
  const ast = ts.createSourceFile(filename, code, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `Invalid emitted parser fragment: ${filename}`);
  const removals = [];
  function inspect(node, allowExports) {
    assert(!ts.isImportDeclaration(node), "Parser fragments cannot add runtime imports");
    assert(
      !(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword),
      "Parser fragments cannot add dynamic imports",
    );
    assert(
      !(ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword),
      "Parser fragments cannot use import.meta",
    );
    assert(!ts.isExportAssignment(node), "Parser fragments cannot add export assignments");
    if (ts.isExportDeclaration(node)) {
      assert(allowExports, "Unexpected export in inserted parser fragment");
      assert.equal(node.moduleSpecifier, undefined, "Parser fragments cannot re-export");
      assert(
        node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length === 0,
        "Parser fragments cannot add named export lists",
      );
      removals.push([node.getStart(ast), node.end]);
    }
    for (const modifier of ts.getModifiers(node) ?? []) {
      assert(
        allowExports &&
          modifier.kind === ts.SyntaxKind.ExportKeyword &&
          (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)),
        "Unexpected parser fragment declaration modifier",
      );
      removals.push([modifier.getStart(ast), modifier.end]);
    }
    if (node.name && ts.isIdentifier(node.name)) {
      assert(!node.name.text.startsWith("__"), "Unexpected parser compiler helper");
    }
    ts.forEachChild(node, (child) => inspect(child, allowExports));
  }
  inspect(ast, true);
  let inserted = code;
  // Remove only parsed syntax spans. Matching text inside literals is data,
  // and a generator's asterisk is independent of its export modifier.
  for (const [start, end] of removals.sort(([left], [right]) => right - left)) {
    inserted = inserted.slice(0, start) + inserted.slice(end);
  }
  const final = ts.createSourceFile(
    filename,
    inserted,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(final.parseDiagnostics.length, 0, `Invalid inserted parser fragment: ${filename}`);
  inspect(final, false);
  return inserted;
}
