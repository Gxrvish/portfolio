---
title: "Owl 3 Internals, Part 8: Events and Directives"
date: "2026-07-25"
summary: "Owl uses real DOM events by default and makes delegation opt-in. Handlers are hoisted to module scope so a render allocates almost nothing. Here's the dispatch path, plus what every t-* directive actually compiles into."
tags: [owl, framework-internals, dom-events, templates, javascript]
series: "Owl 3 Internals"
order: 8
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 8 of 12*

> Two halves. First how event handlers work, then a reference for what each directive
> compiles down to - which is the thing I most wanted written down while reading the code
> generator.

---

# Part one: events

## 1. There are no synthetic events

Not by default, anyway. `ev` inside a handler is the browser's `Event` - no wrapper, no
pooling, no normalisation. React-style delegation exists but you opt into it per handler
with a `.synthetic` modifier.

## 2. Native handlers

```ts
let nextNativeEventId = 1;

function createElementHandler(evName, capture = false, passive = false) {
    let eventKey = `__event__${evName}_${nextNativeEventId++}`;
    if (capture) eventKey = `${eventKey}_capture`;

    function listener(ev) {
        const currentTarget = ev.currentTarget;
        if (!currentTarget || !inOwnerDocument(currentTarget)) return;
        const data = currentTarget[eventKey];
        if (!data) return;
        config.mainEventHandler(data, ev, currentTarget);
    }

    function setup(data)  { this[eventKey] = data;
                            this.addEventListener(evName, listener, { capture, passive }); }
    function update(data) { this[eventKey] = data; }        // ← no listener churn
    function remove()     { delete this[eventKey];
                            this.removeEventListener(evName, listener, { capture, passive }); }

    return { setup, update, remove };
}
```

Three things are going on here.

**One `listener` per block location, shared by every instance.** `createEventHandler` runs
once at block-compile time, and the returned `setup`/`update` become that location's setter
and updater. A thousand rows of the same template share one closure.

**The payload lives on the element**, under a unique key. Patching a handler is one property
write. `addEventListener` and `removeEventListener` are among the more expensive DOM calls,
and Owl makes each exactly once per element per handler.

**The `inOwnerDocument` guard** is shadow-DOM aware - it accepts an element whose root node
is a `ShadowRoot` whose host is in the document. Without it, handlers can fire on nodes that
were detached earlier in the same dispatch.

The payload shape is `[...modifiers, fn, ctx]`: modifier strings first, then the hoisted
function, then the rendering context.

## 3. Modifier processing

`mainEventHandler` is installed once, replacing blockdom's trivial default. That injection
point is what keeps blockdom independent of Owl.

```ts
const { data: _data, modifiers } = filterOutModifiersFromData(data);
let stopped = false;

if (modifiers.length) {
    let selfMode = false;
    const isSelf = ev.target === currentTarget;
    for (const mod of modifiers) {
        switch (mod) {
            case "self":    selfMode = true;
                            if (isSelf) continue; else return stopped;
            case "prevent": if ((selfMode && isSelf) || !selfMode) ev.preventDefault();
                            continue;
            case "stop":    if ((selfMode && isSelf) || !selfMode) ev.stopPropagation();
                            stopped = true; continue;
        }
    }
}

if (Object.hasOwnProperty.call(data, 0)) {
    const handler = data[0];
    if (typeof handler !== "function") {
        throw new OwlError(`Invalid handler (expected a function, received: '${handler}')`);
    }
    const node = data[1] ? data[1].__owl__ : null;
    if (node ? node.status === STATUS.MOUNTED : true) handler(data[1], ev);
}
return stopped;
```

Details worth knowing:

- **`.self` is order-sensitive.** `.self.prevent` only prevents when the event originated on
  the element; `.prevent.self` prevents unconditionally and then bails. That's a real
  semantic difference produced by the loop order, and it isn't documented anywhere obvious.
- **`.capture` and `.passive`** are handled at registration, not here.
- **The mounted check** skips handlers on components that are no longer mounted, which
  prevents the classic "click fires on a component destroyed earlier in the same tick" crash.
