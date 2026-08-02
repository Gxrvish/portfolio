---
title: "Owl 3 Internals, Part 5: The Scheduler and Fibers"
date: "2026-07-28"
summary: "Owl runs two queues on two different clocks. A signal write becomes a render on a microtask; a finished render becomes DOM on an animation frame. In between there's a counting semaphore, fiber recycling, and a render-loop detector."
tags: [owl, framework-internals, scheduling, concurrency, javascript]
series: "Owl 3 Internals"
order: 5
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 5 of 12*

> Owl components can be async - `onWillStart` may await a network call. So a render isn't
> one synchronous pass, it's a tree walk that suspends at arbitrary nodes. Everything in
> this part exists to make that tractable.

---

## 1. Two queues, two clocks

If you remember one thing from this part, make it this. Confusing these two is the number
one reason people write a test that asserts on the DOM and finds nothing changed.

```
  signal.set(x)
       │
       ▼   onWriteAtom → observers.push(node.signalComputation)
  ┌─────────────────────────────────────────────────┐
  │  QUEUE 1 — reactivity, flushed on a MICROTASK   │
  │  computations.ts, via batched()                 │
  └─────────────────────┬───────────────────────────┘
                        ▼   node.render(false)
                   makeRootFiber → scheduler.addFiber
                        │
                        ▼   await Promise.resolve()
                   fiber.render()  → builds bdom, counter--
                        │
                        ▼   counter === 0 → scheduler.flush()
  ┌─────────────────────────────────────────────────┐
  │  QUEUE 2 — rendering, flushed on rAF            │
  │  Scheduler.tasks: Set<RootFiber>                │
  └─────────────────────┬───────────────────────────┘
                        ▼   next animation frame
                   processTasks() → complete()
                        │
        willPatch ─► _patch ─► mounted ─► patched
```

Queue one turns writes into render calls. Queue two turns finished renders into DOM.

---

## 2. The fiber tree

Three classes, and each adds one idea:

| Class | Adds |
| --- | --- |
| `Fiber` | one component's in-flight render: `node`, `bdom`, `parent`, `children`, `root`, `childrenMap` |
| `RootFiber` | `counter`, `renderCount`, `locked`, and the `willPatch` / `patched` / `mounted` hook lists |
| `MountFiber` | `target`, `position`, `afterNode`, `prepared`, `onPrepared` |

### The counter is a semaphore

```ts
constructor(node, parent) {
    if (parent) {
        const root = parent.root;
        root.setCounter(root.counter + 1);      // +1 when a sub-render starts
        this.root = root;
        parent.children.push(this);
    } else {
        this.root = this;                       // RootFiber starts at counter = 1
    }
}

render() {
    // …
    this.bdom = node.renderFn();
    const newCounter = root.counter - 1;        // −1 when it finishes
    root.counter = newCounter;
    if (newCounter === 0) scheduler.flush();
}
```

`counter` is the number of sub-renders still outstanding. It hits zero exactly when the
whole subtree has produced its bdom - whether that took one synchronous pass or fifteen
awaited `onWillStart` calls.

This is worth dwelling on, because the naming invites a wrong analogy. React's fiber is a
linked list built for **interruption**. Owl's fiber is a plain tree built for **counting**.
Same word, different data structure, different purpose. Owl allocates no promises per node
and does no bookkeeping beyond an integer.

---

## 3. Rendering with the tracking pointer set

```ts
const c = getCurrentComputation();
removeSources(node.signalComputation);
setComputation(node.signalComputation);
node.signalComputation.state = ComputationState.EXECUTED;
try {
    (this.bdom as any) = true;         // sentinel: "a render is executing right now"
    this.bdom = node.renderFn();
} catch (e) {
    handleError({ node, error: e });
} finally {
    setComputation(c);
}
```

The `this.bdom = true` sentinel gets checked by `ComponentNode.render`, which defers if it
sees a render already in flight for that node.

---

## 4. Don't render if an ancestor is already rendering

Before rendering, a root fiber walks up looking for an ancestor mid-render:

