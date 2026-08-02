---
title: "Owl 3 Internals, Part 4: Reactivity"
date: "2026-07-29"
summary: "Owl 3 threw out proxy-based useState and replaced it with a signal graph: atoms with bidirectional edges, a two-colour marking scheme, lazy pull-based recomputation, and a deep proxy built on the same substrate."
tags: [owl, framework-internals, signals, reactivity, javascript]
series: "Owl 3 Internals"
order: 4
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 4 of 12*

> This is the part of Owl 3 that actually changed. The rendering engine survived from
> version 2 more or less intact; reactivity was rebuilt from scratch.

---

## 1. What was wrong with Owl 2

Owl 2 had `useState(obj)` - a deep proxy whose reads registered the *current component* as
an observer. It worked for the overwhelming majority of cases and then failed in ways that
were hard to diagnose:

- Reactivity was bound to a component, so sharing state across modules meant re-wrapping
  with `useState` at every boundary.
- Proxy identity confusion. You'd end up calling `toRaw` defensively and still get it wrong.
- A read from an **event handler** subscribed the component, exactly like a read during
  render. Phantom re-renders, forever.
- No first-class derived value. Odoo grew ad-hoc caches, getters, and `onWillRender`
  precomputation to compensate, and none of it composed - which matters a lot in a codebase
  where addons patch each other's methods.

The team's own [design notes](https://github.com/odoo/owl/blob/master/doc/v3/owl/owl3_design.md)
put it plainly: with proxies, reactive behaviour is implicit and hard to reason about when
values cross abstraction boundaries. Signals make the dependency edge explicit **at the read
site**, which you can grep for.

---

## 2. The shape of the graph

```
┌──────────────────────────────────────────────────────────┐
│                    computations.ts                       │
│                                                          │
│  Atom            { value, observers: Set<Computation> }  │
│  ComputationAtom { …Atom, compute, sources: Set<Atom>,   │
│                    state, isDerived }                    │
│                                                          │
│  module state:   currentComputation                      │
│                  observers[]        ← the effect queue   │
│                  pendingDisposals                        │
└────────────────────────┬─────────────────────────────────┘
      ┌──────────────────┼──────────────────┬──────────────┐
      ▼                  ▼                  ▼              ▼
   signal.ts         computed.ts        effect.ts      proxy.ts
  (source atom)     (derived atom)    (leaf, eager)  (atom per key)
      │                  │                  │              │
      └──────────────────┴─────────┬────────┴──────────────┘
                                   ▼
                    ComponentNode.signalComputation
                  a non-derived computation whose compute()
                          is `this.render(false)`
```

The whole data model is two interfaces:

```ts
interface Atom<T> {
    observers: Set<ComputationAtom>;
    value: T;
}

interface ComputationAtom<T> extends Atom<T> {
    compute: () => T;
    isDerived: boolean;        // true for computed; false for effects and components
    sources: Set<Atom>;        // back-edges, for cleanup
    state: ComputationState;   // EXECUTED=0 | STALE=1 | PENDING=2
}
```

Edges are stored **in both directions**, both as `Set`. That costs two Sets per computation
and buys O(1) add and delete on unsubscribe - which is the hot operation, because
`removeSources` runs on every single recompute.

---

## 3. Two colours of dirty

| State | Meaning |
| --- | --- |
| `EXECUTED` (0) | the value is current |
| `STALE` (1) | a direct source definitely changed, must recompute |
| `PENDING` (2) | *maybe* dirty - something upstream changed, but an intermediate computed might compare equal and stop the propagation |

This is the push-pull model, the same family as Solid, Angular signals, Preact Signals and
Reactively. Writes push a cheap dirty flag down the graph; reads pull the actual
recomputation.

Small detail that shows up in the code: `EXECUTED` being `0` lets
`if (observer.state) continue;` act as "already marked", which is what keeps the push phase
linear.

---

## 4. Read

```ts
export function onReadAtom(atom: Atom) {
    if (!currentComputation) return;      // ← the whole Owl 2 fix, in one line
    currentComputation.sources.add(atom);
    atom.observers.add(currentComputation);
}
```

If nothing is currently computing, reading subscribes nothing. Reads in an event handler,
in `onMounted`, in `setup()`, in a plain function - all inert. You have to be *inside* a
render, an `effect`, or a `computed` to create an edge.

---

## 5. Write

```ts
export function onWriteAtom(atom: Atom) {
    for (const ctx of atom.observers) {
        if (ctx.state === ComputationState.EXECUTED) {
            if (ctx.isDerived) markDownstream(ctx);   // push PENDING transitively
            else observers.push(ctx);                  // queue the effect
        }
        ctx.state = ComputationState.STALE;            // direct observers are definitely stale
        if (ctx.isDerived && ctx.observers.size === 0) pendingDisposals.add(ctx);
    }
    batchProcessEffects();
}
```

`markDownstream` uses an explicit stack rather than recursion, because graphs can get deep:

```ts
const stack = [computation];
while ((current = stack.pop())) {
    for (const observer of current.observers) {
        if (observer.isDerived && observer.observers.size === 0) {
            pendingDisposals.add(observer);
        }
        if (observer.state) continue;                  // already marked — prune
        observer.state = ComputationState.PENDING;
        if (observer.isDerived) stack.push(observer);
        else observers.push(observer);
    }
}
```

That `continue` is what makes a diamond dependency graph O(V+E) instead of exponential.

---

## 6. Pull

```ts
if (state === EXECUTED) return;

if (state === PENDING) {
    for (const source of computation.sources) {
        if (!("compute" in source)) continue;
        updateComputation(source);                     // settle upstream first
        if (computation.state === STALE) break;        // ← short-circuit
    }
    if (computation.state !== STALE) {
        computation.state = EXECUTED;                  // nothing actually changed
        return;
    }
}

removeSources(computation);
const previousComputation = currentComputation;
currentComputation = computation;
try {
    computation.value = computation.compute();
    computation.state = EXECUTED;
} finally {
    currentComputation = previousComputation;          // ← even if compute() threw
}
```

Two lines in there have stories behind them.

**The `break`.** Once a source's recompute has marked us STALE, probing the remaining
sources isn't just wasted work - it can *throw*. The comment in the source gives the exact
case: `if (lastValue()) uppercase()`, where `uppercase` would blow up on the new falsy
value. Eagerly evaluating a source that the about-to-run body will never read surfaces a
phantom error.

**The `finally`.** If `compute()` throws and you don't restore the pointer, the next
unrelated atom read attaches itself as a source of the failed computation. Silent, and
extremely annoying to debug.

### Glitch freedom, concretely

```
      a  (signal)
     ╱ ╲
    b   c   (computed)
     ╲ ╱
      d     (computed)
```

`a.set(x)` marks `b` and `c` STALE and `d` PENDING. Reading `d` settles `b`, then `c`, then
recomputes `d` **once**, with consistent inputs. And if both `b` and `c` compare equal to
their previous values, `d` doesn't recompute at all.

---

## 7. computed

```ts
const computation = createComputation(() => {
    const newValue = getter();
    if (hasValue) {
        if (equalsFn(computation.value, newValue)) {
            return computation.value;    // discard the equal result, keep identity
        }
        onWriteAtom(computation);        // notify downstream
    }
    hasValue = true;
    return newValue;
}, true);
```

Lazy: `readComputed` only calls `updateComputation` when the state isn't `EXECUTED`.

The `equals` option defaults to `Object.is`, and can be `false` to always notify. It's the
main user-facing performance lever - a computed that builds a fresh array every run can stop
propagation with `{ equals: shallowEqual }`. Custom comparators run **untracked**, so
comparing values that happen to be proxies doesn't create spurious edges. That was a real
bug once; there's a commit for it.

`computed()` also registers itself with `getScope()?.computations`, so one created inside
`setup()` gets disposed when the component dies. One created at module level does not.

---

## 8. effect

```ts
export function effect(fn) {
    const computation = createComputation(() => {
        if (computation.value || computation.observers.size) {
            setComputation(undefined);
            unsubscribeEffect(computation);
            setComputation(computation);
        } else {
            removeSources(computation);      // leaf-effect fast path
        }
        return fn();                         // return value is the cleanup fn
    }, false);

    getCurrentComputation()?.observers.add(computation);   // nested effects
    updateComputation(computation);
    return function cleanupEffect() { /* … */ };
}
```

Eager, non-derived, returns a disposer. The fast path matters: when there's no cleanup
function and no child effects - the common case - it skips the whole save/restore dance.

Nested effects are parented by reusing the `observers` set on the parent computation as an
ownership list. It's a structural pun and it's worth knowing about before you read
`effect.ts`, because otherwise the recursion in `unsubscribeEffect` looks wrong.

---

## 9. Batching

```ts
export function batched(callback) {
    let scheduled = false;
    return function (...args) {
        if (!scheduled) {
            scheduled = true;
            Promise.resolve().then(() => { scheduled = false; callback(...args); });
        }
    };
}
```

Every write in the same microtick collapses into one `processEffects` run.

Why `Promise.resolve().then` and not `queueMicrotask`? There's a comment: errors thrown by
the callback surface as unhandled *promise rejections*, which vitest's `onUnhandledError`
hook can intercept and filter. The owl-core test config filters a specific
`IntentionalTestError` class this way. Switching to `queueMicrotask` routes errors through a
different channel and makes that workflow worse.

`processEffects` drains the queue, then handles `pendingDisposals` - **re-checking each
candidate**, because "unobserved" is often transient. An effect queued by the same write may
have re-subscribed in the meantime.

---

## 10. proxy: deep reactivity on the same atoms

`proxy.ts` runs in two modes, and the difference is whether an atom was supplied.

**`proxy(obj)`** - fine-grained. One atom per `(target, key)` pair, held in
`WeakMap<Target, Map<PropertyKey, Atom>>`. Reads register the key's atom. Writes notify it.
`ownKeys` and `has` register a special `KEYCHANGES` symbol atom. Nested objects are proxied
lazily on read and cached, with an inverse map powering `toRaw`.