- **`Object.hasOwnProperty.call(data, 0)`** rather than a truthiness test, so
  `t-on-click="someFalsyValue"` still throws the descriptive error instead of silently doing
  nothing.

## 4. Handler hoisting

```js
// t-on-click="() => this.increment(1)"   compiles to:
const hdlr_fn1 = (ctx) => ctx['this'].increment(1);
// and per render, just:
let hdlr1 = [hdlr_fn1, ctx];
```

The generator pattern-matches arrow functions and injects `ctx` as the first parameter, so
the function itself is allocated **once**, not per render. Non-arrow expressions fall back
to a wrapper that validates and produces this, which is one of my favourite error messages
in the project:

> Invalid handler expression: the `t-on` expression should evaluate to a function, but got
> 'undefined'. Did you mean to use an arrow function? (e.g. `t-on-click="() => expr"`)

## 5. Delegation, when you ask for it

```ts
function nativeToSyntheticEvent(eventKey, event) {
    let dom = event.target;
    while (dom !== null) {
        const _data = dom[eventKey];
        if (_data) {
            for (const data of Object.values(_data)) {
                if (config.mainEventHandler(data, event, dom)) return;   // .stop ends the walk
            }
        }
        dom = dom.parentNode;
    }
}
```

One `document`-level listener per event type, manual bubbling by walking `parentNode`.

Note `parentNode`, not `composedPath()` - **synthetic events do not cross shadow
boundaries**. And the listener is on `document`, so there's no per-App isolation either.
Both are fixable and neither is fixed.

Why is delegation opt-in at all? Because Owl lives inside Odoo, which mixes Owl with legacy
widgets, iframes and third-party JavaScript. Global delegation makes `stopPropagation`
semantics surprising for foreign listeners and creates ordering dependencies with code you
don't control. Native listeners are boring and correct. Delegation is available for the cases
where listener count genuinely dominates - huge grids, mostly.

## 6. Handlers on components and slots

`t-on-click` on `<MyComponent/>` has no single element to attach to; a component may render a
fragment. `VCatcher` solves it:

```
parentEl
  │  ← the listener attaches HERE
  ├─ [ child.firstNode() … ]      the component's DOM, however many top-level nodes
  └─ afterNode (empty text node)  the range terminator
```

```ts
handler[idx] = function (ctx, ev) {
    const target = ev.target;
    let currentNode = self.child.firstNode();
    const afterNode = self.afterNode;
    while (currentNode && currentNode !== afterNode) {
        if (currentNode.contains(target)) return origFn(ctx, ev);
        currentNode = currentNode.nextSibling;
    }
};
```

On dispatch it checks whether the target falls inside the sibling range
`[firstNode, afterNode)`. Cost is O(top-level siblings of the component), which in practice
is one to three.

It's a heuristic rather than a guarantee - it assumes the component's nodes are contiguous
siblings. The anchor discipline in blockdom enforces that, but nothing checks it.

## 7. Cleanup

| Path | What happens |
| --- | --- |
| element removed with its block | the DOM node is dropped and listeners go with it - **no explicit `removeEventListener`** |
| `VCatcher.remove()` | explicitly removes, because the listener is on a *surviving* parent |
| `useListener(target, …)` | `onWillDestroy(() => target.removeEventListener(…))` |
| `useListener(refSignal, …)` | effect cleanup on ref change and on destroy |
| synthetic | the document listener is **never** removed; per-element data is deleted |

Relying on node removal is correct in modern browsers - a detached node with no other
references gets collected along with its listeners - and it saves a DOM call per handler per
removal.

## 8. One thing I'd change

`filterOutModifiersFromData` does `dataList.slice()` on **every dispatch**. Modifiers are
known at compile time. Precomputing them would remove an allocation from the hottest path in
the framework, and it's maybe an hour of work.

---

# Part two: what the directives compile to

## `t-if` / `t-elif` / `t-else`

A real `if / else if / else` writing into a `multi` block's child slots:

```js
let b2, b3;
if (ctx['cond']()) {
    b2 = block1();
} else if (ctx['other']()) {
    b3 = block2();
} else {
    b3 = text('nope');
}
return multi([b2, b3]);
```

