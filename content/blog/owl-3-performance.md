---
title: "Owl 3 Internals, Part 9: Performance Engineering"
date: "2026-07-24"
summary: "Every optimisation in the Owl codebase, where it lives, what it buys, and the performance cliffs nobody documents. Plus the one thing missing from the project's engineering process."
tags: [owl, framework-internals, performance, profiling, javascript]
series: "Owl 3 Internals"
order: 9
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 9 of 12*

> Owl's speed comes from doing work at compile time and then running a flat, allocation-light
> loop at runtime. This part collects every trick in one place, along with the parts that are
> slower than you'd expect.

---

## 1. Compile time

| Technique | Where | Payoff |
| --- | --- | --- |
| static markup folded into the block template string | `compileTDomNode` | static DOM costs one `cloneNode`, forever |
| `createBlock` hoisted to factory scope | `generateCode` | `DOMParser` runs once per template |
| event handlers hoisted into `staticDefs` | `generateHandlerCode` | no closure allocation per render |
| `createComponent` / `createCatcher` hoisted | `compileComponent` | strategy decided once |
| props-diff strategy specialised | `template_helpers.ts` | one of four closures, no per-render branching |
| `t-foreach` flag elision | `parseTForEach` | skips up to 4 ctx writes × N iterations |
| `hasNoRepresentation` | parser + `compileMulti` | avoids a `multi()` wrapper for `t-set`-only siblings |
| free-variable extraction for arrow props | `processExpr` | arrow props compare by capture, not identity |
| `isProp` table | `code_generator.ts` | DOM property writes instead of attribute writes |
| translation applied at compile time | `translate()` | zero runtime cost for i18n |

---

## 2. Block mount and patch

- **One deep `cloneNode`** replaces N `createElement` plus N `appendChild`.
- **Bit-packed collectors and child infos** stay in V8's small-integer range, so one array
  read plus shifts replaces three property loads.
- **Cached property descriptors** - `nodeGetFirstChild`, `nodeGetNextSibling`,
  `characterDataSetData`, `nodeInsertBefore`, `nodeCloneNode`, `elementRemove`,
  `tokenListAdd/Remove`. Calling the descriptor's getter or setter directly sidesteps the
  megamorphic prototype lookup you'd get across mixed element types.
- **Everything off-document.** Attributes, text, children and listeners are applied to a
  detached clone; exactly one `insertBefore` touches the live tree.
- **`isDynamic` split.** A block with `refN === 0` keeps the trivial base-class `mount` and
  `patch`, where patch is an empty function. Fully static blocks are free to re-render.
- **Parallel arrays** (`locRefIdxs`, `locSetters`, `locUpdaters`) instead of an array of
  objects: better locality, no property loads.
- **`if (this === other) return;`** at the top of every `patch`.

---

## 3. List diff

The two-ended scan handles append, prepend, reverse and in-place update in **O(n)** with
**zero allocation**. The key-to-index map is built lazily, only when a genuine shuffle
forces it.

Prototype methods are destructured once and invoked with `.call`, so the call sites stay
monomorphic - in practice every child of a list is the same block type, and V8 inlines them.

Emptying a list that is its parent's only child becomes `parent.textContent = ""` plus
re-appending the anchor. One operation instead of N.

`prepareList` returns a pre-allocated `new Array(n)`, so there's no array growth during the
loop.

---

## 4. Reactivity

- **Lazy computed** - only recomputed when read *and* dirty.
- **PENDING versus STALE** avoids recomputing a diamond's tip more than once, and avoids
  recomputing at all when intermediate values compare equal.
- **`if (observer.state) continue`** prunes the push phase to O(V+E).
- **The `break` in `updateComputation`** stops probing sources once staleness is certain.
- **Microtask batching** collapses N writes into one flush.
- **Reads outside a computation return immediately.**
- **Custom `equals`** is the main user-facing lever. A computed that builds a fresh array
  every run can stop propagation with `{ equals: shallowEqual }`.
- **Deferred, re-checked disposal** of unobserved computeds keeps the graph from growing
  without bound.

---

## 5. Component layer

- `arePropsDifferent` short-circuits an entire subtree render.
- `ComponentNode` is Scope, VNode and computation owner in one object.
- Lazy allocation everywhere: `_controller` (the AbortController), `_destroyCbs`,
  `trackedRefs`, the removal list - all `??=` or `||=` on first use.
- `nodeErrorHandlers` and `signalCaches` are module-level `WeakMap`s, so a component with no
  error handler and no `.signal` props pays nothing.
- `Object.create(null)` for `children`, so no prototype chain in the hot lookup.

---

## 6. Scheduler

rAF batching means at most one DOM commit per frame regardless of how many writes happened.
The whole tree patches in **one synchronous pass**, so one style and layout recalculation.

The `scheduler.tasks.size > 1` guard skips the ancestor walk entirely in the common
single-root case. Fiber recycling avoids re-allocating the fiber tree on rapid successive
renders. And `requestAnimationFrame` is snapshotted at module load for determinism.

---

## 7. Caches

