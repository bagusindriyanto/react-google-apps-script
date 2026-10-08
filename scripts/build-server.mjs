import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function inside(directory, file) {
  const path = relative(directory, file);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(path)
  );
}

// Only static global declarations need unique names; each function has its own scope.
export function validateGlobals(files, root = projectRoot) {
  const declarations = new Map();
  const errors = [];

  function location(file, node) {
    const { line, character } = file.getLineAndCharacterOfPosition(
      node.getStart(file),
    );
    return `${relative(root, file.fileName).replaceAll('\\', '/')}:${line + 1}:${character + 1}`;
  }

  function add(file, name) {
    if (!ts.isIdentifier(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) add(file, element.name);
      }
      return;
    }
    const previous = declarations.get(name.text);
    const current = location(file, name);
    if (previous)
      errors.push(
        `Nama global "${name.text}" duplikat: ${previous} dan ${current}.`,
      );
    else declarations.set(name.text, current);
  }

  for (const file of files) {
    if (file.isDeclarationFile) continue;

    function checkModules(node) {
      if (
        ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isExportDeclaration(node) ||
        ts.isExportAssignment(node) ||
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) ||
        (ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === 'require')))
      ) {
        errors.push(
          `${location(file, node)}: Backend harus berupa script global, tanpa import/export atau require runtime. Panggil fungsi antarfile langsung; gunakan type query di server/types.d.ts untuk tipe bersama.`,
        );
        return;
      }
      ts.forEachChild(node, checkModules);
    }
    checkModules(file);

    function visit(node, depth = 0) {
      if (
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
        )
      )
        return;
      if (ts.isFunctionLike(node)) {
        if (
          ts.isFunctionDeclaration(node) &&
          node.body &&
          node.name &&
          depth === 0
        )
          add(file, node.name);
        return;
      }
      if (ts.isClassLike(node)) {
        if (ts.isClassDeclaration(node) && node.name && depth === 0)
          add(file, node.name);
        return;
      }
      if (
        ts.isVariableDeclarationList(node) &&
        (!(node.flags & ts.NodeFlags.BlockScoped) || depth === 0)
      ) {
        for (const declaration of node.declarations)
          add(file, declaration.name);
      }
      const childDepth =
        depth +
        Number(
          ts.isBlock(node) ||
            ts.isCaseBlock(node) ||
            ts.isForStatement(node) ||
            ts.isForInStatement(node) ||
            ts.isForOfStatement(node),
        );
      ts.forEachChild(node, (child) => visit(child, childDepth));
    }
    visit(file);
  }

  if (errors.length) throw new Error(errors.join('\n'));
}

function checkDiagnostics(diagnostics, root) {
  if (!diagnostics.length) return;
  throw new Error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
}

function formatOutput(file, code) {
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({ allowJs: true }),
    getScriptFileNames: () => [file],
    getScriptVersion: () => '0',
    getScriptSnapshot: () => ts.ScriptSnapshot.fromString(code),
    getCurrentDirectory: () => dirname(file),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  });
  try {
    const edits = service.getFormattingEditsForDocument(file, {
      ...ts.getDefaultFormatCodeSettings('\n'),
      indentSize: 2,
      tabSize: 2,
      convertTabsToSpaces: true,
    });
    for (const { span, newText } of edits.toSorted(
      (a, b) => b.span.start - a.span.start,
    )) {
      code =
        code.slice(0, span.start) +
        newText +
        code.slice(span.start + span.length);
    }
    return code;
  } finally {
    service.dispose();
  }
}

export async function buildServer(
  root = projectRoot,
  { checkOnly = false } = {},
) {
  root = resolve(root);
  const sourceDirectory = resolve(root, 'server');
  const outputDirectory = resolve(root, 'dist/server');
  const config = ts.readConfigFile(
    resolve(root, 'tsconfig.server.json'),
    ts.sys.readFile,
  );
  checkDiagnostics(config.error ? [config.error] : [], root);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  checkDiagnostics(parsed.errors, root);

  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    noEmit: false,
    noEmitOnError: true,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    sourceMap: false,
    inlineSourceMap: false,
    rootDir: sourceDirectory,
    outDir: outputDirectory,
  });
  const sources = program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile);
  if (
    sources.some((file) => !inside(sourceDirectory, resolve(file.fileName)))
  ) {
    throw new Error(
      'File implementasi backend harus berada di folder server/. Tipe bersama harus berupa .d.ts.',
    );
  }
  validateGlobals(sources, root);
  checkDiagnostics(ts.getPreEmitDiagnostics(program), root);

  const outputs = new Map();
  const result = program.emit(undefined, (file, code) => {
    if (!file.endsWith('.js') || !inside(outputDirectory, resolve(file))) {
      throw new Error(`Output backend tidak valid: ${file}`);
    }
    outputs.set(file.replace(/\.js$/, '.gs'), formatOutput(file, code));
  });
  checkDiagnostics(result.diagnostics, root);
  if (result.emitSkipped)
    throw new Error('Kompilasi backend tidak menghasilkan output.');
  validateGlobals(
    [...outputs].map(([file, code]) =>
      ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.ES2019,
        true,
        ts.ScriptKind.JS,
      ),
    ),
    root,
  );

  const manifest = await readFile(
    resolve(sourceDirectory, 'appsscript.json'),
    'utf8',
  );
  JSON.parse(manifest);
  if (checkOnly) return [...outputs.keys()];
  // Validate the exact generated directory before recursively replacing stale output.
  if (!inside(resolve(root, 'dist'), outputDirectory))
    throw new Error('Folder output berada di luar dist/.');
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const [file, code] of outputs) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, code);
  }
  await writeFile(resolve(root, 'dist/appsscript.json'), manifest);
  return [...outputs.keys()];
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const checkOnly = process.argv.includes('--check');
    const files = await buildServer(projectRoot, { checkOnly });
    console.log(
      checkOnly
        ? `Validasi backend berhasil (${files.length} file).`
        : `Backend berhasil dibangun (${files.length} file .gs):\n${files.map((file) => relative(projectRoot, file)).join('\n')}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