Each branch gets an **anchor** at the right child index, so `VMulti.patch` can drop a
zero-width text node into a vacated slot and the position survives. O(1) per slot, no key
comparison.

There's no `v-show` equivalent. `t-if` always adds and removes; use `t-att-class` or
`t-att-style` if you want display toggling.

## `t-foreach` / `t-as` / `t-key`

```js
const ctx1 = ctx;
const [k_block2, v_block2, l_block2, c_block2] = prepareList(ctx['items']());
for (let i1 = 0; i1 < l_block2; i1++) {
    let ctx = Object.create(ctx1);            // prototype-chain scoping
    ctx[`item`] = k_block2[i1];
    ctx[`item_index`] = i1;                   // elided if the template never mentions it
    const key1 = ctx['item'].id;
    c_block2[i1] = withKey(block3([...]), key1);
}
return list(c_block2);
```

`t-key` is **mandatory** - omitting it throws, with the offending expression in the message.

`prepareList` normalises arrays, Maps, iterables and plain objects into
`[keys, values, n, preallocatedArray]`, and throws otherwise. Note the pre-allocated
`new Array(n)`: no push-growth.

One asymmetry that surprises everyone exactly once: for an **array**, `t-as="item"` binds
the element. For a **Map or object**, `item` is the **key** and `item_value` is the value.

## `t-key` on its own

Defines `const tKey_1 = expr` and wraps the result in `toggler(tKey_1, blockExpr)`. When the
key changes, `VToggler` removes the old subtree and mounts the new one. This is the
force-remount primitive, and it's also how `t-call` and dynamic `t-component` get their
identity.

## `t-set` / `t-value`

The scoping logic is the interesting part:

```ts
const isOuterScope   = this.target.loopLevel === 0;
const defLevel       = this.target.tSetVars.get(ast.name);
const isReassignment = defLevel !== undefined && this.target.loopLevel > defLevel;
```

- Reassigning from inside a loop a variable defined outside writes to the **captured outer**
  context, so the value escapes the iteration. That's what makes accumulator patterns work.
- At outer scope it sets `needsScopeProtection`, which prepends `ctx = Object.create(ctx)` to
  the function so the write can't leak into a caller's context.
- With an element body, the content compiles into its own function wrapped in `LazyValue`,
  so it's only rendered if something actually reads it.

## `t-call`

```js
const lazyBlock1 = callBody1.bind(this, ctx);        // the body becomes the `zero` slot
return callTemplate(`sub.template`, this, app,
                    Object.assign(Object.create(ctx), { [zero]: lazyBlock1 }),
                    node, key + '__1');
```

With no attributes it passes `ctx` directly - zero allocation. With attributes it
prototype-inherits and shadows. With `t-call-context="expr"` it builds a fresh `{ this: expr }`
context that doesn't inherit at all.

`callTemplate` wraps the result in a `toggler` keyed on the template name, so switching which
template you call swaps the whole subtree.

`t-out="0"` inside the callee renders the caller's body. That's the `zero` symbol:

```js
ctx[zero]?.(node, key) || text("")
```

## `t-out`

```ts
export function safeOutput(value, defaultValue) {
    if (value == null) {
        return defaultValue ? toggler("default", defaultValue)
                            : toggler("undefined", text(""));
    }
    if (value instanceof Markup)    return toggler("string_safe",   html(value));
    if (value instanceof LazyValue) return toggler("lazy_value",    value.evaluate());
    return toggler("string_unsafe", text(value));
}
```

The toggler key encodes the *kind*, so switching from a string to markup remounts rather
than trying to patch a `VText` with a `VHtml`. That's the same-type invariant from
[part two](/blog/owl-3-blockdom) being enforced, and this is where it happens.

Security-wise: only `Markup` - which you get from `markup()` or `htmlEscape()` - renders as
raw HTML. Everything else becomes a text node. So the XSS surface is exactly "code that
calls `markup()` on untrusted input", which is a small, greppable surface. `markup` used as a
tag function escapes its interpolations.

## `t-att` / `t-att-*` / `t-attf-*`

