---
title: "Owl 3 Internals, Part 6: Components and Hooks"
date: "2026-07-27"
summary: "Owl's Component class is 26 lines and has no framework methods on it. Hooks work by reading a global scope stack, which is why there are no rules of hooks. Props are exposed as signals through property getters."
tags: [owl, framework-internals, components, hooks, javascript]
series: "Owl 3 Internals"
order: 6
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 6 of 12*

> Two classes, and the interesting one isn't the one you subclass.

---

## 1. The split

```
Component                          ComponentNode
─────────────────────────────      ──────────────────────────────────────
what the USER subclasses           what the FRAMEWORK manipulates
26 lines                           390 lines
static template                    Scope + VNode + computation owner
static components                  fiber, bdom, children, lifecycle arrays
setup()                            props, defaultProps, renderFn
__owl__                            trackedRefs, signalComputation
```

Here is the entire user-facing class:

```ts
export class Component {
    static template: string = "";
    __owl__: ComponentNode;
    constructor(node: ComponentNode) { this.__owl__ = node; }
    setup() {}
}
```

That thinness is deliberate. There are **no framework methods on your prototype**, so
there's nothing to accidentally shadow. Compare React's `Component` with `setState`,
`forceUpdate` and context, or an Angular class with its decorator metadata. In Odoo, where
modules routinely patch each other's component prototypes, having the framework own zero
method names on that object is worth a lot.

`ComponentNode` is where everything actually lives, and it wears three hats at once:

```ts
export class ComponentNode extends Scope implements VNode<ComponentNode> {
    fiber: Fiber | null;
    component!: Component;
    bdom: BDom | null;
    componentName: string;
    forceNextRender: boolean;
    parentKey: string | null;
    props: Record<string, any>;
    defaultProps: Record<string, any> | null;
    renderFn!: Function;
    parent: ComponentNode | null;
    children: { [key: string]: ComponentNode } = Object.create(null);

    willUpdateProps; propsUpdated; willUnmount; mounted; willPatch; patched;
    signalComputation: ComputationAtom;
    trackedRefs: Map<…> | null;
}
```

A **Scope** (lifetime and DI), a **VNode** (mount, patch, remove), and the owner of a
reactive computation. Three roles in one object saves three allocations and three pointer
chases per component, and it's why this file is the busiest in the runtime.

Small detail: `children` is `Object.create(null)`. A component keyed `"toString"` doesn't
explode.

---

## 2. Construction

```ts
constructor(C, props, app, parent, parentKey) {
    super(app);
    this.parent = parent;
    this.parentKey = parentKey;
    this.pluginManager = parent ? parent.pluginManager : app.pluginManager;
    this.componentName = C.name;
    this.signalComputation = createComputation(() => this.render(false), false, EXECUTED);
    this.props = props;

    const previousComputation = getCurrentComputation();
    setComputation(undefined);          // ← construction is NOT tracked
    scopeStack.push(this);              // ← hooks can find us
    try {
        this.component = new C(this);                      // field initializers run here
        const ctx = { this: this.component, __owl__: this };
        this.renderFn = app.getTemplate(C.template).bind(this.component, ctx, this);
        this.component.setup();
    } finally {
        scopeStack.pop();
        setComputation(previousComputation);
    }
}
```

Two consequences.

**Reads during setup don't subscribe.** Reading a signal in `setup()` or in a class field
initializer creates no edge in the reactive graph. Only reads during `renderFn()` - or
inside an `effect` or `computed` - do. This is the fix for Owl 2's most annoying failure
mode, and it costs one line.

**Field initializers can call hooks**, because `scopeStack.push` wraps the constructor as
well as `setup()`:

```ts
class Counter extends Component {
    props = useProps({ start: t.number() });   // a field initializer. this works.
    count = signal(0);
    setup() { useEffect(() => console.log(this.count())); }
}
```

---

## 3. How hooks find their component

The whole mechanism:

```ts
export const scopeStack: Scope[] = [];

export function getScope(): Scope | null {
    const len = scopeStack.length;
    return len ? scopeStack[len - 1] : null;
}

export function useScope(): Scope {
    const scope = getScope();
    if (!scope) throw new OwlError("No active scope");
    return scope;
}
```

A hook is any function that calls `useScope()` and writes to the scope. That's the entire
contract.

**There are no rules of hooks.** No index counter, no call-order requirement, no "don't call
conditionally". Because setup runs exactly once, a hook inside an `if` is perfectly legal -
it either registers or it doesn't. The only rule is *synchronously during construction or
setup*, because the stack is popped in a `finally` and anything after an `await` sees no
scope.

This is the same design as Vue 3's `currentInstance` and Solid's owner, and the opposite of
React's positional hooks. The dividing line is whether setup runs once or on every render.

There's no unified hook store either. Each hook writes to whatever field it needs:

| Hook | Writes to |
| --- | --- |
| `onWillStart` | `scope.willStart[]` |
| `onWillDestroy` | `scope._destroyCbs[]` (lazily allocated) |
| `onMounted` / `onPatched` | `node.mounted[]` / `node.patched[]` |
| `onWillPatch` / `onWillUnmount` | same, but `unshift` |
| `onWillUpdateProps` | `node.willUpdateProps[]` |
| `onError` | a module-level `WeakMap` |
| `useEffect` | `onWillDestroy(effect(fn))` |
| `useProps` | `node.propsUpdated[]`, `node.defaultProps` |
| `computed()` | `scope.computations[]` |

Note `computed()` at the bottom. It isn't a hook by name, but it registers with the scope
when one is active - so a computed created in `setup()` is disposed on destroy, and one
created at module level isn't.

The `push` versus `unshift` asymmetry is intentional: setup hooks run in registration order,
teardown hooks run in reverse. Things registered later get torn down earlier.

---

## 4. `decorate`: binding and stack traces

Every lifecycle callback goes through `scope.decorate(fn, hookName)` before it's stored.

```ts
// Scope, base implementation
decorate(fn, _hookName) { return fn.bind(undefined, this); }

// ComponentNode override
decorate(f, hookName) {
    const component = this.component;
    const scope = this;
    if (this.app.dev) {
        const name = `${this.componentName}.${hookName}`;
        const wrapper = {
            [name](...args) { return f.call(component, scope, ...args); }
        };
        return wrapper[name];        // V8 infers the name from the computed key
    }
    return f.bind(component, scope);
}
```

Two things at once: `this` gets bound to the component, and in dev the function is *named*
`MyComponent.onMounted` so it shows up properly in stack traces and profiler flame charts.
The computed-property-key trick is the standard way to give a function an arbitrary inferred
name in V8, and it's a nice touch.

---

## 5. Creating and updating a child

This is the hot path. `createComponent` returns a closure **specialised at compile time**:

```ts
let arePropsDifferent;
if (hasSlotsProp) {
    arePropsDifferent = () => true;                    // slots: always re-render
} else if (hasDynamicPropList) {
    arePropsDifferent = (p1, p2) => { /* full key scan */ };
} else if (propList.length === 0) {
    arePropsDifferent = () => false;                   // no props: never
} else {
    arePropsDifferent = (p1, p2) => {
        for (const p of propList) if (p1[p] !== p2[p]) return true;
        return false;
    };
}
```

One of four strategies, chosen once when the template compiles, captured in the closure. No
branching per render.

Then:

```ts
return (props, key, ctx, parent, C) => {
    let node = ctx.children[key];
    if (isDynamic && node && node.component.constructor !== C) node = undefined;

    if (node) {
        if (arePropsDifferent(node.props, props) || parentFiber.deep || node.forceNextRender) {
            node.forceNextRender = false;
            const fiber = makeChildFiber(node, parentFiber);
            node.fiber = fiber;
            if (node.willPatch.length) parentRoot.willPatch.push(fiber);
            if (node.patched.length)   parentRoot.patched.push(fiber);

            /* run onWillUpdateProps untracked; may be async */

            node.props = props;
            for (const f of node.propsUpdated) f();     // ← signal-backed props update here
            fiber.render();
        }
    } else {
        /* resolve C from parent.constructor.components, validate, construct */
        node = new ComponentNode(C, props, app, ctx, key);
        ctx.children[key] = node;
        const fiber = new Fiber(node, parentFiber);
        node.willStart.length ? initiateRender.call(node, fiber)
                              : (node.fiber = fiber, fiber.render());
    }

    parentFiber.childrenMap[key] = node;
    return node;
};
```

One ordering detail that took a bug to find: **default props reach `onWillUpdateProps` but
are never written back to `node.props`**. If they were, the next `arePropsDifferent` call
would see ghost diffs on every defaulted key and re-render forever. There's a comment
explaining exactly that.

Also worth knowing: `fiber.childrenMap` is the *pending* child set, `node.children` is the
*committed* one. `_patch` swaps them. Children present in `children` but missing from
`childrenMap` are the ones being removed, which is how the framework knows what to destroy.

---

## 6. The lifecycle, in order

```
  new ComponentNode
     │  constructor + setup()      [scopeStack active, tracking OFF]
     ▼
  onWillStart                      async, awaited; rejection → handleError
     │
     ▼
  render → bdom in memory          [tracking ON — subscriptions form here]
     │
     ▼   counter hits 0, next animation frame
  onWillPatch                      updates only
     │
     ▼
  DOM patch                        one synchronous pass, whole tree
     │
     ├─ onMounted   (first commit)   deepest-first
     └─ onPatched   (later commits)  deepest-first

  … props change from the parent …
     │
     ▼
  onWillUpdateProps(nextProps)     async-capable, untracked
     │  then node.props = props, propsUpdated callbacks fire
     ▼
  render → willPatch → patch → patched

  … removal …
     │
     ├─ onWillUnmount               top-down
     ├─ recurse into children._destroy()
     ├─ Scope.finalize()            abort signal, onWillDestroy (reverse), dispose computations
     └─ bdom.remove() + sweepRemovedRefs()
```