**`signal.Array/Object/Map/Set`** - coarse-grained. Any mutation notifies the one signal
atom, and nested values come back unwrapped:

```js
const list = signal.Array([{ nested: { x: 1 } }]);
list().push(2);            // notifies
list()[0].nested.x = 2;    // does NOT notify — by design
```

That asymmetry is the single most common thing to trip over in Owl 3. If you need deep,
reach for `proxy`. If you need a collection whose *contents* changing is enough, use the
signal variants.

The write trap has one subtlety worth quoting:

```js
const valueChanged = originalValue !== Reflect.get(target, key, receiver);
if (atom) {
    if (keyCreated || valueChanged) onWriteAtom(atom);   // at most ONE notify
} else {
    if (keyCreated) onWriteTargetKey(target, KEYCHANGES);
    if (valueChanged || (key === "length" && Array.isArray(target))) {
        onWriteTargetKey(target, key);
    }
}
```

The `length` special case exists because array methods update `length` behind the scenes and
the trap never sees a real value change. In signal mode it isn't needed - the index write
already notified - and there's a commit that fixed exactly that double-notify.

Collections get bespoke handlers. `has` and `get` observe the specific key.
`keys/values/entries/Symbol.iterator/forEach` observe `KEYCHANGES` *plus* each key as it's
yielded. `size` observes `KEYCHANGES`. `clear` notifies every key it removed. `WeakMap` gets
only `has/get/set/delete`, since it can't be iterated.

One acknowledged rough edge, with a `TODO` above it:

```ts
has(target, key) {
    // observes all key changes instead of only the presence of the argument key
    onReadTargetKey(target, KEYCHANGES, atom);
}
```

`"a" in obj` subscribes you to any key being added or removed on that object.
Over-notification, never under - safe, but coarse. A per-key presence atom would fix it and
it's a tractable contribution.

---

## 11. The leak they had to fix

This one is worth understanding because it's subtle.

A `computed` with no observers still sits in its sources' `observers` sets. A lazy computed
with no observers never re-runs, so `removeSources` never fires for it. So a long-lived
signal would retain **every discarded computed that ever read it**. Forever.

The fix is `pendingDisposals`. When a write notices a derived observer with
`observers.size === 0`, it queues it. `processEffects` re-checks and calls
`disposeComputation`, which recursively unsubscribes derived computations that lost all
observers and marks them STALE so a later read rebuilds them properly.

The deferral matters. "Unobserved" is transient - a computation being pulled lazily is
unobserved *while it recomputes*. Disposing eagerly would be wrong.

What can still leak:

- An `effect()` created outside any scope and never disposed. `useEffect` exists precisely
  to prevent this: it's literally `onWillDestroy(effect(fn))`.
- Module-level signals holding large objects. Nothing Owl can do about that.

Everything else - the per-key atom map, the proxy caches, the signal cache used by `.signal`
props - is a `WeakMap` keyed by the object or node, so it dies with its owner.

---

## 12. How a component plugs in

Ten lines, and this is the entire integration between reactivity and rendering:

```ts
// component_node.ts
this.signalComputation = createComputation(
    () => this.render(false), false, ComputationState.EXECUTED
);

// fibers.ts, inside Fiber.render()
const c = getCurrentComputation();
removeSources(node.signalComputation);            // forget last render's deps
setComputation(node.signalComputation);           // subscribe this render's reads
node.signalComputation.state = ComputationState.EXECUTED;
try {
    this.bdom = node.renderFn();
} finally {
    setComputation(c);
}
```

A component is an effect whose body is its own render. Nothing more.

---

## 13. Things that will bite you

1. **Deep mutation of a collection signal doesn't notify.** Use `signal.trigger(s)` or
   `proxy`.
2. **Reading a signal outside a computation** and expecting a subscription - in `onMounted`,
   say. Nothing happens.
3. **Writing a signal during render** gives you a render loop. Owl catches it after 1000
   iterations with a message that names the component and guesses the cause.
4. **A computed used only inside a destroyed scope** gets disposed and marked STALE. Re-use
   recomputes correctly, but don't cache `.value` externally and expect it to stay fresh.
5. **`toRaw` on Map keys.** The collection handlers call it for you; code outside them has
   to do it itself.
6. **`Object.is` semantics.** `NaN` equals `NaN`, so setting a signal to `NaN` twice doesn't
   notify. `+0` and `-0` differ, so that one *does*.

---

## 14. What I'd change

The `has` trap, as above.

And there's a `// todo: test performance` on `removeSources` suggesting you could keep the
sources and re-add at compute time instead of clearing and rebuilding. That's a measurable
question nobody has measured, and `packages/owl-core/bench/reactivity.bench.ts` already has
the harness to do it in.

---

Next: **[the scheduler and fibers](/blog/owl-3-scheduler-fibers)** - what happens between a
signal write and the DOM actually changing.

*Part 4 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