```
t-attf-x="a{{b}}c"   → interpolate()            → block-attribute-N="x"
t-att-x="expr"       → isProp(tag, "x")?
                          yes → new String/Boolean(expr) → block-property-N="x"
                          no  → expr                     → block-attribute-N="x"
t-att="expr"         → expr                     → block-attributes="N"   (spread)
static + translatable → translateFn(value)      → baked into the template string
static                → baked into the template string
```

The boxing for properties is deliberate - see [part two](/blog/owl-3-blockdom), section 9.

## `t-model`

Restricted to `input`, `select` and `textarea`; anything else throws.

| Element | target | event |
| --- | --- | --- |
| `input[type=checkbox]` | `checked` | `input` |
| `input[type=radio]` | `value` + init `checked` | `click` |
| `select` | `value` | `change` |
| other, with `.lazy` or `.trim` | `value` | `change` |
| other | `value` | `input` |

Default mode expects a **signal**:

```js
const expr1 = modelExpr(ctx['name']);        // throws unless it has .set
let prop1 = expr1();                          // read  → block-property-N="value"
let hdlr1 = [(ctx, ev) => { expr1.set(ev.target.value); }, ctx];
```

With `.proxy`, read and write become plain property access instead. `<select>` threads a
`tModelSelectedExpr` down into child contexts so each `<option>` gets a computed `selected`.

## Components

Prop suffixes:

| Suffix | Emits |
| --- | --- |
| `.bind` | `(value).bind(this)` |
| `.alike` | no-op marker, kept for compatibility |
| `.translate` | `translateFn(value)` at compile time |
| `.signal` | `toSignal(node, cacheKey, value)` - a cached per-node signal |
| *(none, arrow value)* | the arrow **plus** `\x01name.freeVar` synthetic props |

`.signal` is worth a note: `toSignal` keeps a per-node `Map` keyed by a cache key that embeds
the loop keys, so each iteration of a `t-foreach` gets its own signal. On re-render it `set`s
the existing signal and returns its readonly `computed`. Net effect - a parent can hand a
child a *reactive view* of a plain expression without the child re-rendering its whole
subtree.

## Slots

Each slot compiles into its own function:

```js
slots: markRaw({
    default: { __render: slot1.bind(this), __ctx: ctx },
    footer:  { __render: slot2.bind(this), __ctx: ctx, __scope: "s", title: d3 }
})
```

`markRaw` keeps the slot object from being proxied - it holds functions and a live context.

At runtime:

```ts
function callSlot(ctx, parent, key, name, dynamic, extra, defaultContent) {
    key = key + "__slot_" + name;
    const { __render, __ctx, __scope } = (ctx.__owl__.props.slots || {})[name] || {};
    const slotScope = Object.create(__ctx || {});     // ← renders in the OWNER's scope
    if (__scope) slotScope[__scope] = extra;
    const slotBDom = __render ? __render(slotScope, parent, key) : null;
    // …
}
```

Slot content renders with the **owner's** context but the **consumer's** node as parent.
That split is what makes `t-ref` inside slot content register on the innermost hosting
component, while the expressions still resolve against the component that wrote the markup.

The cost: `hasSlotsProp` forces `arePropsDifferent` to always return `true`. Slot render
functions close over a context that may have changed invisibly, so a component with slots
re-renders whenever its parent does. That's a real performance cliff and it's the price of
slot correctness.

## The rest

- **`t-tag`** rewrites the block's template string with `${tag || 'div'}` and wraps in a
  `toggler` on the tag name.
- **`t-translation="off"`** disables translation for the subtree; `t-translation-context-<attr>`
  sets a per-attribute context. Translatable attributes default to `alt`, `aria-label`,
  `aria-placeholder`, `aria-roledescription`, `aria-valuetext`, `label`, `placeholder`,
  `title`, configurable with `+`/`-` prefixes.
- **`t-debug`** emits `debugger;` and dumps the generated function to the console.
- **`t-log="expr"`** emits `console.log(expr)`.
- **`t-custom-<name>`** calls a user function that mutates the element, then re-parses.
  Preprocessing only, no new codegen.

---

Next: **[performance engineering](/blog/owl-3-performance)** - every optimisation in the
codebase, and the cliffs nobody writes down.

*Part 8 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