```ts
if (scheduler.tasks.size > 1) {      // fast path: one root in flight → no ancestor possible
    let prev = this.root.node;
    let current = prev.parent;
    while (current) {
        if (current.fiber) {
            const root = current.fiber.root;
            if (root.counter === 0 && prev.parentKey in current.fiber.childrenMap) {
                current = root.node;                    // already rendered us — keep walking
            } else {
                scheduler.delayedRenders.push(this);    // still working — postpone
                return;
            }
        }
        prev = current;
        current = current.parent;
    }
}
```

Without this a child could render and commit while its parent is building a bdom that will
replace it. Double work at best, detached DOM at worst.

`flush()` drains `delayedRenders` first, re-validating each entry - the node might have been
destroyed, or its fiber replaced, in the meantime.

---

## 5. The microtask in `ComponentNode.render`

```ts
async render(deep) {
    let current = this.fiber;
    if (current && (current.root.locked || (current as any).bdom === true)) {
        await Promise.resolve();
        current = this.fiber;               // things may have changed
    }
    // …

    const fiber = makeRootFiber(this);
    fiber.deep = deep;
    this.fiber = fiber;

    this.app.scheduler.addFiber(fiber);
    await Promise.resolve();                // ← the coalescing window
    if (this.status >= STATUS.DESTROYED) return;

    if (this.fiber === fiber && (current || !fiber.parent)) {
        fiber.render();
    }
}
```

That second await is the render-coalescing window. Between registering the fiber and
actually rendering, an **ancestor** may start its own render and adopt this fiber as a child
- downgrading it from a root fiber to a child fiber.

The condition reads as: render only if we were interrupting an existing render, or nobody
adopted us. Otherwise the ancestor renders us anyway and doing it here would be duplicate
work.

---

## 6. Cancellation and recycling

```ts
if (current) {                                 // an uncommitted fiber exists — RECYCLE it
    const root = current.root;
    root.renderCount++;                        // loop detector
    root.locked = true;                        // cancelFibers can run arbitrary user code
    root.setCounter(root.counter + 1 - cancelFibers(current.children));
    root.locked = false;
    current.children = [];
    current.childrenMap = {};
    current.bdom = null;
    if (fibersInError.has(current)) { /* reset error state, restore mounted list */ }
    return current;
}
```

`root.locked` is set around `cancelFibers` because cancelling can destroy components, which
runs `onWillDestroy`, which is arbitrary user code, which can trigger new renders. Locking
makes those get delayed rather than reentering.

`cancelFibers` itself walks the subtree, replaces `render` with a throwing stub, destroys
any node still in `STATUS.NEW`, and - the important part - sets `node.forceNextRender = true`
on nodes whose props had already been applied by the cancelled pass:

```ts
if (fiber.bdom) {
    // props were updated, but this fiber will never be patched. Without this flag the
    // next render compares identical props and skips the component entirely.
    node.forceNextRender = true;
}
```

That flag is the only thing standing between you and a lost update in that scenario. Worth
knowing if you ever touch this function.

---

## 7. Render-loop detection

```ts
const MAX_RENDER_ITERATIONS = 1000;

if (root.renderCount > MAX_RENDER_ITERATIONS) {
    handleError({ node, error: new OwlError(
        `Maximum render iterations (1000) exceeded. Component "${node.componentName}" is ` +
        `stuck in a render loop: rendering it keeps triggering another render before the ` +
        `DOM is updated. A common cause is updating reactive state during render or ` +
        `setup() — e.g. calling a parent's state setter from a child's setup().`) });
    return;
}
```

`renderCount` only climbs while a fiber stays **uncommitted**, so a healthy fiber never gets
near 1000. And the bail happens *before* `setComputation`, so a detected loop never leaves
the tracking pointer pinned to a computation that `app.destroy()` is about to dispose.

That error message is a good example of the standard the codebase holds itself to. It names
the component and guesses the cause.

---

## 8. The commit pass

```ts
processTasks() {
    if (this.processing) return;              // complete() can trigger renders — reentrancy guard
    this.processing = true;
    this.frame = 0;

    for (const fiber of this.tasks) {
        if (fiber.root !== fiber) { this.tasks.delete(fiber); continue; }   // demoted to child
        const hasError = fibersInError.has(fiber);
        if (hasError && fiber.counter !== 0) { this.tasks.delete(fiber); continue; }
        if (fiber.node.status === STATUS.DESTROYED) { this.tasks.delete(fiber); continue; }

        if (fiber.counter === 0) {
            if (!hasError) fiber.complete();
            if (fiber.appliedToDom) this.tasks.delete(fiber);
        }
    }

    for (const task of this.tasks) {
        if (task.node.status === STATUS.DESTROYED) this.tasks.delete(task);
    }
    this.processing = false;
}
```