| Cache | Key → value | Eviction |
| --- | --- | --- |
| `TemplateSet.templates` | name → compiled render fn | never |
| `block_compiler.cache` | template string → Block class | never, module-global |
| parser cache | `WeakMap<Element, AST>` | GC |
| `proxyCache` / `targets` | WeakMap, both directions | GC |
| `targetToKeysToAtomItem` | `WeakMap<target, Map<key, Atom>>` | GC |
| `signalCaches` | `WeakMap<ComponentNode, Map>` | GC |
| `CSS_PROP_CACHE` | camelCase → kebab-case | never |
| `CONFIGURED_SYNTHETIC_EVENTS` | event key → bool | never |

The two never-evicting module-global caches are fine, and deliberately so: templates and CSS
property names are bounded by your source code, not by user data.

---

## 8. Allocation budget

For a component whose template is one block with three dynamic locations and two children:

```
1 × Fiber              (recycled if one is already in flight)
1 × Block instance
1 × data array         (length 3)
1 × children array     (length 2)
N × [fn, ctx] arrays   (one per event handler)
1 × ctx object         (only if there's a t-set or t-foreach)
```

No `refs` array - that's reused. No listener objects. No vnode per element. No props object
beyond what the parent already built.

---

## 9. Benchmarking, or the lack of it

There's one benchmark file: `packages/owl-core/bench/reactivity.bench.ts`, run with
`npm run bench -w packages/owl-core`. It covers signal reads inside an effect, write fan-out
at 1 / 10 / 100 observers, and computed chain depth. Setup is hoisted out of the timed body
where possible; effect re-run benchmarks necessarily include the awaited microtask flush.

There is **no rendering benchmark and no performance CI.**

That's the largest gap in the project's engineering process, and I don't think it's close.
A contributor could make `VList.patch` three times slower and every single test would still
pass. Historically Owl was measured externally against js-framework-benchmark - blockdom was
literally developed as a standalone entry there - but nothing in the repo guards a
regression today.

If you want to contribute something with outsized value, this is it. A vitest bench suite
over jsdom would catch algorithmic regressions; a Playwright-driven harness would catch real
ones.

---

## 10. Profiling recipes

**Where is frame time going?** Chrome Performance panel. Look for long `processTasks` frames
(too much committed at once), many small `processEffects` microtasks (unbatched writes), or
more than one Recalculate Style / Layout per frame (something is reading layout mid-patch).

**Which components re-render?**

```js
onPatched(() => console.count(this.constructor.name));
```

If a component re-renders with unchanged props, it's almost always one of three things: a
slots prop, an arrow prop whose free-variable extraction didn't kick in, or `forceNextRender`.

**Is the reactive graph growing?**

```js
signalObj[atomSymbol].observers.size
```

Sample it across interactions. A number that only goes up means a disposal leak.

**Trace the whole graph.** `onReadAtom` and `onWriteAtom` are the only two chokepoints in the
entire reactivity system. Instrumenting them temporarily gives you every edge.

**Devtools.** `window.__OWL_DEVTOOLS__` exposes `{ apps, Fiber, RootFiber, toRaw, proxy }`.
That's the intended instrumentation seam, and it's how the official extension's profiler
works. Wrapping `Fiber.prototype.render` and `RootFiber.prototype.complete` from there gets
you a timeline without patching the library.

---

## 11. The cliffs

| Cliff | Cause | What to do |
| --- | --- | --- |
| a component with slots re-renders on every parent render | `hasSlotsProp` → `arePropsDifferent = () => true` | push slot content down, or split the component |
| a `deep` render forces the whole subtree | `parentFiber.deep` | avoid triggering deep renders |
| `has` / `in` on a proxy subscribes to all key changes | acknowledged TODO in `proxy.ts` | read the key instead of testing presence |
| deep proxy read chains allocate an atom per key per level | `proxy.ts` | use `signal` on hot paths |
| `filterOutModifiersFromData` slices on every dispatch | `config.ts` | precompute at compile time (open) |
| `removeSources` runs on every recompute | TODO in `computations.ts` | measure the keep-and-re-add alternative |
| full shuffles do more DOM moves than optimal | no LIS in `VList` | open contribution |

The slots one is the biggest in practice, and it's worth understanding rather than
working around blindly. Slot render functions close over a rendering context that may have
changed in ways Owl can't see, so it has to assume the worst. Fixing it properly means
tracking what a slot function actually reads, which is real work.

---

## 12. The cost of all this

Almost every optimisation above trades **readability** for speed. Bit-packing. Parallel
arrays. Cached descriptors. Hoisted closures. Textual code rewrites in the generator.

For a framework maintained by a small team inside a large company, that's defensible - the
whole thing is about 18k lines and you can hold it in your head. But it does mean a casual
contributor is unlikely to make a correct performance change without measuring, and there's
currently nothing in the repo that helps them measure.

Which brings it back to section 9.

---

Next: **[error handling](/blog/owl-3-error-handling)** - why an unhandled render error takes
down your entire app on purpose.

*Part 9 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
