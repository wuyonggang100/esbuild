const { installForTests } = require('./esbuild')
const { SourceMapConsumer } = require('source-map')
const rimraf = require('rimraf')
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const readFileAsync = fs.promises.readFile
const writeFileAsync = fs.promises.writeFile
const mkdirAsync = fs.promises.mkdir

const repoDir = path.dirname(__dirname)
const rootTestDir = path.join(repoDir, 'scripts', '.js-api-tests')

let buildTests = {
  async errorIfEntryPointsNotArray({ esbuild }) {
    try {
      await esbuild.build({ entryPoints: 'this is not an array', logLevel: 'silent' })
      throw new Error('Expected build failure');
    } catch (e) {
      if (e.message !== '"entryPoints" must be an array') {
        throw e;
      }
    }
  },

  async es6_to_cjs({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'export default 123')
    const value = await esbuild.build({ entryPoints: [input], bundle: true, outfile: output, format: 'cjs' })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(output)
    assert.strictEqual(result.default, 123)
    assert.strictEqual(result.__esModule, true)
  },

  // Test recursive directory creation
  async recursiveMkdir({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'a/b/c/d/out.js')
    await writeFileAsync(input, 'export default 123')
    await esbuild.build({ entryPoints: [input], bundle: true, outfile: output, format: 'cjs' })
    const result = require(output)
    assert.strictEqual(result.default, 123)
    assert.strictEqual(result.__esModule, true)
  },

  async outExtensionJS({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'in.mjs')
    await writeFileAsync(input, 'console.log("test")')
    await esbuild.build({ entryPoints: [input], outdir: testDir, outExtension: { '.js': '.mjs' } })
    const mjs = await readFileAsync(output, 'utf8')
    assert.strictEqual(mjs, 'console.log("test");\n')
  },

  async outExtensionCSS({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.css')
    const output = path.join(testDir, 'in.notcss')
    await writeFileAsync(input, 'body {}')
    await esbuild.build({ entryPoints: [input], outdir: testDir, outExtension: { '.css': '.notcss' } })
    const notcss = await readFileAsync(output, 'utf8')
    assert.strictEqual(notcss, 'body {\n}\n')
  },

  async sourceMap({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'exports.foo = 123')
    await esbuild.build({ entryPoints: [input], outfile: output, sourcemap: true })
    const result = require(output)
    assert.strictEqual(result.foo, 123)
    const outputFile = await readFileAsync(output, 'utf8')
    const match = /\/\/# sourceMappingURL=(.*)/.exec(outputFile)
    assert.strictEqual(match[1], 'out.js.map')
    const resultMap = await readFileAsync(output + '.map', 'utf8')
    const json = JSON.parse(resultMap)
    assert.strictEqual(json.version, 3)
  },

  async sourceMapExternal({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'exports.foo = 123')
    await esbuild.build({ entryPoints: [input], outfile: output, sourcemap: 'external' })
    const result = require(output)
    assert.strictEqual(result.foo, 123)
    const outputFile = await readFileAsync(output, 'utf8')
    const match = /\/\/# sourceMappingURL=(.*)/.exec(outputFile)
    assert.strictEqual(match, null)
    const resultMap = await readFileAsync(output + '.map', 'utf8')
    const json = JSON.parse(resultMap)
    assert.strictEqual(json.version, 3)
  },

  async sourceMapInline({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'exports.foo = 123')
    await esbuild.build({ entryPoints: [input], outfile: output, sourcemap: 'inline' })
    const result = require(output)
    assert.strictEqual(result.foo, 123)
    const outputFile = await readFileAsync(output, 'utf8')
    const match = /\/\/# sourceMappingURL=data:application\/json;base64,(.*)/.exec(outputFile)
    const json = JSON.parse(Buffer.from(match[1], 'base64').toString())
    assert.strictEqual(json.version, 3)
  },

  async resolveExtensionOrder({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js');
    const inputBare = path.join(testDir, 'module.js')
    const inputSomething = path.join(testDir, 'module.something.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'exports.result = require("./module").foo')
    await writeFileAsync(inputBare, 'exports.foo = 321')
    await writeFileAsync(inputSomething, 'exports.foo = 123')
    await esbuild.build({
      entryPoints: [input],
      outfile: output,
      format: 'cjs',
      bundle: true,
      resolveExtensions: ['.something.js', '.js'],
    })
    assert.strictEqual(require(output).result, 123)
  },

  async inject({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js');
    const inject = path.join(testDir, 'inject.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'export default foo * 10 + 4')
    await writeFileAsync(inject, 'export let foo = 123')
    await esbuild.build({
      entryPoints: [input],
      outfile: output,
      format: 'cjs',
      bundle: true,
      inject: [inject],
    })
    assert.strictEqual(require(output).default, 1234)
  },

  async mainFields({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    const mainFieldsDir = path.join(testDir, 'node_modules', 'main-fields-test')
    const mainFieldsA = path.join(mainFieldsDir, 'a.js')
    const mainFieldsB = path.join(mainFieldsDir, 'b.js')
    const mainFieldsPackage = path.join(mainFieldsDir, 'package.json')
    await mkdirAsync(mainFieldsDir, { recursive: true })
    await writeFileAsync(input, 'export * from "main-fields-test"')
    await writeFileAsync(mainFieldsA, 'export let foo = "a"')
    await writeFileAsync(mainFieldsB, 'export let foo = "b"')
    await writeFileAsync(mainFieldsPackage, '{ "a": "./a.js", "b": "./b.js", "c": "./c.js" }')
    await esbuild.build({ entryPoints: [input], outfile: output, bundle: true, format: 'cjs', mainFields: ['c', 'b', 'a'] })
    const result = require(output)
    assert.strictEqual(result.foo, 'b')
  },

  async requireAbsolutePath({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const dependency = path.join(testDir, 'dep.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, `import value from ${JSON.stringify(dependency)}; export default value`)
    await writeFileAsync(dependency, `export default 123`)
    const value = await esbuild.build({ entryPoints: [input], bundle: true, outfile: output, format: 'cjs' })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(output)
    assert.strictEqual(result.default, 123)
    assert.strictEqual(result.__esModule, true)
  },

  async fileLoader({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const data = path.join(testDir, 'data.bin')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, `export {default as value} from ${JSON.stringify(data)}`)
    await writeFileAsync(data, `stuff`)
    const value = await esbuild.build({
      entryPoints: [input],
      bundle: true,
      outfile: output,
      format: 'cjs',
      loader: { '.bin': 'file' },
    })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(output)
    assert.strictEqual(result.value, 'data.L3XDQOAT.bin')
    assert.strictEqual(result.__esModule, true)
  },

  async fileLoaderPublicPath({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const data = path.join(testDir, 'data.bin')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, `export {default as value} from ${JSON.stringify(data)}`)
    await writeFileAsync(data, `stuff`)
    const value = await esbuild.build({
      entryPoints: [input],
      bundle: true,
      outfile: output,
      format: 'cjs',
      loader: { '.bin': 'file' },
      publicPath: 'https://www.example.com/assets',
    })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(output)
    assert.strictEqual(result.value, 'https://www.example.com/assets/data.L3XDQOAT.bin')
    assert.strictEqual(result.__esModule, true)
  },

  async fileLoaderCSS({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.css')
    const data = path.join(testDir, 'data.bin')
    const output = path.join(testDir, 'out.css')
    await writeFileAsync(input, `body { background: url(${JSON.stringify(data)}) }`)
    await writeFileAsync(data, `stuff`)
    const value = await esbuild.build({
      entryPoints: [input],
      bundle: true,
      outfile: output,
      loader: { '.bin': 'file' },
      publicPath: 'https://www.example.com/assets',
    })
    assert.strictEqual(value.outputFiles, void 0)
    assert.strictEqual(await readFileAsync(output, 'utf8'), `/* scripts/.js-api-tests/fileLoaderCSS/in.css */
body {
  background: url(https://www.example.com/assets/data.L3XDQOAT.bin);
}
`)
  },

  async metafile({ esbuild, testDir }) {
    const entry = path.join(testDir, 'entry.js')
    const imported = path.join(testDir, 'imported.js')
    const text = path.join(testDir, 'text.txt')
    const output = path.join(testDir, 'out.js')
    const meta = path.join(testDir, 'meta.json')
    await writeFileAsync(entry, `
      import x from "./imported"
      import y from "./text.txt"
      console.log(x, y)
    `)
    await writeFileAsync(imported, 'export default 123')
    await writeFileAsync(text, 'some text')
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile: output,
      metafile: meta,
      sourcemap: true,
      loader: { '.txt': 'file' },
    })

    const json = JSON.parse(await readFileAsync(meta))
    assert.strictEqual(Object.keys(json.inputs).length, 3)
    assert.strictEqual(Object.keys(json.outputs).length, 3)
    const cwd = process.cwd()
    const makePath = absPath => path.relative(cwd, absPath).split(path.sep).join('/')

    // Check inputs
    assert.deepStrictEqual(json.inputs[makePath(entry)].bytes, 95)
    assert.deepStrictEqual(json.inputs[makePath(entry)].imports, [
      { path: makePath(imported) },
      { path: makePath(text) },
    ])
    assert.deepStrictEqual(json.inputs[makePath(imported)].bytes, 18)
    assert.deepStrictEqual(json.inputs[makePath(imported)].imports, [])
    assert.deepStrictEqual(json.inputs[makePath(text)].bytes, 9)
    assert.deepStrictEqual(json.inputs[makePath(text)].imports, [])

    // Check outputs
    assert.strictEqual(typeof json.outputs[makePath(output)].bytes, 'number')
    assert.strictEqual(typeof json.outputs[makePath(output) + '.map'].bytes, 'number')
    assert.deepStrictEqual(json.outputs[makePath(output) + '.map'].inputs, {})

    // Check inputs for main output
    const outputInputs = json.outputs[makePath(output)].inputs
    assert.strictEqual(Object.keys(outputInputs).length, 3)
    assert.strictEqual(typeof outputInputs[makePath(entry)].bytesInOutput, 'number')
    assert.strictEqual(typeof outputInputs[makePath(imported)].bytesInOutput, 'number')
    assert.strictEqual(typeof outputInputs[makePath(text)].bytesInOutput, 'number')
  },

  async metafileSplitting({ esbuild, testDir }) {
    const entry1 = path.join(testDir, 'entry1.js')
    const entry2 = path.join(testDir, 'entry2.js')
    const imported = path.join(testDir, 'imported.js')
    const outdir = path.join(testDir, 'out')
    const metafile = path.join(testDir, 'meta.json')
    await writeFileAsync(entry1, `
      import x from "./${path.basename(imported)}"
      console.log(1, x)
    `)
    await writeFileAsync(entry2, `
      import x from "./${path.basename(imported)}"
      console.log(2, x)
    `)
    await writeFileAsync(imported, 'export default 123')
    await esbuild.build({
      entryPoints: [entry1, entry2],
      bundle: true,
      outdir,
      metafile,
      splitting: true,
      format: 'esm',
    })

    const json = JSON.parse(await readFileAsync(metafile))
    assert.strictEqual(Object.keys(json.inputs).length, 3)
    assert.strictEqual(Object.keys(json.outputs).length, 3)
    const cwd = process.cwd()
    const makePath = basename => path.relative(cwd, path.join(outdir, basename)).split(path.sep).join('/')

    // Check outputs
    const chunk = 'chunk.ZSFI65PB.js';
    assert.deepStrictEqual(json.outputs[makePath(path.basename(entry1))].imports, [{ path: makePath(chunk) }])
    assert.deepStrictEqual(json.outputs[makePath(path.basename(entry2))].imports, [{ path: makePath(chunk) }])
    assert.deepStrictEqual(json.outputs[makePath(chunk)].imports, [])
  },

  async metafileCSS({ esbuild, testDir }) {
    const entry = path.join(testDir, 'entry.css')
    const imported = path.join(testDir, 'imported.css')
    const image = path.join(testDir, 'example.png')
    const output = path.join(testDir, 'out.css')
    const meta = path.join(testDir, 'meta.json')
    await writeFileAsync(entry, `
      @import "./imported";
      body { background: url(https://example.com/external.png) }
    `)
    await writeFileAsync(imported, `
      a { background: url(./example.png) }
    `)
    await writeFileAsync(image, 'an image')
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile: output,
      metafile: meta,
      sourcemap: true,
      loader: { '.png': 'dataurl' },
    })

    const json = JSON.parse(await readFileAsync(meta))
    assert.strictEqual(Object.keys(json.inputs).length, 3)
    assert.strictEqual(Object.keys(json.outputs).length, 1)
    const cwd = process.cwd()
    const makePath = absPath => path.relative(cwd, absPath).split(path.sep).join('/')

    // Check inputs
    assert.deepStrictEqual(json, {
      inputs: {
        [makePath(entry)]: { bytes: 98, imports: [{ path: makePath(imported) }] },
        [makePath(image)]: { bytes: 8, imports: [] },
        [makePath(imported)]: { bytes: 48, imports: [{ path: makePath(image) }] },
      },
      outputs: {
        [makePath(output)]: {
          bytes: 227,
          imports: [],
          inputs: {
            [makePath(entry)]: { bytesInOutput: 62 },
            [makePath(imported)]: { bytesInOutput: 61 },
          },
        },
      },
    })
  },

  // Test in-memory output files
  async writeFalse({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const output = path.join(testDir, 'out.js')
    const metafile = path.join(testDir, 'meta.json')
    const inputCode = 'console.log()'
    await writeFileAsync(input, inputCode)

    const value = await esbuild.build({
      entryPoints: [input],
      bundle: true,
      outfile: output,
      sourcemap: true,
      format: 'esm',
      metafile,
      write: false,
    })

    assert.strictEqual(fs.existsSync(output), false)
    assert.notStrictEqual(value.outputFiles, void 0)
    assert.strictEqual(value.outputFiles.length, 3)
    assert.strictEqual(value.outputFiles[0].path, output + '.map')
    assert.strictEqual(value.outputFiles[0].contents.constructor, Uint8Array)
    assert.strictEqual(value.outputFiles[1].path, output)
    assert.strictEqual(value.outputFiles[1].contents.constructor, Uint8Array)
    assert.strictEqual(value.outputFiles[2].path, metafile)
    assert.strictEqual(value.outputFiles[2].contents.constructor, Uint8Array)

    const sourceMap = JSON.parse(Buffer.from(value.outputFiles[0].contents).toString())
    const js = Buffer.from(value.outputFiles[1].contents).toString()
    assert.strictEqual(sourceMap.version, 3)
    assert.strictEqual(js, `// scripts/.js-api-tests/writeFalse/in.js\nconsole.log();\n//# sourceMappingURL=out.js.map\n`)

    const cwd = process.cwd()
    const makePath = file => path.relative(cwd, file).split(path.sep).join('/')
    const meta = JSON.parse(Buffer.from(value.outputFiles[2].contents).toString())
    assert.strictEqual(meta.inputs[makePath(input)].bytes, inputCode.length)
    assert.strictEqual(meta.outputs[makePath(output)].bytes, js.length)
    assert.strictEqual(meta.outputs[makePath(output + '.map')].bytes, value.outputFiles[0].contents.length)
  },

  async splittingRelativeSameDir({ esbuild, testDir }) {
    const inputA = path.join(testDir, 'a.js')
    const inputB = path.join(testDir, 'b.js')
    const inputCommon = path.join(testDir, 'common.js')
    await writeFileAsync(inputA, `
      import x from "./${path.basename(inputCommon)}"
      console.log('a' + x)
    `)
    await writeFileAsync(inputB, `
      import x from "./${path.basename(inputCommon)}"
      console.log('b' + x)
    `)
    await writeFileAsync(inputCommon, `
      export default 'common'
    `)
    const outdir = path.join(testDir, 'out')
    const value = await esbuild.build({ entryPoints: [inputA, inputB], bundle: true, outdir, format: 'esm', splitting: true, write: false })
    assert.strictEqual(value.outputFiles.length, 3)

    // These should all use forward slashes, even on Windows
    const chunk = 'chunk.CCY6SQWP.js'
    assert.strictEqual(Buffer.from(value.outputFiles[0].contents).toString(), `import {
  common_default
} from "./${chunk}";

// scripts/.js-api-tests/splittingRelativeSameDir/a.js
console.log("a" + common_default);
`)
    assert.strictEqual(Buffer.from(value.outputFiles[1].contents).toString(), `import {
  common_default
} from "./${chunk}";

// scripts/.js-api-tests/splittingRelativeSameDir/b.js
console.log("b" + common_default);
`)
    assert.strictEqual(Buffer.from(value.outputFiles[2].contents).toString(), `// scripts/.js-api-tests/splittingRelativeSameDir/common.js
var common_default = "common";

export {
  common_default
};
`)

    assert.strictEqual(value.outputFiles[0].path, path.join(outdir, path.basename(inputA)))
    assert.strictEqual(value.outputFiles[1].path, path.join(outdir, path.basename(inputB)))
    assert.strictEqual(value.outputFiles[2].path, path.join(outdir, chunk))
  },

  async splittingRelativeNestedDir({ esbuild, testDir }) {
    const inputA = path.join(testDir, 'a/demo.js')
    const inputB = path.join(testDir, 'b/demo.js')
    const inputCommon = path.join(testDir, 'common.js')
    await mkdirAsync(path.dirname(inputA)).catch(x => x)
    await mkdirAsync(path.dirname(inputB)).catch(x => x)
    await writeFileAsync(inputA, `
      import x from "../${path.basename(inputCommon)}"
      console.log('a' + x)
    `)
    await writeFileAsync(inputB, `
      import x from "../${path.basename(inputCommon)}"
      console.log('b' + x)
    `)
    await writeFileAsync(inputCommon, `
      export default 'common'
    `)
    const outdir = path.join(testDir, 'out')
    const value = await esbuild.build({ entryPoints: [inputA, inputB], bundle: true, outdir, format: 'esm', splitting: true, write: false })
    assert.strictEqual(value.outputFiles.length, 3)

    // These should all use forward slashes, even on Windows
    const chunk = 'chunk.5UCSUUDJ.js'
    assert.strictEqual(Buffer.from(value.outputFiles[0].contents).toString(), `import {
  common_default
} from "../${chunk}";

// scripts/.js-api-tests/splittingRelativeNestedDir/a/demo.js
console.log("a" + common_default);
`)
    assert.strictEqual(Buffer.from(value.outputFiles[1].contents).toString(), `import {
  common_default
} from "../${chunk}";

// scripts/.js-api-tests/splittingRelativeNestedDir/b/demo.js
console.log("b" + common_default);
`)
    assert.strictEqual(Buffer.from(value.outputFiles[2].contents).toString(), `// scripts/.js-api-tests/splittingRelativeNestedDir/common.js
var common_default = "common";

export {
  common_default
};
`)

    assert.strictEqual(value.outputFiles[0].path, path.join(outdir, path.relative(testDir, inputA)))
    assert.strictEqual(value.outputFiles[1].path, path.join(outdir, path.relative(testDir, inputB)))
    assert.strictEqual(value.outputFiles[2].path, path.join(outdir, chunk))
  },

  async stdinStdoutBundle({ esbuild, testDir }) {
    const auxiliary = path.join(testDir, 'auxiliary.js')
    await writeFileAsync(auxiliary, 'export default 123')
    const value = await esbuild.build({
      stdin: {
        contents: `
          import x from './auxiliary.js'
          console.log(x)
        `,
        resolveDir: testDir,
      },
      bundle: true,
      write: false,
    })
    assert.strictEqual(value.outputFiles.length, 1)
    assert.strictEqual(value.outputFiles[0].path, '<stdout>')
    assert.strictEqual(Buffer.from(value.outputFiles[0].contents).toString(), `(() => {
  // scripts/.js-api-tests/stdinStdoutBundle/auxiliary.js
  var auxiliary_default = 123;

  // <stdin>
  console.log(auxiliary_default);
})();
`)
  },

  async stdinOutfileBundle({ esbuild, testDir }) {
    const auxiliary = path.join(testDir, 'auxiliary.js')
    const outfile = path.join(testDir, 'out.js')
    await writeFileAsync(auxiliary, 'export default 123')
    const value = await esbuild.build({
      stdin: {
        contents: `
          import x from './auxiliary.js'
          export {x as fromStdin}
        `,
        resolveDir: testDir,
      },
      bundle: true,
      outfile,
      format: 'cjs',
    })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(outfile)
    assert.strictEqual(result.fromStdin, 123)
  },

  async stdinAndEntryBundle({ esbuild, testDir }) {
    const srcdir = path.join(testDir, 'src')
    const entry = path.join(srcdir, 'entry.js')
    const auxiliary = path.join(srcdir, 'auxiliary.js')
    const outdir = path.join(testDir, 'out')
    await mkdirAsync(srcdir)
    await writeFileAsync(auxiliary, 'export default 123')
    await writeFileAsync(entry, `
      import x from './auxiliary.js'
      export let fromEntry = x
    `)
    const value = await esbuild.build({
      entryPoints: [entry],
      stdin: {
        contents: `
          import x from './src/auxiliary.js'
          export {x as fromStdin}
        `,
        resolveDir: testDir,
      },
      bundle: true,
      outdir,
      format: 'cjs',
    })
    assert.strictEqual(value.outputFiles, void 0)
    const entryResult = require(path.join(outdir, path.basename(entry)))
    assert.strictEqual(entryResult.fromEntry, 123)
    const stdinResult = require(path.join(outdir, path.basename('stdin.js')))
    assert.strictEqual(stdinResult.fromStdin, 123)
  },

  async forceTsConfig({ esbuild, testDir }) {
    // ./tsconfig.json
    // ./a/forced-config.json
    // ./a/b/test-impl.js
    // ./a/b/c/in.js
    const aDir = path.join(testDir, 'a')
    const bDir = path.join(aDir, 'b')
    const cDir = path.join(bDir, 'c')
    await mkdirAsync(aDir).catch(x => x)
    await mkdirAsync(bDir).catch(x => x)
    await mkdirAsync(cDir).catch(x => x)
    const input = path.join(cDir, 'in.js')
    const forced = path.join(bDir, 'test-impl.js')
    const tsconfigIgnore = path.join(testDir, 'tsconfig.json')
    const tsconfigForced = path.join(aDir, 'forced-config.json')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, 'import "test"')
    await writeFileAsync(forced, 'console.log("success")')
    await writeFileAsync(tsconfigIgnore, '{"compilerOptions": {"baseUrl": "./a", "paths": {"test": ["./ignore.js"]}}}')
    await writeFileAsync(tsconfigForced, '{"compilerOptions": {"baseUrl": "./b", "paths": {"test": ["./test-impl.js"]}}}')
    await esbuild.build({ entryPoints: [input], bundle: true, outfile: output, tsconfig: tsconfigForced, format: 'esm' })
    const result = await readFileAsync(output, 'utf8')
    assert.strictEqual(result, `// scripts/.js-api-tests/forceTsConfig/a/b/test-impl.js
console.log("success");
`)
  },

  async es5({ esbuild, testDir }) {
    const input = path.join(testDir, 'in.js')
    const cjs = path.join(testDir, 'cjs.js')
    const esm = path.join(testDir, 'esm.js')
    const output = path.join(testDir, 'out.js')
    await writeFileAsync(input, `
      export {foo} from "./cjs"
      export * as bar from "./esm"
    `)
    await writeFileAsync(cjs, 'exports.foo = 123')
    await writeFileAsync(esm, 'export var foo = 123')
    const value = await esbuild.build({ entryPoints: [input], bundle: true, outfile: output, format: 'cjs', target: 'es5' })
    assert.strictEqual(value.outputFiles, void 0)
    const result = require(output)
    assert.strictEqual(result.foo, 123)
    assert.strictEqual(result.bar.foo, 123)
    assert.strictEqual(result.__esModule, true)
    const contents = await readFileAsync(output, 'utf8')
    assert.strictEqual(contents.indexOf('=>'), -1)
    assert.strictEqual(contents.indexOf('const'), -1)
  },
}

async function futureSyntax(service, js, targetBelow, targetAbove) {
  failure: {
    try { await service.transform(js, { target: targetBelow }) }
    catch { break failure }
    throw new Error(`Expected failure for ${targetBelow}: ${js}`)
  }

  try { await service.transform(js, { target: targetAbove }) }
  catch (e) { throw new Error(`Expected success for ${targetAbove}: ${js}\n${e}`) }
}

let transformTests = {
  async ignoreUndefinedOptions({ service }) {
    // This should not throw
    await service.transform(``, { jsxFactory: void 0 })
  },

  async ignoreUndefinedOptions({ service }) {
    // This should throw
    try {
      await service.transform(``, { jsxFactory: ['React', 'createElement'] })
      throw new Error('Expected transform failure');
    } catch (e) {
      if (e.message !== '"jsxFactory" must be a string') {
        throw e;
      }
    }
  },

  async avoidTDZ({ service }) {
    for (const avoidTDZ of [false, true]) {
      var { js } = await service.transform(`
        class Foo {
          // The above line will be transformed into "var". However, the
          // symbol "Foo" must still be defined before the class body ends.
          static foo = new Foo
        }
        if (!(Foo.foo instanceof Foo))
          throw 'fail: avoidTDZ=${avoidTDZ}'
      `, {
        avoidTDZ,
      })
      new Function(js)()
    }
  },

  async tsAvoidTDZ({ service }) {
    for (const avoidTDZ of [false, true]) {
      var { js } = await service.transform(`
        class Bar {}
        var oldFoo
        function swap(target) {
          oldFoo = target
          return Bar
        }
        @swap
        class Foo {
          bar() { return new Foo }
          static foo = new Foo
        }
        if (!(oldFoo.foo instanceof oldFoo))
          throw 'fail: foo, avoidTDZ=${avoidTDZ}'
        if (!(oldFoo.foo.bar() instanceof Bar))
          throw 'fail: bar, avoidTDZ=${avoidTDZ}'
      `, {
        avoidTDZ,
        loader: 'ts',
      })
      new Function(js)()
    }
  },

  async jsCharsetDefault({ service }) {
    const { js } = await service.transform(`let π = 'π'`, {})
    assert.strictEqual(js, `let \\u03C0 = "\\u03C0";\n`)
  },

  async jsCharsetASCII({ service }) {
    const { js } = await service.transform(`let π = 'π'`, { charset: 'ascii' })
    assert.strictEqual(js, `let \\u03C0 = "\\u03C0";\n`)
  },

  async jsCharsetUTF8({ service }) {
    const { js } = await service.transform(`let π = 'π'`, { charset: 'utf8' })
    assert.strictEqual(js, `let π = "π";\n`)
  },

  async cssCharsetDefault({ service }) {
    const { js } = await service.transform(`.π:after { content: 'π' }`, { loader: 'css' })
    assert.strictEqual(js, `.\\3c0:after {\n  content: "\\3c0";\n}\n`)
  },

  async cssCharsetASCII({ service }) {
    const { js } = await service.transform(`.π:after { content: 'π' }`, { loader: 'css', charset: 'ascii' })
    assert.strictEqual(js, `.\\3c0:after {\n  content: "\\3c0";\n}\n`)
  },

  async cssCharsetUTF8({ service }) {
    const { js } = await service.transform(`.π:after { content: 'π' }`, { loader: 'css', charset: 'utf8' })
    assert.strictEqual(js, `.π:after {\n  content: "π";\n}\n`)
  },

  async cjs_require({ service }) {
    const { js } = await service.transform(`const {foo} = require('path')`, {})
    assert.strictEqual(js, `const {foo} = require("path");\n`)
  },

  async cjs_exports({ service }) {
    const { js } = await service.transform(`exports.foo = 123`, {})
    assert.strictEqual(js, `exports.foo = 123;\n`)
  },

  async es6_import({ service }) {
    const { js } = await service.transform(`import {foo} from 'path'`, {})
    assert.strictEqual(js, `import {foo} from "path";\n`)
  },

  async es6_export({ service }) {
    const { js } = await service.transform(`export const foo = 123`, {})
    assert.strictEqual(js, `export const foo = 123;\n`)
  },

  async es6_import_to_iife({ service }) {
    const { js } = await service.transform(`import {exists} from "fs"; if (!exists) throw 'fail'`, { format: 'iife' })
    new Function('require', js)(require)
  },

  async es6_import_star_to_iife({ service }) {
    const { js } = await service.transform(`import * as fs from "fs"; if (!fs.exists) throw 'fail'`, { format: 'iife' })
    new Function('require', js)(require)
  },

  async es6_export_to_iife({ service }) {
    const { js } = await service.transform(`export {exists} from "fs"`, { format: 'iife', globalName: 'out' })
    const out = new Function('require', js + ';return out')(require)
    if (out.exists !== fs.exists) throw 'fail'
  },

  async es6_export_star_to_iife({ service }) {
    const { js } = await service.transform(`export * from "fs"`, { format: 'iife', globalName: 'out' })
    const out = new Function('require', js + ';return out')(require)
    if (out.exists !== fs.exists) throw 'fail'
  },

  async es6_export_star_as_to_iife({ service }) {
    const { js } = await service.transform(`export * as fs from "fs"`, { format: 'iife', globalName: 'out' })
    const out = new Function('require', js + ';return out')(require)
    if (out.fs.exists !== fs.exists) throw 'fail'
  },

  async es6_import_to_cjs({ service }) {
    const { js } = await service.transform(`import {exists} from "fs"; if (!exists) throw 'fail'`, { format: 'cjs' })
    new Function('require', js)(require)
  },

  async es6_import_star_to_cjs({ service }) {
    const { js } = await service.transform(`import * as fs from "fs"; if (!fs.exists) throw 'fail'`, { format: 'cjs' })
    new Function('require', js)(require)
  },

  async es6_export_to_cjs({ service }) {
    const { js } = await service.transform(`export {exists} from "fs"`, { format: 'cjs' })
    const exports = {}
    new Function('require', 'exports', js)(require, exports)
    if (exports.exists !== fs.exists) throw 'fail'
  },

  async es6_export_star_to_cjs({ service }) {
    const { js } = await service.transform(`export * from "fs"`, { format: 'cjs' })
    const exports = {}
    new Function('require', 'exports', js)(require, exports)
    if (exports.exists !== fs.exists) throw 'fail'
  },

  async es6_export_star_as_to_cjs({ service }) {
    const { js } = await service.transform(`export * as fs from "fs"`, { format: 'cjs' })
    const exports = {}
    new Function('require', 'exports', js)(require, exports)
    if (exports.fs.exists !== fs.exists) throw 'fail'
  },

  async es6_import_to_esm({ service }) {
    const { js } = await service.transform(`import {exists} from "fs"; if (!exists) throw 'fail'`, { format: 'esm' })
    assert.strictEqual(js, `import {exists} from "fs";\nif (!exists)\n  throw "fail";\n`)
  },

  async es6_import_star_to_esm({ service }) {
    const { js } = await service.transform(`import * as fs from "fs"; if (!fs.exists) throw 'fail'`, { format: 'esm' })
    assert.strictEqual(js, `import * as fs from "fs";\nif (!fs.exists)\n  throw "fail";\n`)
  },

  async es6_export_to_esm({ service }) {
    const { js } = await service.transform(`export {exists} from "fs"`, { format: 'esm' })
    assert.strictEqual(js, `import {exists} from "fs";\nexport {\n  exists\n};\n`)
  },

  async es6_export_star_to_esm({ service }) {
    const { js } = await service.transform(`export * from "fs"`, { format: 'esm' })
    assert.strictEqual(js, `export * from "fs";\n`)
  },

  async es6_export_star_as_to_esm({ service }) {
    const { js } = await service.transform(`export * as fs from "fs"`, { format: 'esm' })
    assert.strictEqual(js, `import * as fs from "fs";\nexport {\n  fs\n};\n`)
  },

  async jsx({ service }) {
    const { js } = await service.transform(`console.log(<div/>)`, { loader: 'jsx' })
    assert.strictEqual(js, `console.log(/* @__PURE__ */ React.createElement("div", null));\n`)
  },

  async ts({ service }) {
    const { js } = await service.transform(`enum Foo { FOO }`, { loader: 'ts' })
    assert.strictEqual(js, `var Foo;\n(function(Foo2) {\n  Foo2[Foo2["FOO"] = 0] = "FOO";\n})(Foo || (Foo = {}));\n`)
  },

  async tsx({ service }) {
    const { js } = await service.transform(`console.log(<Foo<T>/>)`, { loader: 'tsx' })
    assert.strictEqual(js, `console.log(/* @__PURE__ */ React.createElement(Foo, null));\n`)
  },

  async minify({ service }) {
    const { js } = await service.transform(`console.log("a" + "b" + c)`, { minify: true })
    assert.strictEqual(js, `console.log("ab"+c);\n`)
  },

  async define({ service }) {
    const define = { 'process.env.NODE_ENV': '"production"' }
    const { js } = await service.transform(`console.log(process.env.NODE_ENV)`, { define })
    assert.strictEqual(js, `console.log("production");\n`)
  },

  async json({ service }) {
    const { js } = await service.transform(`{ "x": "y" }`, { loader: 'json' })
    assert.strictEqual(js, `module.exports = {x: "y"};\n`)
  },

  async jsonMinified({ service }) {
    const { js } = await service.transform(`{ "x": "y" }`, { loader: 'json', minify: true })
    const module = {}
    new Function('module', js)(module)
    assert.deepStrictEqual(module.exports, { x: 'y' })
  },

  async jsonESM({ service }) {
    const { js } = await service.transform(`{ "x": "y" }`, { loader: 'json', format: 'esm' })
    assert.strictEqual(js, `var x = "y";\nvar stdin_default = {x};\nexport {\n  stdin_default as default,\n  x\n};\n`)
  },

  async text({ service }) {
    const { js } = await service.transform(`This is some text`, { loader: 'text' })
    assert.strictEqual(js, `module.exports = "This is some text";\n`)
  },

  async textESM({ service }) {
    const { js } = await service.transform(`This is some text`, { loader: 'text', format: 'esm' })
    assert.strictEqual(js, `var stdin_default = "This is some text";\nexport {\n  stdin_default as default\n};\n`)
  },

  async base64({ service }) {
    const { js } = await service.transform(`\x00\x01\x02`, { loader: 'base64' })
    assert.strictEqual(js, `module.exports = "AAEC";\n`)
  },

  async dataurl({ service }) {
    const { js } = await service.transform(`\x00\x01\x02`, { loader: 'dataurl' })
    assert.strictEqual(js, `module.exports = "data:application/octet-stream;base64,AAEC";\n`)
  },

  async sourceMapWithName({ service }) {
    const { js, jsSourceMap } = await service.transform(`let       x`, { sourcemap: true, sourcefile: 'afile.js' })
    assert.strictEqual(js, `let x;\n`)
    await assertSourceMap(jsSourceMap, 'afile.js')
  },

  async sourceMapExternalWithName({ service }) {
    const { js, jsSourceMap } = await service.transform(`let       x`, { sourcemap: 'external', sourcefile: 'afile.js' })
    assert.strictEqual(js, `let x;\n`)
    await assertSourceMap(jsSourceMap, 'afile.js')
  },

  async sourceMapInlineWithName({ service }) {
    const { js, jsSourceMap } = await service.transform(`let       x`, { sourcemap: 'inline', sourcefile: 'afile.js' })
    assert(js.startsWith(`let x;\n//# sourceMappingURL=`))
    assert.strictEqual(jsSourceMap, '')
    const base64 = js.slice(js.indexOf('base64,') + 'base64,'.length)
    await assertSourceMap(Buffer.from(base64.trim(), 'base64').toString(), 'afile.js')
  },

  async numericLiteralPrinting({ service }) {
    async function checkLiteral(text) {
      const { js } = await service.transform(`return ${text}`, { minify: true })
      assert.strictEqual(+text, new Function(js)())
    }
    const promises = []
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        promises.push(checkLiteral(`0.${'0'.repeat(i)}${'123456789'.slice(0, j)}`))
        promises.push(checkLiteral(`1${'0'.repeat(i)}.${'123456789'.slice(0, j)}`))
        promises.push(checkLiteral(`1${'123456789'.slice(0, j)}${'0'.repeat(i)}`))
      }
    }
    await Promise.all(promises)
  },

  async tryCatchScopeMerge({ service }) {
    const code = `
      var x = 1
      if (x !== 1) throw 'fail'
      try {
        throw 2
      } catch (x) {
        if (x !== 2) throw 'fail'
        {
          if (x !== 2) throw 'fail'
          var x = 3
          if (x !== 3) throw 'fail'
        }
        if (x !== 3) throw 'fail'
      }
      if (x !== 1) throw 'fail'
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async nestedFunctionHoist({ service }) {
    const code = `
      if (x !== void 0) throw 'fail'
      {
        if (x !== void 0) throw 'fail'
        {
          x()
          function x() {}
          x()
        }
        x()
      }
      x()
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async nestedFunctionHoistBefore({ service }) {
    const code = `
      var x = 1
      if (x !== 1) throw 'fail'
      {
        if (x !== 1) throw 'fail'
        {
          x()
          function x() {}
          x()
        }
        x()
      }
      x()
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async nestedFunctionHoistAfter({ service }) {
    const code = `
      if (x !== void 0) throw 'fail'
      {
        if (x !== void 0) throw 'fail'
        {
          x()
          function x() {}
          x()
        }
        x()
      }
      x()
      var x = 1
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async nestedFunctionShadowBefore({ service }) {
    const code = `
      let x = 1
      if (x !== 1) throw 'fail'
      {
        if (x !== 1) throw 'fail'
        {
          x()
          function x() {}
          x()
        }
        if (x !== 1) throw 'fail'
      }
      if (x !== 1) throw 'fail'
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async nestedFunctionShadowAfter({ service }) {
    const code = `
      try { x; throw 'fail' } catch (e) { if (!(e instanceof ReferenceError)) throw e }
      {
        try { x; throw 'fail' } catch (e) { if (!(e instanceof ReferenceError)) throw e }
        {
          x()
          function x() {}
          x()
        }
        try { x; throw 'fail' } catch (e) { if (!(e instanceof ReferenceError)) throw e }
      }
      try { x; throw 'fail' } catch (e) { if (!(e instanceof ReferenceError)) throw e }
      let x = 1
    `;
    new Function(code)(); // Verify that the code itself is correct
    new Function((await service.transform(code)).js)();
  },

  async sourceMapControlCharacterEscapes({ service }) {
    let code = ''
    for (let i = 0; i < 32; i++) code += String.fromCharCode(i);
    const input = `return \`${code}\``;
    const { js, jsSourceMap } = await service.transform(input, { sourcemap: true, sourcefile: 'afile.js' })
    const fn = new Function(js)
    assert.strictEqual(fn(), code.replace('\r', '\n'))
    const map = JSON.parse(jsSourceMap)
    assert.strictEqual(map.version, 3)
    assert.strictEqual(map.sourcesContent.length, 1)
    assert.strictEqual(map.sourcesContent[0], input)
  },

  async tsDecorators({ service }) {
    const { js } = await service.transform(`
      let observed = [];
      let on = key => (...args) => {
        observed.push({ key, args });
      };

      @on('class')
      class Foo {
        @on('field') field;
        @on('method') method() { }
        @on('staticField') static staticField;
        @on('staticMethod') static staticMethod() { }
        fn(@on('param') x) { }
        static staticFn(@on('staticParam') x) { }
      }

      // This is what the TypeScript compiler itself generates
      let expected = [
        { key: 'field', args: [Foo.prototype, 'field', undefined] },
        { key: 'method', args: [Foo.prototype, 'method', { value: Foo.prototype.method, writable: true, enumerable: false, configurable: true }] },
        { key: 'param', args: [Foo.prototype, 'fn', 0] },
        { key: 'staticField', args: [Foo, 'staticField', undefined] },
        { key: 'staticMethod', args: [Foo, 'staticMethod', { value: Foo.staticMethod, writable: true, enumerable: false, configurable: true }] },
        { key: 'staticParam', args: [Foo, 'staticFn', 0] },
        { key: 'class', args: [Foo] }
      ];

      return {observed, expected};
    `, { loader: 'ts' });
    const { observed, expected } = new Function(js)();
    assert.deepStrictEqual(observed, expected);
  },

  async nullishCoalescingLoose({ service }) {
    const { js } = await service.transform(`a ?? b`, { target: 'es2019', strict: false })
    assert.strictEqual(js, `a != null ? a : b;\n`)
  },

  async nullishCoalescingStrict({ service }) {
    const { js } = await service.transform(`a ?? b`, { target: 'es2019', strict: true })
    assert.strictEqual(js, `a !== null && a !== void 0 ? a : b;\n`)
  },

  async nullishCoalescingStrictExplicit({ service }) {
    const { js } = await service.transform(`a ?? b`, { target: 'es2019', strict: ['nullish-coalescing'] })
    assert.strictEqual(js, `a !== null && a !== void 0 ? a : b;\n`)
  },

  async optionalChainingLoose({ service }) {
    const { js } = await service.transform(`a?.b`, { target: 'es2019', strict: false })
    assert.strictEqual(js, `a == null ? void 0 : a.b;\n`)
  },

  async optionalChainingStrict({ service }) {
    const { js } = await service.transform(`a?.b`, { target: 'es2019', strict: true })
    assert.strictEqual(js, `a === null || a === void 0 ? void 0 : a.b;\n`)
  },

  async optionalChainingStrictExplicit({ service }) {
    const { js } = await service.transform(`a?.b`, { target: 'es2019', strict: ['optional-chaining'] })
    assert.strictEqual(js, `a === null || a === void 0 ? void 0 : a.b;\n`)
  },

  async pureCallPrint({ service }) {
    const { js: js1 } = await service.transform(`print(123, foo)`, { minifySyntax: true, pure: [] })
    assert.strictEqual(js1, `print(123, foo);\n`)

    const { js: js2 } = await service.transform(`print(123, foo)`, { minifySyntax: true, pure: ['print'] })
    assert.strictEqual(js2, `foo;\n`)
  },

  async pureCallConsoleLog({ service }) {
    const { js: js1 } = await service.transform(`console.log(123, foo)`, { minifySyntax: true, pure: [] })
    assert.strictEqual(js1, `console.log(123, foo);\n`)

    const { js: js2 } = await service.transform(`console.log(123, foo)`, { minifySyntax: true, pure: ['console.log'] })
    assert.strictEqual(js2, `foo;\n`)
  },

  async multipleEngineTargets({ service }) {
    const check = async (target, expected) =>
      assert.strictEqual((await service.transform(`foo(a ?? b)`, { target })).js, expected)
    await Promise.all([
      check('es2020', `foo(a ?? b);\n`),
      check('es2019', `foo(a != null ? a : b);\n`),

      check('chrome80', `foo(a ?? b);\n`),
      check('chrome79', `foo(a != null ? a : b);\n`),

      check(['es2020', 'chrome80'], `foo(a ?? b);\n`),
      check(['es2020', 'chrome79'], `foo(a != null ? a : b);\n`),
      check(['es2019', 'chrome80'], `foo(a != null ? a : b);\n`),
    ])
  },

  // Future syntax
  forAwait: ({ service }) => futureSyntax(service, 'async function foo() { for await (let x of y) {} }', 'es2017', 'es2018'),
  bigInt: ({ service }) => futureSyntax(service, '123n', 'es2019', 'es2020'),
  bigIntKey: ({ service }) => futureSyntax(service, '({123n: 0})', 'es2019', 'es2020'),
  bigIntPattern: ({ service }) => futureSyntax(service, 'let {123n: x} = y', 'es2019', 'es2020'),
  nonIdArrayRest: ({ service }) => futureSyntax(service, 'let [...[x]] = y', 'es2015', 'es2016'),
  topLevelAwait: ({ service }) => futureSyntax(service, 'await foo', 'es2020', 'esnext'),
  topLevelForAwait: ({ service }) => futureSyntax(service, 'for await (foo of bar) ;', 'es2020', 'esnext'),

  // Future syntax: async generator functions
  asyncGenFnStmt: ({ service }) => futureSyntax(service, 'async function* foo() {}', 'es2017', 'es2018'),
  asyncGenFnExpr: ({ service }) => futureSyntax(service, '(async function*() {})', 'es2017', 'es2018'),
  asyncGenObjFn: ({ service }) => futureSyntax(service, '({ async* foo() {} })', 'es2017', 'es2018'),
  asyncGenClassStmtFn: ({ service }) => futureSyntax(service, 'class Foo { async* foo() {} }', 'es2017', 'es2018'),
  asyncGenClassExprFn: ({ service }) => futureSyntax(service, '(class { async* foo() {} })', 'es2017', 'es2018'),
}

let syncTests = {
  async buildSync({ esbuild, testDir }) {
    const input = path.join(testDir, 'buildSync-in.js')
    const output = path.join(testDir, 'buildSync-out.js')
    await writeFileAsync(input, 'export default 123')
    esbuild.buildSync({ entryPoints: [input], bundle: true, outfile: output, format: 'cjs' })
    const result = require(output)
    assert.strictEqual(result.default, 123)
    assert.strictEqual(result.__esModule, true)
  },

  async transformSync({ esbuild }) {
    const { js } = esbuild.transformSync(`console.log(1+2)`, {})
    assert.strictEqual(js, `console.log(1 + 2);\n`)
  },
}

async function assertSourceMap(jsSourceMap, source) {
  const map = await new SourceMapConsumer(jsSourceMap)
  const original = map.originalPositionFor({ line: 1, column: 4 })
  assert.strictEqual(original.source, source)
  assert.strictEqual(original.line, 1)
  assert.strictEqual(original.column, 10)
}

async function main() {
  // Start the esbuild service
  const esbuild = installForTests(rootTestDir)
  const service = await esbuild.startService()

  // Run all tests concurrently
  const runTest = async ([name, fn]) => {
    let testDir = path.join(rootTestDir, name)
    try {
      await mkdirAsync(testDir)
      await fn({ esbuild, service, testDir })
      rimraf.sync(testDir, { disableGlob: true })
      return true
    } catch (e) {
      console.error(`❌ ${name}: ${e && e.message || e}`)
      return false
    }
  }
  const tests = [
    ...Object.entries(buildTests),
    ...Object.entries(transformTests),
    ...Object.entries(syncTests),
  ]
  const allTestsPassed = (await Promise.all(tests.map(runTest))).every(success => success)

  // Clean up test output
  service.stop()

  if (!allTestsPassed) {
    console.error(`❌ js api tests failed`)
    process.exit(1)
  } else {
    console.log(`✅ js api tests passed`)

    // This randomly fails with EPERM on Windows in CI (GitHub Actions):
    //
    //   Error: EPERM: operation not permitted: unlink 'esbuild\scripts\.js-api-tests\node_modules\esbuild\esbuild.exe'
    //       at Object.unlinkSync (fs.js)
    //       at fixWinEPERMSync (esbuild\scripts\node_modules\rimraf\rimraf.js)
    //       at rimrafSync (esbuild\scripts\node_modules\rimraf\rimraf.js)
    //
    // From searching related issues on GitHub it looks like apparently this is
    // just how Windows works? It's kind of hard to believe something as
    // fundamental as file operations is broken on Windows. It sounds like the
    // file system implementation on Windows has race conditions or something.
    // Anyway, deleting this is not important for the success of the test so
    // just ignore errors here.
    try {
      rimraf.sync(rootTestDir, { disableGlob: true })
    } catch (e) {
    }
  }
}

main().catch(e => setTimeout(() => { throw e }))
