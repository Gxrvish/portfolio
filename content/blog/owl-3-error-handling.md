---
title: "Owl 3 Internals, Part 10: Error Handling"
date: "2026-07-23"
summary: "Owl walks up the component chain looking for a handler, refuses to commit a broken render, and destroys the entire app if nobody catches. Here's the algorithm, the recovery machinery, and the errors it deliberately doesn't catch."
tags: [owl, framework-internals, error-handling, javascript]
series: "Owl 3 Internals"
order: 10
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 10 of 12*

> An error thrown during an async, batched, tree-shaped render is genuinely hard to contain.
> The stack may be several microtasks away from the cause, half the tree may already be
> patched, and the fiber that failed may have been superseded before you get there.

---

## 1. The walk

```
  throw somewhere
      │
      ▼
  handleError({ node | fiber, error })
      ├─ if (app.destroyed) throw error            ← stop cascading
      ├─ mark the fiber chain in `fibersInError`
      ├─ build finalize = () => { app.destroy(); return error; }
      └─ invokeErrorHandlers(node, error, finalize, markFibers = true)
            │
            └─ walk node → parent → … → root
                 at each level, run handlers LAST-REGISTERED FIRST
                   handler returns normally → { handled: true }
                   handler throws           → error = e, keep walking
            │
            └─ nobody handled → app._handleError(finalize())
                                  └─ destroys the app, rethrows
```

The two side tables are module-level `WeakMap`s, so a component with no error handler costs
nothing and entries die with the node:

```ts
export const fibersInError: WeakMap<Fiber, any> = new WeakMap();
export const nodeErrorHandlers: WeakMap<ComponentNode,
    ((error: any, finalize: Function) => void)[]> = new WeakMap();
```

```ts
function invokeErrorHandlers(node, error, finalize, markFibers) {
    while (node) {
        if (markFibers && node.fiber) fibersInError.set(node.fiber, error);
        const handlers = nodeErrorHandlers.get(node);
        if (handlers) {
            for (let i = handlers.length - 1; i >= 0; i--) {
                try {
                    handlers[i](error, finalize);
                    return { handled: true, error };
                } catch (e) {
                    error = e;                     // a throwing handler re-raises upward
                }
            }
        }
        node = node.parent;
    }
    return { handled: false, error };
}
```

Three semantics worth internalising:

- **Innermost, last-registered handler wins.** Two `onError` calls on one component means the
  second is primary.
- **A handler that throws replaces the error and keeps walking.** That's the rethrow
  mechanism - there's no separate API for it.
- **`finalize` is a nuclear option.** Calling it destroys the whole app and returns the
  error. `ErrorBoundary` never calls it. The handler that `createRoot` installs does, which
  is how a failed mount both rejects the mount promise and tears down the half-built app.

---

## 2. What is and isn't caught

| Source | Caught at |
| --- | --- |
| `onWillStart` rejects | `component_node.ts` |
| template execution throws | `Fiber.render` |
| `onWillUpdateProps` rejects | `template_helpers.ts` |
| `onWillPatch` / patch / `onMounted` / `onPatched` | `RootFiber.complete` |
| mount | `MountFiber._mount` |
| `onWillDestroy` callback | `Scope.finalize`, per-callback try/catch |
| **event handler** | **not caught** - propagates to the browser |
| **effect body** | **not caught** - surfaces as an unhandled rejection |

Those last two matter. `onError` is a *render and lifecycle* boundary, not a general
try/catch - the same scope as React's error boundaries. It's the most common
misunderstanding about the feature, and it isn't stated clearly anywhere in the docs.

Effect errors surfacing as unhandled promise rejections is a consequence of `batched` using
`Promise.resolve().then` rather than `queueMicrotask` (see
[part four](/blog/owl-3-reactivity)). Worth knowing when you're hunting one down.

---

## 3. AbortError is not an error

```ts
if (isAbortError(e) && this.status > STATUS.MOUNTED) return;   // scope died mid-await: normal
```

`Scope.run` throws a plain `OwlError` if the scope is *already* dead when you call it - that's
a programming error, nothing should be scheduling work in a destroyed scope. But if the scope
dies *during* the await, it rejects with an `AbortError`, which is a normal race and gets
swallowed.

`isAbortError` is a duck-typed `e.name === "AbortError"` check, so it also matches `fetch`
aborts driven by `scope.abortSignal`. That's deliberate: the same code path handles "the user
navigated away" and "the component unmounted".

There's a comment nearby that took a real bug to write:

> Do NOT `setComputation(prev)` here: we are in a fresh microtask post-await, and `prev` is a
> snapshot from a sync chunk that ended long ago. Pinning `currentComputation` to it would
> leak the captured (possibly already-dead) parent `signalComputation` forever.

That's the kind of thing that only ever shows up as slow memory growth in a long-lived app.

---

## 4. Recovery

This is the hardest part, because when an error is caught the tree is usually half-rendered.

**`fibersInError`** marks every fiber from the failing node up to the root. The scheduler then
refuses to `complete()` a marked fiber, and drops it entirely if its counter isn't zero. A
broken render never reaches the DOM.

