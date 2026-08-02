---
title: "Owl 3 Internals, Part 1: Architecture and Bootstrap"
date: "2026-08-01"
summary: "Owl 3 is four npm packages with one deliberate hole in the middle. Here's the dependency graph, the build system, and every function that runs between mount() and the first insertBefore."
tags: [owl, framework-internals, architecture, javascript]
series: "Owl 3 Internals"
order: 1
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 1 of 12*

> Where the code lives, why it's split the way it is, and a full trace of what happens
> between `mount(App, document.body)` and the first real DOM node appearing.

---

## 1. Four packages, one hole

```
owl/
├── packages/
│   ├── owl-core/       zero DOM: reactivity, scope, plugins, validation
│   ├── owl-compiler/   XML → JS source string (needs a DOMParser)
│   ├── owl-runtime/    blockdom + components + fibers + scheduler
│   └── owl/            facade: runtime + compiler, wired together
├── tools/
│   ├── playground/     the online editor
│   ├── devtools/       browser extension
│   └── owl-vision/     VSCode extension
└── doc/                vitepress; v2 and v3 docs ship side by side
```

The split is not cosmetic.

`owl-core` has no DOM dependency anywhere. You can `import { signal, computed, effect }` in
plain Node and it works - Odoo runs Owl's reactivity in non-browser contexts, and the
devtools extension reuses it. Its test suite runs under `environment: "node"` for exactly
this reason.

`owl-compiler` needs `DOMParser`, so it drags in `jsdom` for the ahead-of-time path.

`owl-runtime` depends only on core. Interesting detail: it lists `@odoo/owl-compiler` as a
**dev**dependency, not a dependency. It only wants the types. And its `TemplateSet` has a
method that does nothing but throw:

```ts
// template_set.ts
private _compileTemplate(name: string, template: string | Element) {
    throw new OwlError(`Unable to compile a template. Please use owl full build instead`);
}
```

That's the hole. The `owl` package is the only thing that fills it, and filling it is
literally the whole package:

```ts
// packages/owl/src/index.ts
import { TemplateSet } from "@odoo/owl-runtime";
import { compile, parseXML } from "@odoo/owl-compiler";

export * from "@odoo/owl-runtime";

(TemplateSet.prototype as any)._compileTemplate = function (name, template) {
    return compile(template, {
        name, dev: this.dev, translateFn: this.translateFn,
        translatableAttributes: this.translatableAttributes,
        customDirectives: this.customDirectives,
        hasGlobalValues: this.hasGlobalValues,
    });
};
(TemplateSet.prototype as any)._parseXML = function (xml) { return parseXML(xml); };
```

Twenty-four lines. If you precompile your templates you import from `owl-runtime` directly
and never pay for the compiler. No tree-shaking gymnastics, no conditional exports, no
build flags - just a method that isn't there until something assigns it.

---

## 2. The dependency graph

```
        ┌──────────────────────────────┐
        │        @odoo/owl             │  facade
        │  injects compiler into       │
        │  TemplateSet.prototype       │
        └───────┬──────────────┬───────┘
                │              │
     ┌──────────▼───┐   ┌──────▼───────────┐
     │ owl-runtime  │   │  owl-compiler    │
     │  app.ts      │   │  parser.ts       │
     │  component_  │   │  code_generator  │
     │   node.ts    │   │  inline_expr     │
     │  fibers.ts   │   └──────┬───────────┘
     │  scheduler   │          │
     │  blockdom/   │          │
     └──────┬───────┘          │
            └────────┬─────────┘
                     ▼
            ┌─────────────────┐
            │    owl-core     │  no DOM
            │ computations.ts │
            │ signal/computed │
            │ effect/proxy    │
            │ scope.ts        │
            │ plugin_manager  │
            │ types.ts        │
            └─────────────────┘
```

Build order is spelled out in the root `package.json` and it matches the arrows:

```
owl-core → owl-compiler → owl-runtime → owl
```

---

## 3. The runtime object graph

Three objects matter at runtime, and one of them wears three hats.

```
┌────────────────────────────────────────────────────────────┐
│                          App                               │
│  extends TemplateSet                                       │
│  ├─ scheduler: Scheduler        (rAF-driven commit queue)  │
│  ├─ pluginManager: PluginManager   (root DI scope)         │
│  ├─ roots: Set<Root>                                       │
│  └─ templates: { name → compiled fn }                      │
└─────────────────────────┬──────────────────────────────────┘
                          │ createRoot(C, { props })
                          ▼
┌────────────────────────────────────────────────────────────┐
│           ComponentNode extends Scope implements VNode      │
│  ├─ component: Component         (the user's instance)     │
│  ├─ renderFn: bound template fn                            │
│  ├─ signalComputation            ◄── the reactive edge     │
│  ├─ bdom: BDom | null            (committed vdom)          │
│  ├─ fiber: Fiber | null          (in-flight render)        │
│  ├─ children: { key → ComponentNode }                      │
│  └─ willStart / mounted / willPatch / patched / ...        │
└─────────────────────────┬──────────────────────────────────┘
                          │ renderFn() → BDom tree
                          ▼
┌────────────────────────────────────────────────────────────┐
│                        blockdom                            │
│  Block (generated)  VList  VMulti  VText  VToggler         │
│  VHtml  VCatcher  ComponentNode  ◄── yes, again            │
└────────────────────────────────────────────────────────────┘
```

`ComponentNode` is simultaneously a **Scope** (lifetime and DI), a **VNode** (mount, patch,
remove), and the owner of a **reactive computation**. Three roles in one object, which saves
three allocations and three pointer chases per component. It also means `ComponentNode` is
the single busiest file in the runtime, and you'll be back in it constantly.

---