Iterating a `Set` while deleting from it is legal and deliberate here - entries added during
iteration still get visited.

The `if (fiber.appliedToDom)` guard is subtle: if an error handler recycled the fiber during
`complete()`, it stays in the queue for another pass instead of being dropped.

### Lifecycle ordering inside `complete()`

```
1. willPatch hooks      (skipped if node.fiber !== current — the subtree may be gone)
2. node._patch()        ← the ONE synchronous DOM pass for the whole tree
3. locked = false
4. mounted hooks        pop() → deepest-first
5. patched hooks        pop() → deepest-first
```

Steps 1 and 2 run with `locked = true`, so a render triggered from `onWillPatch` or
`onWillUnmount` gets delayed instead of reentering.

`mounted` and `patched` fire **bottom-up** - children before parents - because the arrays
are filled top-down during render and drained with `pop()`.

And if a `mounted` hook throws, the remaining fibers get their `willUnmount` arrays cleared:

```ts
for (const fiber of mountedFibers) fiber.node.willUnmount = [];
```

A component whose `onMounted` never ran must not later receive `onWillUnmount`. That
asymmetry would corrupt user cleanup logic, and it took a bug to discover.

---

## 9. Prepare and commit, split

`MountFiber` supports rendering without a target. `prepare()` builds the bdom in memory;
`complete()` sets `prepared = true` and either mounts immediately (if a target is already
set) or fires `onPrepared()`. `commit(target)` supplies the target later.

`Root.prepared` reads `fiber.counter === 0` - the *synchronous* signal that the render phase
finished. `Suspense` uses it for its no-flash fast path: if a subtree turns out to be fully
synchronous, the fallback never renders at all.

---

## 10. There are no priorities

No lanes. No time slicing. No interruption. One frame commits everything that's ready.

The reasoning holds up: business UIs are dominated by data-loading latency, not render
latency. Async is handled at `onWillStart` - a coarse, explicit suspension point - rather
than by slicing the render. And time slicing would be fundamentally incompatible with the
single synchronous patch pass that makes blockdom fast in the first place.

Whether that's the right call depends entirely on your workload. For Odoo it clearly is.

---

## 11. Things that will bite you

- **Asserting on the DOM right after `signal.set`.** You need a microtask *and* a frame.
- **Monkey-patching `requestAnimationFrame` after Owl loaded.** `Scheduler.requestAnimationFrame`
  is snapshotted at module load, specifically so test frameworks can't change behaviour
  underneath it. Which means overriding `window.requestAnimationFrame` later does nothing.
- **A render triggered inside `onWillPatch` or `onWillUnmount`** gets silently delayed by
  `locked`.
- **Background tabs.** rAF doesn't fire, so commits queue until the tab is visible. Usually
  what you want, occasionally surprising.
- **Breaking `forceNextRender`** while refactoring `cancelFibers`. Nothing will fail loudly;
  you'll just lose the occasional update.

---

## 12. If you wanted to change it

`Scheduler.requestAnimationFrame` is a **static, injectable field**. Swapping it for
`setTimeout` or a manual pump is a two-line change, and that's how I'd build a deterministic
test scheduler - which the project doesn't have and arguably should.

Adding priorities would mean putting a `priority` on `RootFiber` and sorting `tasks` before
the commit loop. The queue part is easy. The hard part is that `complete()` currently assumes
it can patch the entire tree atomically, and unpicking that assumption is most of the work.

For instrumentation, `window.__OWL_DEVTOOLS__` already exposes `Fiber` and `RootFiber` -
that's the intended seam, and it's how the devtools profiler works. Wrapping `Fiber.render`
and `RootFiber.complete` from there gets you a full timeline without patching the library.

---

Next: **[components and hooks](/blog/owl-3-components-hooks)** - why the `Component` class
is 26 lines and there are no rules of hooks.

*Part 5 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