**Fiber resurrection.** `handleError` walks up re-attaching `current.node.fiber = current`,
restoring links that may already have been nulled, so a re-render triggered by the handler
can recycle the existing fiber instead of starting over.

**Un-marking on recycle:**

```ts
if (fibersInError.has(current)) {
    fibersInError.delete(current);
    fibersInError.delete(root);
    current.appliedToDom = false;
    if (current instanceof RootFiber) {
        // a fiber that crashed while mounting has a corrupted `mounted` list
        current.mounted = current instanceof MountFiber ? [current] : [];
    }
}
```

**`ComponentNode.updateDom`** handles one specific case: a `mounted` hook failed, was handled,
and the handler re-rendered. It walks down looking for the node whose `bdom !== fiber.bdom` -
the one that actually re-rendered - and patches only that.

**`willUnmount` scrubbing:**

```ts
for (const fiber of mountedFibers) fiber.node.willUnmount = [];
```

If a crash happened partway through the `mounted` hook loop, components whose `onMounted`
never ran must not later receive `onWillUnmount`. That asymmetry would corrupt user cleanup
logic.

None of this machinery is documented anywhere. It exists because of specific past bugs, and
it's the least-explained code in the repository. If you're changing anything in
`fibers.ts` or `error_handling.ts`, read these paths twice - they're easy to break and the
tests that cover them are not obvious.

---

## 5. Sub-root routing

`Portal` and `Suspense` mount detached sub-roots. Without special handling, a descendant
error would go straight to `app._handleError` and destroy everything.

```ts
export function forwardErrorToParent(boundary: ComponentNode) {
    return (error, finalize) => {
        if (boundary.app.destroyed) throw error;
        const { handled } = invokeErrorHandlers(boundary, error, finalize, /* markFibers */ false);
        if (!handled) boundary.app._handleError(finalize());
    };
}
```

`markFibers: false` is the key detail. The outer tree's fibers must **not** be marked
in-error, or the host's own mount stalls.

---

## 6. ErrorBoundary

```ts
export class ErrorBoundary extends Component {
    static template = xml`
        <t t-if="this.props.error()"><t t-call-slot="fallback"/></t>
        <t t-else=""><t t-call-slot="default"/></t>`;

    props = props({ error: t.signal().optional(() => signal<any>(null)) });

    setup() { onError((e) => this.props.error.set(e)); }
}
```

Twenty-three lines and no framework support. Because `error` is a prop with a signal default,
the parent can pass its own signal in and both observe and reset the error state.

---

## 7. Stack traces

| What | Quality |
| --- | --- |
| lifecycle hooks in dev | **good** - `decorate` names the wrapper `MyComponent.onMounted` |
| template execution | **poor** - anonymous frame, no source map, no line link to the XML |
| compile failures | **good** - the full generated source is in the message, `err.cause` set |
| XML parse failures | **good** - line, column, and a caret |
| missing template | **good** - names the requesting component via `getScope()` |
| prop validation | **good** - JSON issue list with path and safely-serialised value |

`OwlError` is a bare `Error` subclass with a `cause` field, and its comment is explicit:

> Error type for framework-generated errors. Errors thrown from user code are rethrown as-is
> and are NOT converted to OwlError.

That distinction is how you tell "Owl is complaining" from "your code threw", and it's worth
preserving if you ever touch this.

---

## 8. Fail-fast, on purpose

An unhandled render error **destroys the entire app**. Not the subtree - the app.

Every other framework I know of logs to the console and limps on. React unmounts the tree.
Vue and Svelte log. Angular routes to a global handler. Owl nukes it.

The rationale, as far as I can reconstruct it: a partially-broken Odoo screen that silently
misbehaves is worse for a business user than a hard failure they report. Someone entering
invoice data into a form where half the fields stopped updating is a worse outcome than a
crash. In practice this means Odoo apps wrap generously with `ErrorBoundary`, which is
presumably the intended behaviour change.

I'm not sure I'd make the same call for a general-purpose framework. For this one it's
coherent.

---

## 9. Things that will bite you

1. Expecting `onError` to catch an event handler throw. It won't.
2. Expecting `onError` to catch an effect throw. It won't - look for an unhandled rejection.
3. Calling `finalize()` in a custom handler. That destroys the app. Only do it deliberately.
4. Two `onError` on one component - only the last runs, unless it throws.
5. Not re-rendering after handling. The errored fiber was dropped, so the DOM keeps its
   pre-error state until something triggers a new render.

---

## 10. Extending it

`App.prototype._handleError` is currently just `throw error`. Overriding it is the intended
seam for reporting to Sentry or similar.

To catch **event handler** errors, wrap `config.mainEventHandler` - one injectable function
covers every dispatch in the app.

To catch **effect** errors you'd need a try/catch in `processEffects` routing to a
configurable reporter, which would be a genuine feature addition rather than a fix. The
tricky part is not breaking the vitest `IntentionalTestError` filtering that the current
unhandled-rejection behaviour enables.

An `onUnhandledError` option on `AppConfig` would be better than monkey-patching
`_handleError`, and it's a small, well-shaped contribution.

---

Next: **[Owl versus everything else](/blog/owl-vs-react-vue-solid-svelte)** - subsystem by
subsystem.

*Part 10 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