## 4. Bootstrap, traced

Here's the full call chain from a cold `mount()`. I've kept every function that does
something non-obvious.

```
mount(C, target, config)                            app.ts
 │
 ├─ new App(config)
 │    ├─ super(config)  →  TemplateSet ctor
 │    ├─ new PluginManager(this, { config })
 │    └─ startPlugins(...)   or   status = MOUNTED
 │
 ├─ await app.pluginManager.ready        ← only if plugins have onWillStart
 │
 ├─ app.createRoot(C, config)
 │    └─ new ComponentNode(C, props, app, null, null)
 │         ├─ scopeStack.push(this)          ← hooks can now find us
 │         ├─ setComputation(undefined)      ← construction is NOT tracked
 │         ├─ this.component = new C(this)   ← class field initializers run
 │         ├─ this.renderFn = app.getTemplate(C.template)
 │         │                     .bind(component, ctx, this)
 │         ├─ this.component.setup()         ← hooks register here
 │         └─ scopeStack.pop()
 │
 └─ root.mount(target)
      ├─ prepare()
      │    ├─ fiber = new MountFiber(node, null)
      │    ├─ scheduler.addFiber(fiber)
      │    └─ node.willStart.length ? node.initiateRender(fiber)
      │                             : fiber.render()
      │
      └─ fiber.commit(target)
           └─ when counter hits 0 → complete() → _mount()
                └─ blockdom mount() → ONE insertBefore
```

Two things in there deserve their own paragraph.

### `setComputation(undefined)` around construction

This single line is the thing that makes Owl 3 different from Owl 2:

```ts
const previousComputation = getCurrentComputation();
setComputation(undefined);
scopeStack.push(this);
try {
    this.component = new C(this);
    this.renderFn = app.getTemplate(C.template).bind(this.component, ctx, this);
    this.component.setup();
} finally {
    scopeStack.pop();
    setComputation(previousComputation);
}
```

Reading a signal in `setup()`, or in a class field initializer, creates **no subscription**.
Only reads that happen while the template is executing (or inside an `effect` / `computed`)
subscribe anything. In Owl 2, an event handler that read some state could silently
subscribe the component to it and cause phantom re-renders forever. That entire bug class is
gone, and it cost one line.

Note also that `scopeStack.push` wraps both the constructor *and* `setup()`, which is why
class field initializers can call hooks:

```ts
class Counter extends Component {
    props = useProps({ start: t.number() });   // a field initializer. this works.
    count = signal(0);
    setup() { useEffect(() => console.log(this.count())); }
}
```

### The `getTemplate` trampoline

```ts
getTemplate(name) {
    if (!(name in this.templates)) {
        const raw = this.getRawTemplate?.(name) || this.rawTemplates[name];
        const templateFn = isFn ? raw : this._compileTemplate(name, raw);

        // install a placeholder FIRST, so a self-recursive template resolves
        const templates = this.templates;
        this.templates[name] = function (ctx, parent) {
            return templates[name].call(this, ctx, parent);
        };

        this.templates[name] = templateFn(this, bdom, this.runtimeUtils);
    }
    return this.templates[name];
}
```

The placeholder looks pointless until you write a template that `t-call`s itself. Without
it, compiling a recursive template re-enters `getTemplate` for a name that isn't in the
cache yet and you blow the stack. With it, the inner call resolves to a function that reads
the slot lazily, by which point the real function is installed.

Also worth noticing: compiling produces a **factory**, not a render function. You call it
with `(app, bdom, helpers)` to get the actual template function. That indirection is how
generated code gets its dependencies without any imports.

---

## 5. Build system

Every package has the same `build.mjs` shape - esbuild, `target: "es2022"`, bundle:

```js
esbuild.build({
    entryPoints: ["src/index.ts"], bundle: true, target: "es2022",
    outfile: "dist/owl-core.es.js", format: "esm",
});
```

The `owl` package emits four variants (esm, cjs, iife, minified iife) and injects
`__BUILD_DATE__` / `__BUILD_HASH__` through `define`. Types come from
`dts-bundle-generator`, not `tsc --declaration`, which produces one flat `.d.ts`.

That choice has a consequence you'll hit if you ever add a public type: phantom brand
symbols (`isProps`, `typeBrand`, `hasDefault`, `isOptional`) have to be explicitly
re-exported, or downstream projects can't emit their own declaration files. There's a
comment in `owl-runtime/src/index.ts` pointing at the issue that taught them this.

One more build gotcha, and it's the nastiest bug in the repo to diagnose:

```js
// packages/owl/build.mjs
alias: { "@odoo/owl-core": "../owl-core/dist/owl-core.es.js" }
```

Without that alias, esbuild follows the `tsconfig` `paths` mapping and bundles `owl-core`
**twice** - once from source via the runtime, once from dist via the compiler. Two copies
means two module-level `currentComputation` variables, which means reactivity silently stops
working across the boundary. Nothing throws. Effects just quietly never re-run.

If you ever see that symptom after touching the build, check for a duplicated core before
you check anything else.

---

## 6. What I'd change

Two things bother me at this level.

**Nothing guards against the duplicate-core problem.** A post-build assertion that greps
the bundle for two copies of a sentinel string would take twenty minutes to write and would
have saved somebody a very bad afternoon.

**`validateTarget` is a chokepoint that nobody knows about.** It lives in
`owl-runtime/src/utils.ts`, walks up through shadow roots and iframes, and throws on
detached nodes. If you ever add a new kind of mount target, that's the function you have to
teach - and it's not obvious from anywhere else in the codebase.

---

Next: **[blockdom, the rendering engine](/blog/owl-3-blockdom)** - how a static subtree ends
up costing one `cloneNode` and nothing else.

*Part 1 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
