---
title: "Owl 3 Internals, Part 7: Plugins and Dependency Injection"
date: "2026-07-26"
summary: "Owl 3 deleted env and services and replaced them with plugins: classes with an id and a sequence, started in async batches, scoped by a prototype chain, and able to hand each consumer a view bound to that consumer's lifetime."
tags: [owl, framework-internals, dependency-injection, plugins, typescript]
series: "Owl 3 Internals"
order: 7
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 7 of 12*

> Owl 2 had `env` - a plain object on the app, extendable per-subtree with `useSubEnv` - and
> services, a registry of `{ dependencies, start() }` records. Both are gone.

---

## 1. Why they were replaced

In a codebase Odoo's size, `env` produced four specific problems:

- **Untypeable.** Hundreds of `.d.ts` augmentations and generated typings, all of which had
  to be kept in sync by hand.
- **Implicit dependencies.** Nothing in a component's source told you which services it
  needed. You found out at runtime.
- **No lifetime story.** Services lived forever. Sub-envs were ad-hoc and had no teardown.
- **Ordering by hand.** Startup order came from a manually maintained dependency list.

Plugins fix all four, and they add one thing nobody else has - I'll get to that in section 5.

---

## 2. Architecture

```
  App
   └─ pluginManager: PluginManager  extends Scope
        ├─ config: Record<string, any>          ← useConfig(key)
        ├─ plugins: { [id]: Plugin }            ← prototype-chained to parent
        └─ ready: Promise<void>
                     ▲
                     │  Object.create(parent.plugins)
                     │
        providePlugins() inside a component
             creates a CHILD PluginManager and
             assigns it to node.pluginManager
                     ▲
                     │  inherited in ComponentNode's constructor:
                     │    this.pluginManager = parent ? parent.pluginManager
                     │                                : app.pluginManager
              descendant components
```

Scoping is a **JavaScript prototype chain**, not a Map walk:

```ts
this.plugins = Object.create(parent.plugins);
```

Lookup is `this.plugins[id]`. The engine walks the chain natively with inline caches.
Overriding is an own property. Shadowing is free. It's the same trick the template `ctx`
uses, and it's a good one.

---

## 3. The Plugin class

```ts
export class Plugin {
    private static _shadowId: string;
    static get id() { return this._shadowId ?? this.name; }   // defaults to the class name
    static set id(v) { this._shadowId = v; }
    static sequence = 50;
    static scoped?(plugin, scope): object;

    __owl__: PluginManager;
    constructor(manager) { this.__owl__ = manager; }
    setup() {}
}
```

`id` defaults to `this.name`, which **minifies**. Any plugin that crosses a bundle boundary
needs an explicit `static id`. That's a genuine production footgun and worth flagging in
review, because the failure mode is a confusing "same id as another plugin" error at
runtime, in production, in a build you can't easily read.

---

## 4. Startup: sequenced batches

```ts
startPlugins(pluginConstructors) {
    const fresh = /* filter out already-started */;
    fresh.sort((a, b) => a.sequence - b.sequence);
    const batches = /* group by equal sequence */;

    const startBatch = (batch) => {
        scopeStack.push(this);
        try {
            for (const ctor of batch) this.startPlugin(ctor);
        } finally {
            scopeStack.pop();
        }
        const pending = this.willStart.splice(0);
        return pending.length ? Promise.all(pending.map(fn => fn())) : null;
    };

    let chain = this.hasPendingReady ? this.ready : null;
    for (const batch of batches) {
        chain = chain ? chain.then(() => startBatch(batch)) : startBatch(batch);
    }

    if (!chain) {
        if (this.status < STATUS.MOUNTED) this.status = STATUS.MOUNTED;   // sync fast path
        return;
    }
    this.hasPendingReady = true;
    this.ready = chain.then(() => { /* transition to MOUNTED */ });
}
```

The semantics:

- Plugins with **equal** `sequence` start together, as one batch.
- A batch's `onWillStart` callbacks **fully settle before the next batch is even
  instantiated**. So a low-sequence foundational plugin is guaranteed ready before a
  high-sequence plugin's `setup()` runs.
- Explicit `usePlugin(X)` from inside another plugin **bypasses batching entirely** and
  starts X immediately. Sequence is a coarse default; explicit dependency is precise.
- `startBatch` never spans an `await`, which matters because `scopeStack` is global.
- The sync fast path is load-bearing: with no async plugins, `status` becomes `MOUNTED`
  synchronously, so `mount()` doesn't have to await anything.

Error handling is deliberately blunt, and there's a comment saying so. On failure `ready`
stays rejected and `hasPendingReady` stays true, so subsequent `startPlugins` calls chain
onto the rejected promise and get skipped. If nobody awaits `ready`, the error surfaces as
an unhandled rejection. That's a defensible choice for a startup path but it's the one place
in the DI system I'd want better diagnostics.

---

## 5. Lookup, and the thing nobody else does

```
usePlugin(X) from a COMPONENT scope
   └─ scope.pluginManager.getPluginById(X.id)
        found?   → return (X.scoped ? X.scoped(plugin, scope) : plugin)
        missing? → throw OwlError(`Unknown plugin "X"`)

usePlugin(X) from a PLUGIN scope
   └─ same, but on a miss: startPlugin(X) immediately
```

The asymmetry is deliberate. A component asking for an unstarted plugin is almost always a
missing registration - a bug. And lazily starting a plugin mid-render would run its
`onWillStart` at an arbitrary point in the render phase, which is exactly the kind of
non-determinism this design exists to remove. A plugin asking for another plugin, on the
other hand, is a real dependency edge and it's safe because it happens during startup.

### `static scoped`

