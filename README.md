# loom

Obsidian plugin for executing ordinary fenced Markdown code blocks. 

The plugin is intended for research and exploratory work whereby proofs/solver queries and similar artefacts should remain readable directly within the document. loom augments existing code blocks with execution controls and renders transient output beneath the block. The source block itself is left unchanged and isn't rewritten into a plugin specific representation


## Model

loom treats a fenced block as an executable unit when the fence info string resolves to a supported language alias. The parser walks the active Markdown buffer and skips managed loom output sections and then normalises the fence language as well as creating a stable block descriptor

Each block receives an ID derived from:

- vault relative file path
- supported block ordinal
- normalised language
- source content hash

That ID is used for output replacement and toolbar state therefore rerunning a block updates the existing output panel instead of appending another panel

## Supported languages

Use your brain

## Runner contract

Runners implement this interface:

```ts
interface loomRunner {
  id: string;
  displayName: string;
  languages: readonly loomNormalizedLanguage[];
  canRun(block: loomCodeBlock, settings: loomPluginSettings): boolean;
  run(
    block: loomCodeBlock,
    context: loomRunContext,
    settings: loomPluginSettings
  ): Promise<loomRunResult>;
}
```

 A runner decides whether it can handle a block from the language and settings and then returns a `loomRunResult`


## Managed output

By default loom doesn't write output into the note. If `Write output back to note` is enabled then loom writes managed regions under blocks:

````markdown
<!-- loom:output:start id=<stable-block-id> -->
```text
runner=Python
exit=0
duration=8ms
timestamp=2026-06-20T00:00:00.000Z

stdout:
hello
```
<!-- loom:output:end -->
````

The parser skips these regions and generated output blocks are never executed


## Toolchain(s)

Some languages are only usable when their toolchain is installed/visible to Obsidian

## Build

```bash
npm install --legacy-peer-deps
```

```bash
npm run build
```