`onMounted` firing on children **before** parents surprises people coming from React, where
it's the same actually - but the reason here is mechanical: the arrays are filled top-down
and drained with `pop()`.

---

## 7. Props became signals

```ts
function defineProp(key) {
    signals[key] = signal(resolveValue(node.props, key));
    Reflect.defineProperty(result, key, {
        enumerable: true,
        configurable: true,
        get: signals[key],          // ← the getter IS the signal read function
    });
}
```

`this.props.count` is literally a signal call, so it's a tracked read. `node.propsUpdated`
wires the parent's prop application to the signals.

`useProps` has three modes:

```ts
useProps()                                        // no shape — enumerate current keys
useProps(["a", "b"])                              // key list
useProps({ a: t.number(), b: t.string().optional() })   // typed shape
```

The typed form enables dev-mode validation and defaults. Defaults come from
`.optional(() => value)`, and the factory is invoked **once per component instance**, so the
value identity stays stable across prop updates.

There's also `useProps.static(key, type)`, which reads once and, in dev, throws if the value
ever changes:

> Prop 'x' changed in component 'Y'. Props declared with `props.static()` are static and
> should not change. If the prop is a signal, pass the same signal reference (its inner
> value may change).

That error is doing real teaching work, which is characteristic of this codebase.

---

## 8. What got removed

`useState`, `useRef`, `useEnv`, `useSubEnv`, `useChildSubEnv`, `useComponent`, `useService`,
`onWillRender`, `onRendered` - all gone in version 3.

Replacements: `signal` / `proxy` for state, `signal.ref()` plus `t-ref` for refs, plugins for
env and services, `this.__owl__` for `useComponent`, and `computed` for the
`onWillRender`-precomputation pattern.

`env` and the service registry disappearing is the biggest ergonomic change after signals,
and it gets [its own part](/blog/owl-3-plugins-di).

---

## 9. The newest hook is the nicest

`useOnChange` landed recently and it's the best small piece of composition in the codebase:

```ts
export function useOnChange(dependencies, callback, { initialRun = true } = {}) {
    const deps = computed(dependencies, { equals: shallowEqual });
    let skipRun = !initialRun;
    useEffect(() => {
        const args = deps();                        // the ONLY tracked read
        if (skipRun) { skipRun = false; return; }
        return untrack(() => callback(...args));    // callback reads nothing reactively
    });
}
```

`computed` plus `shallowEqual` gives you "only when the *values* change", so
`() => [count() > 10]` doesn't fire when count goes from 2 to 3. `untrack` around the
callback guarantees it can't retrigger itself.

It's Owl's answer to React's `useEffect(fn, [deps])`, and it's strictly better behaved -
the deps are computed, not declared, so they can't drift out of sync with the body.

The first version compared dependencies by identity; a follow-up commit fixed it to compare
by value. Worth reading both if you want a feel for how this project reviews things.

---

## 10. Error boundaries, Portal and Suspense are userland

All three are written entirely in public API, and I think that's the strongest signal of
whether a framework's abstractions are any good.

```ts
export class ErrorBoundary extends Component {
    static template = xml`
        <t t-if="this.props.error()"><t t-call-slot="fallback"/></t>
        <t t-else=""><t t-call-slot="default"/></t>`;

    props = props({ error: t.signal().optional(() => signal<any>(null)) });

    setup() { onError((e) => this.props.error.set(e)); }
}
```

Twenty-three lines. And because `error` is a prop with a signal default, the parent can pass
its own signal in and both observe and reset the error state - something React error
boundaries can't do without extra plumbing.

`Portal` and `Suspense` are both sub-roots: they call `app.createRoot(...)` with an internal
config that threads the plugin manager through (so ancestor plugins stay visible) and routes
errors back into the host's parent chain. 78 and 87 lines respectively.

---

## 11. Things that will bite you

- **Forgetting `super.setup()`** in a subclass. Nothing enforces it, and the base class's
  hooks silently never register.
- **Missing `static components = { Child }`**, which gives you *"Cannot find the definition
  of component X, missing static components key in parent"*.
- **Mutating `this.props`.** It's the parent's object and gets replaced wholesale next
  render.
- **Calling a hook after an `await` in `setup`.** You get "No active scope", or worse, you
  attach to whatever scope happens to be on the stack.
- **Expecting `useEffect` to run after mount.** It runs immediately, during setup, before
  the first render. If you need the DOM, gate on a ref signal or use `onMounted`.

That last one is the single most common misunderstanding for people arriving from React, and
it isn't flagged anywhere obvious.

---

Next: **[plugins and dependency injection](/blog/owl-3-plugins-di)** - what replaced `env`.

*Part 6 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