```ts
class ORM extends Plugin {
    static scoped(self: ORM, scope: Scope): ORM {
        return Object.assign(Object.create(self), {
            read: scope.run.bind(scope, self.read),
        });
    }
    unscoped = this;
    read = async (...) => { /* … */ };
}
```

The consumer gets a prototype-linked view whose async methods are wrapped in `scope.run`. If
the result arrives after the component is destroyed, the promise rejects with an
`AbortError` instead of writing into a dead component.

`scoped` is a *static* precisely so that the `Object.create(self)` view doesn't inherit it
and recurse. It isn't cached - one call per `usePlugin`.

I've not seen this anywhere else. React context, Vue provide/inject and Angular DI all hand
you the same object regardless of who's asking. **Owl's DI knows the consumer's lifetime.**
It exists because Odoo has thousands of "fetch, then write into a component that may already
be gone" call sites, and this makes the correct behaviour the default one.

### Lifetime

`PluginManager extends Scope`, so plugins get `onWillStart`, `onWillDestroy`, `useEffect`,
and automatic computed disposal - the same hooks components get. A child manager registers
`parent.onDestroy(() => this.destroy())`, so destroying an ancestor cascades.

`providePlugins` is the subtree-scoping hook:

```ts
const manager = new PluginManager(node.app, { parent: node.pluginManager, config });
node.pluginManager = manager;
onWillDestroy(() => manager.destroy());
startPlugins(manager, pluginConstructors);

if (manager.status < STATUS.MOUNTED) {
    onWillStart(() => manager.ready);      // block the owning component's first render
}
```

That last line is easy to miss and explains an otherwise mysterious slow subtree: if your
provided plugins do async work, the component that provides them waits for it.

---

## 6. Registries and Resources are reactive

These are Odoo's extension points, and in version 3 they're built on signals:

```ts
export class Resource<T> {
    private _items = signal.Array<[number, Item<T>]>([]);

    items = computed(() =>
        this._items().sort((a, b) => a[0] - b[0]).map(e => e[1]));

    add(item, { sequence = 50 } = {}) {
        this._items().push([sequence, item]);
        return this;
    }

    use(item, opts) {
        const scope = useScope();
        this.add(item, opts);
        scope.onDestroy(() => this.delete(item));
        return this;
    }
}
```

`Registry` is the keyed variant, backed by `signal.Object` instead.

Because `items` is a `computed` over a collection signal, **adding to a registry reactively
re-runs anything that read it**. Which is what makes this work:

```ts
export function startPlugins(manager, plugins) {
    if (Array.isArray(plugins)) {
        manager.startPlugins(plugins);
    } else {
        manager.onDestroy(effect(() => {
            const pluginItems = plugins.items();               // tracked read
            untrack(() => manager.startPlugins(pluginItems));  // starting must not track
        }));
    }
}
```

A module that later calls `pluginResource.add(MyPlugin)` causes the effect to re-run and the
new plugin to start. No restart, no explicit wiring, no registration ordering problem.

The `untrack` is essential - `startPlugins` reads all sorts of things and would otherwise
build spurious dependencies into that effect. This is the pattern to copy if you ever write
something similar.

`use` and `useById` are the scope-bound variants: register now, deregister when the
surrounding component or plugin dies. Both classes also take an optional `validation` type
that runs on every `add`, so a bad entry fails at registration with a path-annotated message
rather than at use.

---

## 7. The type DSL

`owl-core/src/types.ts` is 598 lines and it's the least-discussed part of Owl 3. A validator
is just a function `(ctx: ValidationContext) => void`:

```ts
t.object({ id: t.number(), name: t.string().optional(), tags: t.array(t.string()) })
t.or([t.string(), t.instanceOf(HTMLElement)])
t.signal(t.number())
t.number().optional(() => 0)      // ← default factory
```

The context carries `value`, `path`, `addIssue`, `withKey`, `withIssues`, and `issueDepth`.
That last one exists for a specific reason: a union member's probe failure must not look
like a deep failure to an enclosing union, or the outer union stops trying its remaining
alternatives. It's a small thing that makes union error messages readable instead of
useless.

Errors are serialised with a replacer that stringifies functions, names class instances, and
detects cycles - so you get something you can actually read rather than
`[object Object]` or a stack overflow.

The TypeScript side is a small tour de force of phantom brands (`typeBrand`, `isOptional`,
`hasDefault`, `isProps`), which is why those symbols have to be explicitly exported from the
package. `dts-bundle-generator` needs to be able to name them, or downstream projects can't
emit their own declaration files.

---

## 8. Things that will bite you

- **Minified `static id`** collisions in production.
- **`usePlugin` from a component** for a plugin nobody registered. Add it to `AppConfig.plugins`
  or `providePlugins`.
- **Assuming `sequence` implies a dependency.** It only orders batches. Use `usePlugin` for a
  real edge.
- **No cycle detection.** Plugin A's `setup` calling `usePlugin(B)` whose `setup` calls
  `usePlugin(A)` recurses until the stack blows. There's no guard and no error message.
- **Mutating a registry during render.** It writes a signal, so it can trigger a render loop.
  Do it in `setup`, a plugin, or at module scope.

---

## 9. What I'd add

Cycle detection is the obvious gap and it's genuinely small: keep a `Set<string>` of ids
currently being started on the `PluginManager`, throw with the cycle path on re-entry. Maybe
fifteen lines including a decent error message. If you want a first contribution to Owl that
isn't trivial but also isn't a week of work, this is the one I'd pick.

---

Next: **[events and directives](/blog/owl-3-events-directives)** - what each `t-*` compiles
into, and why delegation is opt-in.

*Part 7 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
