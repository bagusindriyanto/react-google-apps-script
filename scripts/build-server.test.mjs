import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildServer, validateGlobals } from './build-server.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'gas-starter-'));
  t.after(async () => {
    assert.ok(root.startsWith(join(tmpdir(), 'gas-starter-')));
    await rm(root, { recursive: true, force: true });
  });
  const config = {
    compilerOptions: {
      target: 'ES2019', lib: ['ES2019'], types: [], strict: true,
      module: 'ESNext', moduleResolution: 'bundler', moduleDetection: 'legacy', noEmit: true,
    },
    include: ['server/**/*.ts', 'shared/**/*.d.ts'],
  };
  for (const [file, code] of Object.entries({
    'tsconfig.server.json': JSON.stringify(config),
    'server/appsscript.json': '{"runtimeVersion":"V8"}',
    ...files,
  })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), code);
  }
  return root;
}

function parse(files) {
  return Object.entries(files).map(([file, code]) => ts.createSourceFile(file, code, ts.ScriptTarget.ES2019, true));
}

test('one .gs per source, nested paths, shared types, and global calls', async (t) => {
  const root = await fixture(t, {
    'server/code.ts': 'function doGet() { return HtmlService.render(getProducts()); }',
    'server/nested/products.ts': 'function getProducts(): Product[] { return [{ id: "1", name: "Sample" }]; }',
    'server/types.d.ts': 'type Product = import("../shared/contracts").Product; declare const HtmlService: { render(products: Product[]): string };',
    'shared/contracts.d.ts': 'export type Product = { id: string; name: string };',
  });
  const outputs = await buildServer(root);
  assert.deepEqual(outputs.map((file) => file.slice(join(root, 'dist/server').length + 1).replaceAll('\\', '/')).sort(), ['code.gs', 'nested/products.gs']);
  const context = vm.createContext({ HtmlService: { render: (products) => products[0].name } });
  for (const file of outputs) {
    const code = await readFile(file, 'utf8');
    assert.doesNotMatch(code, /\b(?:import|export|require)\b|__esModule/);
    vm.runInContext(code, context);
  }
  assert.equal(context.doGet(), 'Sample');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/appsscript.json'), 'utf8')), { runtimeVersion: 'V8' });
});

test('rejects global function, variable, class, destructuring, and hoisted var collisions', () => {
  for (const declaration of [
    'function conflict() {}',
    'const conflict = () => {};',
    'let conflict = 1;',
    'class conflict {}',
    'const { value: conflict } = { value: 1 };',
    'if (true) { var conflict = 1; }',
  ]) {
    assert.throws(() => validateGlobals(parse({
      'server/first.ts': '\nfunction conflict() {}',
      'server/second.ts': declaration,
    })), /Nama global "conflict" duplikat: .*first\.ts:2:10 dan .*second\.ts:/);
  }
});

test('local scopes and overload signatures do not collide', () => {
  assert.doesNotThrow(() => validateGlobals(parse({
    'server/a.ts': 'function helper() {} function first() { function helper() {} return helper(); }',
    'server/b.ts': 'function second() { const helper = () => 1; return helper(); } { const helper = 2; } for (let helper = 0; helper < 1; helper++) {}',
    'server/c.ts': 'function overloaded(value: string): string; function overloaded(value: string) { return value; }',
  })));
});

test('rejects module syntax, including type-only imports that would turn scripts into modules', () => {
  for (const code of [
    'import { value } from "./other";',
    'import type { Value } from "./other";',
    'export function entry() {}',
    'export type Value = string;',
    'export {};',
    'import value = require("./other");',
    'function entry() { return import("./other"); }',
    'const dependency = require("other");',
  ]) {
    assert.throws(() => validateGlobals(parse({ 'server/module.ts': code })), /Backend harus berupa script global/);
  }
});

test('generated compiler helpers are also checked before output is written', async (t) => {
  const root = await fixture(t, {
    'server/a.ts': 'class First { #value = 1; read() { return this.#value; } }',
    'server/b.ts': 'class Second { #value = 2; read() { return this.#value; } }',
  });
  await assert.rejects(buildServer(root), /Nama global "__classPrivateFieldGet" duplikat/);
  await assert.rejects(readdir(join(root, 'dist')), { code: 'ENOENT' });
});

test('validation mode checks compilation without writing output', async (t) => {
  const root = await fixture(t, { 'server/example.ts': 'function example() { return 1; }' });
  const outputs = await buildServer(root, { checkOnly: true });
  assert.equal(outputs.length, 1);
  await assert.rejects(readdir(join(root, 'dist')), { code: 'ENOENT' });
});

test('successful rebuild removes stale output and preserves frontend files', async (t) => {
  const root = await fixture(t, { 'server/old.ts': 'function original() { return 1; }' });
  await buildServer(root);
  await writeFile(join(root, 'dist/index.html'), '<html>frontend</html>');
  await mkdir(join(root, 'server/nested'));
  await rename(join(root, 'server/old.ts'), join(root, 'server/nested/new.ts'));
  await buildServer(root);
  await assert.rejects(readFile(join(root, 'dist/server/old.gs')), { code: 'ENOENT' });
  assert.match(await readFile(join(root, 'dist/server/nested/new.gs'), 'utf8'), /function original/);
  assert.equal(await readFile(join(root, 'dist/index.html'), 'utf8'), '<html>frontend</html>');
});

test('duplicate names and type errors preserve the previous backend build', async (t) => {
  const root = await fixture(t, { 'server/original.ts': 'function original(): number { return 1; }' });
  await buildServer(root);
  const original = await readFile(join(root, 'dist/server/original.gs'), 'utf8');
  await writeFile(join(root, 'server/duplicate.ts'), 'function original() { return 2; }');
  await assert.rejects(buildServer(root), /Nama global "original" duplikat/);
  assert.equal(await readFile(join(root, 'dist/server/original.gs'), 'utf8'), original);
  await rm(join(root, 'server/duplicate.ts'));
  await writeFile(join(root, 'server/original.ts'), 'function original(): number { return "wrong"; }');
  await assert.rejects(buildServer(root), /not assignable to type 'number'/);
  assert.equal(await readFile(join(root, 'dist/server/original.gs'), 'utf8'), original);
});
