# loom

Obsidian plugin for executing ordinary fenced Markdown code blocks

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

loom includes built in runners for almost every language. The list is too extensive for me to type out because I'm lazy. Additional local languages can be added from the settings tab under **Custom Languages**. A custom language defines:

- name
- comma separated aliases
- executable
- arguments like `{file}`
- source file extension

For example a custom shell alias could use:

```text
name: shell-custom
aliases: shx
executable: /bin/sh
args: {file}
extension: .sh
```

Then a normal fenced block can run as:

````markdown
```shx
echo hello
```
````

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

## Container execution

Notes can opt into container or VM execution with frontmatter:

```yaml
loom-container: py-sandbox
```

Container groups live inside the plugin folder:

```text
.obsidian/plugins/loom/containers/<group-name>/
```

Each group needs a `config.json`:

```json
{
  "runtime": "docker",
  "image": "python:3.12-slim",
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

Optional health checks can be added at the group level or under `qemu` / `custom`:

```json
{
  "healthCheck": {
    "command": "docker info",
    "positiveResponse": "Server Version",
    "negativeResponse": "Cannot connect"
  }
}
```

QEMU ex:

```json
{
  "runtime": "qemu",
  "qemu": {
    "sshTarget": "loom-vm",
    "remoteWorkspace": "/workspace",
    "sshArgs": "-o BatchMode=yes",
    "startCommand": "./start-vm.sh",
    "buildCommand": "./build-image.sh",
    "teardownCommand": "./stop-vm.sh",
    "healthCheck": {
      "command": "ssh loom-vm true"
    }
  },
  "languages": {
    "c": {
      "command": "gcc {file} -o /tmp/loom-c && /tmp/loom-c",
      "extension": ".c"
    }
  }
}
```

Custom wrapper:

```json
{
  "runtime": "custom",
  "custom": {
    "executable": "./loom-runtime.sh",
    "args": "{request}",
    "build": "./build.sh",
    "commandStructure": "{command}",
    "teardown": "./teardown.sh",
    "healthCheck": {
      "command": "./loom-runtime.sh --health",
      "positiveResponse": "ok"
    }
  },
  "languages": {
    "python": {
      "command": "python3 {file}",
      "extension": ".py"
    }
  }
}
```

For custom runtimes loom writes a request JSON file and passes its path through `{request}` and the relevant runtime config.

`{group}` and `{groupPath}` are also available in wrapper args


## Toolchain(s)

Some languages are only usable when their toolchain is installed/visible to Obsidian

## Build

```bash
npm install --legacy-peer-deps
```

```bash
npm run build
```
