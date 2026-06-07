# Preact From The Inside Out

> I went down the Preact rabbit hole and came back with this - a complete, ground-up
> explanation of how Preact 11 actually works: the virtual DOM, the diff, the scheduler,
> hooks, context, refs, error boundaries, Suspense, and the React-compatibility layer. My
> goal was a little selfish: write the thing I wish someone had handed me, so that **one
> person can read this single file and understand the entire repository**, then go build
> their own VDOM library.
>
> Fair warning before you start - this is a rewrite of the classic "Inner Workings of
> Virtual DOM" article, the one that described Preact 7/8 (`nodeName`, `attributes`,
> synchronous recursive diffing, `diffLevel` globals). All of that is gone now. What
> you're reading reflects the engine as it exists today: a flat single-pass diff over
> fiber-like vnodes, a microtask-batched render queue, a keyed skew-reconciler, and a
> plugin system that hooks (literally) and `preact/compat` are built on top of.

---

## Table of contents

1. [The 30,000-foot view](#1-the-30000-foot-view)
2. [The repository, package by package](#2-the-repository-package-by-package)
3. [The VNode: Preact's atom](#3-the-vnode-preacts-atom)
4. [createElement and JSX](#4-createelement-and-jsx)
5. [`options`: the plugin system everything is built on](#5-options-the-plugin-system-everything-is-built-on)
6. [`render`: the entry point](#6-render-the-entry-point)
7. [The diff, part 1: the unified algorithm](#7-the-diff-part-1-the-unified-algorithm)
8. [The diff, part 2: components](#8-the-diff-part-2-components)
9. [The diff, part 3: DOM elements, props, and events](#9-the-diff-part-3-dom-elements-props-and-events)
10. [The diff, part 4: keyed children and the skew algorithm](#10-the-diff-part-4-keyed-children-and-the-skew-algorithm)
11. [The commit phase](#11-the-commit-phase)
12. [The scheduler: why `setState` is async](#12-the-scheduler-why-setstate-is-async)
13. [Context](#13-context)
14. [Refs](#14-refs)
15. [Error boundaries](#15-error-boundaries)
16. [Hooks: the complete picture](#16-hooks-the-complete-picture)
17. [`preact/compat`: pretending to be React](#17-preactcompat-pretending-to-be-react)
18. [Suspense and lazy, in depth](#18-suspense-and-lazy-in-depth)
19. [The other packages](#19-the-other-packages)
20. [Build your own VDOM: an ordered checklist](#20-build-your-own-vdom-an-ordered-checklist)
21. [Appendix: the underscore field glossary](#21-appendix-the-underscore-field-glossary)

---

## 1. The 30,000-foot view

Strip away everything else and Preact has exactly one job: keep a real DOM tree in sync
with a description of what that tree should look like, while touching the real DOM as
little as it possibly can. That description? It's a tree of **virtual nodes** (vnodes) -
plain JavaScript objects, nothing magic about them. Here's the flow:

```
   Your JSX
      │  (compiled by Babel/TS)
      ▼
  createElement / jsx()  ───────►  a tree of VNode objects
      │
      ▼
  render(vnode, container)
      │
      ▼
  ┌────────────────────────────────────────────────────────────┐
  │  diff()  - walk new tree top-down, compare against old tree │
  │     • type is a function?  → run the component, recurse     │
  │     • type is a string?    → create/patch a real DOM node   │
  │     • children?            → diffChildren() (keyed)         │
  └────────────────────────────────────────────────────────────┘
      │  (DOM has now been mutated)
      ▼
  commitRoot()  - fire refs, then layout effects + lifecycle callbacks
```

Here's the bit that trips most people up: after the first render, updates don't start
from the root. A `setState` (or a hook's state setter) marks one component **dirty**,
pushes it onto a queue, and schedules a flush on the next microtask. The flush re-runs
just that component and diffs *its* subtree against what it produced last time. That's
the whole secret behind why Preact feels fast - most renders touch a tiny slice of the
tree, and most diffed nodes end up doing nothing to the DOM at all.

Four ideas carry the entire library. Get these into your head and everything else is
just detail:

1. **A vnode is an object, and the previous tree is kept around.** Diffing is "compare
   new object tree to old object tree, emit minimal DOM ops."
2. **Every vnode is a node in a tree you can walk both ways** (`_parent`, `_children`)
   and that remembers the real DOM it produced (`_dom`). This is Preact's equivalent of
   React Fiber. It's how a deeply-nested update finds where to put its DOM without
   re-rendering anything above it.
3. **Components are just vnodes whose `type` is a function.** Rendering one means
   calling the function and diffing what it returns. State lives on a backing instance
   attached to the vnode.
4. **`options` is a set of empty callback slots fired at key moments.** Hooks, compat,
   devtools, and debug are *not* in the core - they're plugins that fill those slots.

---

## 2. The repository, package by package

Preact ships as a handful of small packages, all stacked on top of the `~3KB` core.

- **`preact` (core)** - vnodes, `render`/`hydrate`, the diff, the scheduler,
  `Component`, `createContext`, `cloneElement`, `options`. Everything below depends on
  this and nothing depends on the rest. ~1500 lines total.

- **`preact/hooks`** - `useState`, `useEffect`, `useRef`, … Implemented entirely as a
  *plugin* via `options`. Core has no idea hooks exist. If you never import hooks, none
  of this code loads.

- **`preact/compat`** - a React-API shim. Re-exports core under React names, then
  patches `options` to normalize props/events to React semantics and adds `memo`,
  `forwardRef`, `PureComponent`, `Suspense`, `lazy`, `createPortal`, `Children`,
  `flushSync`, and the React 18 hooks (`useTransition`, `useSyncExternalStore`, …).
  Reports `version = '18.3.1'` so libraries believe they're talking to React.

- **`preact/jsx-runtime`** - the `jsx`/`jsxs`/`jsxDEV` functions used by the modern
  "automatic" JSX transform, plus helpers for precompiled/string JSX (`jsxAttr`,
  `jsxEscape`, `jsxTemplate`) used in SSR.

- **`preact/debug`** - dev-only. Imports add runtime checks: invalid hook usage,
  duplicate keys, bad prop types, a readable component stack on errors. Patches
  `options`. You import it only in development.

- **`preact/devtools`** - bridges to the React DevTools browser extension via the same
  `options` hooks.

- **`preact/test-utils`** - `act()` and friends for flushing renders/effects
  synchronously in tests.

Notice the pattern here, because it never stops repeating: everything outside core
attaches through `options`. That one design choice is the whole reason the core can stay
tiny and *still* support hooks, Suspense, React compat, and devtools.

---

## 3. The VNode: Preact's atom

A vnode is a plain object. That's the whole thing. And every vnode in the system -
whether it's a `<div>`, a component, a text node, or a Fragment - wears the exact same
shape:

```js
const vnode = {
    type,             // 'div' | Component function | null (text node)
    props,            // { ...attributes, children }  OR  the string/number for text nodes
    key,              // user key, lifted out of props
    ref,              // user ref, lifted out of props
    _children: null,  // VNode[] - this node's children, filled during diff
    _parent: null,    // the parent VNode (lets us walk UP the tree)
    _depth: 0,        // distance from the root; used to order the rerender queue
    _dom: null,       // the real DOM node this vnode owns (first DOM node, for components)
    _component: null, // backing component instance, for function/class types
    constructor: undefined, // a security guard, explained below
    _original: ++vnodeId,   // identity/version number, used for fast bail-out
    _index: -1,       // index among siblings (doubles as scratch space during diff)
    _flags: 0         // bitfield: INSERT_VNODE | MATCHED | MODE_HYDRATE | MODE_SUSPENDED
};
```

Let's walk it field by field, because the *why* is where this gets interesting:

- **`type`** - what to render. A string means a DOM element. A function means a
  component (functions and classes both). `null` means a text node, in which case
  `props` is the actual text string or number.

- **`props`** - the second argument to `createElement`, with `children` folded in. For
  components this is exactly what the function receives. For DOM elements these become
  attributes/properties. `key` and `ref` are *removed* from here.

- **`key` / `ref`** - lifted out of props during creation so the reconciler can read
  identity (`key`) and the ref target without scanning props. `ref` is only lifted for
  DOM and class types; for plain function components a `ref` prop is left in props
  (that's what `forwardRef` consumes).

- **`_children`** - the diffed child vnodes. This is what makes the vnode a tree node.
  It's `null` until the node is diffed.

- **`_parent`** - pointer to the parent vnode. Combined with `_children` this makes the
  tree walkable in both directions, which is essential: when a component re-renders on
  its own, the diff needs to find the surrounding DOM, and it does that by walking
  `_parent`/`_children` looking for `_dom`.

- **`_dom`** - the real DOM node this vnode produced. For a DOM vnode it's its element.
  For a component vnode (no DOM of its own) it's the *first* real DOM node anywhere in
  its subtree. Keeping this pointer correct is what lets updates splice DOM in the right
  place without a full re-render.

- **`_depth`** - how deep this vnode is. The scheduler sorts dirty components by depth so
  parents render before children (avoiding rendering a child twice when its parent also
  updates).

- **`_original`** - a monotonic version stamp. If a re-render produces a *new* vnode
  whose `_original` equals the old one's, the entire subtree is identical by reference
  and can be skipped. This is the cheapest possible bail-out.

- **`_index`** - the vnode's position among its siblings. During child reconciliation
  this field is temporarily overloaded to carry the matched old-child index, then
  overwritten with the final index.

- **`_flags`** - a small bitfield. Bits used during diffing:
  - `INSERT_VNODE` - this node's DOM needs to be inserted/moved.
  - `MATCHED` - this old node has been claimed by a new node (so it won't be unmounted).
  - `MODE_HYDRATE` - we're attaching to existing DOM, not creating it.
  - `MODE_SUSPENDED` - this subtree suspended on the previous render.

### The `constructor: undefined` security guard

Notice `constructor` is explicitly set to `undefined`. This is not an accident - it's an
XSS/JSON-injection defense. A trusted vnode is identified by:

```js
const isValidElement = vnode => vnode != null && vnode.constructor === undefined;
```

Any object you get from `JSON.parse` has `constructor === Object`, not `undefined`. So a
malicious payload that arrives as JSON from a server can never be mistaken for a vnode
and injected into the tree as live markup. The diff makes the same check and refuses to
process anything whose `constructor` isn't `undefined`.

---

## 4. createElement and JSX

JSX is just sugar. With the classic transform, `<div class="a">hi</div>` compiles to a
call:

```js
h('div', { class: 'a' }, 'hi');   // h === createElement
```

`createElement` does three small things:

```js
export function createElement(type, props, children) {
    let normalizedProps = {}, key, ref, i;
    for (i in props) {
        if (i == 'key') key = props[i];
        else if (i == 'ref' && typeof type != 'function') ref = props[i];
        else normalizedProps[i] = props[i];
    }
    if (arguments.length > 2) {
        normalizedProps.children =
            arguments.length > 3 ? slice.call(arguments, 2) : children;
    }
    return createVNode(type, normalizedProps, key, ref, null);
}
```

1. **Lift `key` and `ref` out of props.** (For function types, `ref` stays in props.)
2. **Fold children into `props.children`.** One child stays a single value; multiple
   children become an array.
3. **Build the vnode** via `createVNode`, which allocates the object shape above and -
   critically - fires `options.vnode(vnode)` so plugins can post-process it.

`createVNode` is kept as a separate function with a single allocation site, and that's
on purpose: allocating every vnode from the same call site lets V8 hand them all the
same hidden class, which makes property access faster across the entire library. It's
the kind of micro-optimization that looks paranoid right up until you see the benchmark.

### The automatic runtime

Modern toolchains use the **automatic JSX runtime**, so you write no import and the
compiler emits `jsx(type, props, key)` / `jsxs(...)` from `preact/jsx-runtime`. These
produce the same vnode shape, with two differences worth knowing:

- The runtime puts `key` in a dedicated argument (not in props), and for DOM/class types
  lifts `ref` out of props; for function components it deliberately *keeps* `ref` in
  props (the long-term direction is to drop `forwardRef` entirely).
- `_original` is seeded to a *negative* counter here rather than positive. The sign
  doesn't matter; only equality between an old and new vnode's `_original` matters.

The same module also exports `jsxAttr`, `jsxEscape`, and `jsxTemplate`, which a
precompiling SSR transform uses to turn JSX straight into HTML strings (escaping
entities, serializing `style` objects to CSS, unwrapping signal-like values via
`valueOf`). That's how Preact can compile JSX to string concatenation for fast
server rendering.

`Fragment` is the simplest possible component:

```js
export function Fragment(props) {
    return props.children;
}
```

It renders its children with no wrapper element. The root of every render is wrapped in
one.

`cloneElement` mirrors `createElement` but starts from an existing vnode's props,
overlaying new ones and optionally replacing children - used by libraries that need to
inject props into `props.children`.

---

## 5. `options`: the plugin system everything is built on

Before we touch the diff, you need `options` firmly in your head - the diff is littered
with calls into it, and the entire hooks system quietly lives here.

`options` is a single shared object. The core seeds it with just an error handler:

```js
const options = { _catchError };
export default options;
```

Everything else is optional callback slots. At specific moments, the core does
`if (options._someHook) options._someHook(...)`. The important slots, in the order they
fire during a render:

- **`options.vnode(vnode)`** - every time a vnode is created. Compat uses this to
  normalize props; devtools to tag nodes.
- **`options._root(vnode, parentDom)`** - at the start of a top-level `render`.
- **`options._diff(vnode)`** - before a vnode is diffed. Hooks use it to clear the
  "current component."
- **`options._render(vnode)`** - right before a component's render function runs. Hooks
  use it to set the current component and reset the hook index. **This is where hooks
  attach to a component.**
- **`options._commit(root, commitQueue)`** - after diffing, during commit. Hooks use it
  to flush layout effects.
- **`options.diffed(vnode)`** - after a vnode is fully diffed. Hooks use it to schedule
  passive effects.
- **`options.unmount(vnode)`** - when a vnode is removed. Hooks use it to run cleanups.
- **`options._catchError(error, vnode, oldVNode)`** - when anything throws.
- **`options.event(e)`** - wraps every DOM event before it reaches a handler. Compat uses
  it to add React's synthetic-event methods.
- **`options.debounceRendering(cb)`** - lets you control *when* the batched flush runs
  (tests set it to run synchronously).

Plugins follow a strict pattern: capture the previous handler, install a new one, call
the previous one inside. That's how hooks, compat, and devtools can all listen to the
same slot without clobbering each other:

```js
let oldRender = options._render;
options._render = vnode => {
    if (oldRender) oldRender(vnode);
    // ...plugin work...
};
```

Keep this in mind for the entire rest of the document: **whenever you see `options._x`
called in the core, that's an extension point, and the interesting behavior may live in
hooks or compat, not in core.**

---

## 6. `render`: the entry point

```js
export function render(vnode, parentDom) {
    if (parentDom == document) parentDom = document.documentElement;
    if (options._root) options._root(vnode, parentDom);

    let isHydrating = vnode && vnode._flags & MODE_HYDRATE;

    // The previously-rendered tree is stashed on the DOM node itself:
    let oldVNode = isHydrating ? null : parentDom._children;
    parentDom._children = createElement(Fragment, null, [vnode]);

    let commitQueue = [], refQueue = [];
    diff(parentDom, parentDom._children, oldVNode || EMPTY_OBJ, /* …context, namespace… */,
         commitQueue, /* …oldDom… */, isHydrating, refQueue, parentDom.ownerDocument);
    commitRoot(commitQueue, parentDom._children, refQueue);
}
```

Three things to absorb:

1. **The old tree lives on `parentDom._children`.** Preact attaches the last-rendered
   vnode tree to the container DOM node. Call `render` again on the same container and it
   finds the old tree and diffs against it, rather than wiping and rebuilding. That's how
   re-rendering the root works.

2. **The root is always wrapped in a `Fragment`.** Uniform shape - the top of the tree
   is just another component vnode, so the diff has no special root case.

3. **`commitQueue` and `refQueue` are out-parameters.** Diffing is split into two phases.
   The **render phase** (`diff`) computes and applies DOM changes and collects two lists:
   components with lifecycle/effect callbacks to run (`commitQueue`) and refs to attach
   (`refQueue`). The **commit phase** (`commitRoot`) drains those lists. Same two-phase
   model React uses, far less machinery.

`hydrate(vnode, parentDom)` is simply `render` with the `MODE_HYDRATE` flag set on the
vnode. That flag tells the element diff to adopt existing server-rendered DOM instead of
creating new nodes, and to skip prop diffing (the server already set them).

---

## 7. The diff, part 1: the unified algorithm

`diff` handles exactly one vnode, and it's the beating heart of the whole library. One
function, dispatching on the type:

```js
export function diff(parentDom, newVNode, oldVNode, globalContext, namespace,
                     excessDomChildren, commitQueue, oldDom, isHydrating, refQueue, doc) {
    let newType = newVNode.type;

    if (newVNode.constructor !== undefined) return null;   // security guard

    if (options._diff) options._diff(newVNode);            // plugin slot

    if (typeof newType == 'function') {
        // ── COMPONENT BRANCH (section 8) ──
    } else {
        // ── DOM ELEMENT BRANCH (section 9) ──
        newVNode._dom = diffElementNodes(oldVNode._dom, newVNode, oldVNode, /* … */);
    }

    if (options.diffed) options.diffed(newVNode);          // plugin slot
    return /* the DOM cursor for the next sibling */;
}
```

A few structural facts:

- **The walk is a single top-down pass.** There is no separate "build a vnode tree, then
  reconcile it" step like old React. Preact diffs as it descends.
- **`diff` does not call itself for children.** It calls `diffChildren`, which loops the
  children and calls `diff` once per child. Recursion happens through that pair.
- **`oldDom`** threads through the whole recursion. It's a moving cursor pointing at the
  real DOM node that the *next* created/moved node should be inserted before. It is how
  Preact knows where in the parent to splice new nodes.
- **`excessDomChildren`** is the list of pre-existing real DOM children, used during
  hydration and `replaceNode` to adopt nodes instead of creating them.
- **The two `options` calls** wrap the whole thing - `_diff` before, `diffed` after.
  Hooks hang their per-component bookkeeping off these.

The two branches are big enough to deserve their own sections.

---

## 8. The diff, part 2: components

When `type` is a function, Preact needs a place to store state, lifecycle, and hook data.
That place is a **component instance**. Here is the shape of the component branch:

```
typeof newType == 'function'
   │
   ├─ class component?   →  newType.prototype.render exists
   │
   ├─ get the instance:
   │     • reuse oldVNode._component if this is an update
   │     • else, for a class:    new newType(props, context)
   │     • else, for a function: new BaseComponent(props, context),
   │                             with c.render = doRender  (calls the function)
   │
   ├─ resolve context (contextType / provider)
   │
   ├─ derive state (getDerivedStateFromProps), run pre-render lifecycle
   │
   ├─ BAIL-OUT CHECKS:
   │     • newVNode._original === oldVNode._original  → identical, skip subtree
   │     • shouldComponentUpdate(...) === false       → skip subtree
   │
   ├─ options._render(newVNode)        ◄── HOOKS PREPARE STATE HERE
   ├─ renderResult = c.render(props, state, context)   ◄── your function body runs
   │
   └─ diffChildren(parentDom, [renderResult], …)       ◄── recurse into output
```

### Functions are classes in disguise

This was the lightbulb moment for me, so I'll put it bluntly: **a function component is
run through the same machinery as a class.** When the type is a function without a
prototype `render`, Preact wraps it:

```js
newVNode._component = c = new BaseComponent(newProps, componentContext);
c.constructor = newType;     // remember the function
c.render = doRender;         // a shim
```

and `doRender` is just:

```js
function doRender(props, state, context) {
    return this.constructor(props, context);
}
```

So calling `c.render(...)` calls your function. Because there's always a `BaseComponent`
instance, `setState`, lifecycle methods, refs, and hooks all have a uniform home,
whether you wrote a class or a function. There is no separate "function component" code
path in the scheduler or the hooks layer - there's just a component instance whose
`render` happens to call a function.

### The instance and its bits

`BaseComponent` is tiny:

```js
export function BaseComponent(props, context) {
    this.props = props;
    this.context = context;
    this._bits = 0;
}
BaseComponent.prototype.render = Fragment;  // default render: render children
```

`_bits` is a bitfield mirroring `_flags` but for component state:

- `COMPONENT_DIRTY` - queued for re-render.
- `COMPONENT_FORCE` - `forceUpdate` was called; skip `shouldComponentUpdate`.
- `COMPONENT_PENDING_ERROR` / `COMPONENT_PROCESSING_EXCEPTION` - error-boundary state.

### Lifecycle order, exactly

On **mount** (no old component):
1. construct instance
2. `getDerivedStateFromProps` (if present) - else `componentWillMount`
3. `render`
4. queue `componentDidMount` to run in commit

On **update** (old component exists):
1. `getDerivedStateFromProps` - else `componentWillReceiveProps` (when props changed)
2. bail-out checks (below)
3. `componentWillUpdate`
4. `render`
5. `getSnapshotBeforeUpdate`
6. queue `componentDidUpdate` to run in commit

These run inside `diff`; the `componentDidMount`/`componentDidUpdate`/snapshot callbacks
are pushed onto the component's `_renderCallbacks` and fired later by `commitRoot`.

### The two bail-outs

Before rendering, Preact tries hard to *not* render:

```js
if (newVNode._original == oldVNode._original ||
    (!(c._bits & COMPONENT_FORCE) &&
     c.shouldComponentUpdate != null &&
     c.shouldComponentUpdate(newProps, c._nextState, componentContext) === false)) {
    // copy old DOM + children pointers onto the new vnode, then:
    break outer;   // skip rendering this subtree entirely
}
```

- **Reference bail-out** (`_original` equal): when a parent re-renders but hands a child
  the very same vnode object it had before (common with hoisted/memoized children), the
  whole subtree is provably unchanged. Skip it.
- **`shouldComponentUpdate`**: the classic escape hatch. `PureComponent`, `memo`, and the
  hooks layer all install their own `shouldComponentUpdate` to drive this bail-out.

When a bail-out happens, the new vnode inherits the old vnode's `_dom` and `_children`,
and the children's `_parent` pointers are repointed to the new vnode so the tree stays
consistent.

### The render loop (setState during render)

For function components, render runs in a small loop:

```js
do {
    c._bits &= ~COMPONENT_DIRTY;
    if (renderHook) renderHook(newVNode);   // options._render
    tmp = c.render(c.props, c.state, c.context);
    c.state = c._nextState;
} while (c._bits & COMPONENT_DIRTY && ++count < 25);
```

If you call a state setter *during* render, the component is marked dirty again, and the
loop re-runs the render synchronously (up to 25 times) instead of scheduling another
pass. This is the supported "derive state while rendering" pattern; the cap prevents
infinite loops.

### Fragment-result unwrapping and context propagation

After render:
- If the result is a keyless Fragment, its children array is used directly to avoid an
  extra tree level.
- If the component defines `getChildContext`, the returned object is merged into
  `globalContext` before recursing, so descendants see it. (This is the mechanism under
  `createContext`'s provider - see section 13.)

Then `diffChildren` recurses into the render output, and finally the component's render
callbacks (if any) are pushed onto the commit queue.

---

## 9. The diff, part 3: DOM elements, props, and events

When `type` is a string (or `null`, meaning text), we're finally touching real DOM -
that's `diffElementNodes`' job, and it's where the rubber meets the road.

### Acquiring the node

```
namespace tracking:  <svg> → SVG ns,  <math> → MathML ns,  else XHTML
                     (<foreignObject> and MathML token elements switch back to XHTML)

dom = oldVNode._dom
if no dom:
    try to claim a matching node from excessDomChildren (hydration / replaceNode)
    else if text:    doc.createTextNode(props)
    else:            doc.createElementNS(namespace, type)
```

The namespace handling is why SVG and MathML "just work" - the old article had none of
this. The `excessDomChildren` adoption is the heart of hydration: instead of creating a
fresh element, Preact finds the server-rendered one whose tag matches and takes it over.

### Text nodes

If `type` is `null`, the vnode is a text node and `props` is the string. The update is a
single line - set `dom.data` if it changed - with a special case during hydration to
avoid clobbering server text.

### Diffing props (two loops)

For element nodes, props are reconciled with two passes:

```js
// 1) remove props that existed before but are gone now
for (i in oldProps) {
    if (i != 'children' && !(i in newProps) /* …value/checked exceptions… */)
        setProperty(dom, i, null, oldProps[i], namespace);
}
// 2) set props that are new or changed
for (i in newProps) {
    if (i is children)       newChildren = value;
    else if (dangerHTML)     newHtml = value;
    else if (i is value)     inputValue = value;   // deferred - see below
    else if (i is checked)   checked = value;
    else if (oldProps[i] !== value)
        setProperty(dom, i, value, oldProps[i], namespace);
}
```

`children`, `value`, `checked`, and `dangerouslySetInnerHTML` are pulled out and handled
specially. `value`/`checked` are applied **after** children exist, because a `<select>`'s
`value` can only select an `<option>` that has already been created.

### `setProperty`: how a prop becomes DOM

This function decides, for each prop, whether to set a JS property, call `setAttribute`,
attach an event listener, or patch `style`. The logic:

- **`style`** - a string sets `cssText` directly; an object is diffed key by key. Numeric
  values are left as-is here (compat adds `px` - see section 17). Keys starting with `-`
  are treated as custom properties via `setProperty`.

- **Events (`onX`)** - this is subtle and worth understanding fully. Preact does **not**
  call `addEventListener` again when you change a handler. Instead it stores the handler
  on the DOM node and attaches a single shared proxy once:

  ```js
  if (!dom._listeners) dom._listeners = {};
  dom._listeners[name + useCapture] = value;
  if (value && !oldValue) {
      dom.addEventListener(name, useCapture ? eventProxyCapture : eventProxy, useCapture);
  } else if (!value) {
      dom.removeEventListener(name, /* proxy */, useCapture);
  }
  ```

  The proxy looks the handler back up at dispatch time:

  ```js
  function eventProxy(e) {
      return this._listeners[e.type + useCapture](options.event ? options.event(e) : e);
  }
  ```

  Changing `onClick` from one function to another just rewrites `_listeners` - no DOM
  call. The handler name is lowercased to map `onClick` → the `click` event, and a
  `Capture` suffix routes to the capture-phase proxy.

  **The event clock.** There's a real bug this guards against: while an event bubbles up,
  micro-tasks between bubbling steps can patch the DOM and insert a *new* node, and that
  new node's freshly-attached handler could fire for an event that began before it
  existed. Preact stamps each handler with a logical clock value when attached
  (`EVENT_ATTACHED`) and stamps each event with a clock value on first dispatch
  (`EVENT_DISPATCHED`). If an event's dispatch stamp predates the handler's attach stamp,
  the proxy ignores it. A logical counter is used instead of `Date.now()` so handlers
  attached and events dispatched in the same millisecond still order correctly.

- **Everything else** - Preact prefers setting the **JS property** (`dom[name] = value`)
  when the name exists on the element, because it's faster and correctly typed, with a
  hard-coded exclusion list (`width`, `height`, `href`, `list`, `form`, `tabIndex`,
  `download`, `rowSpan`, `colSpan`, `role`, `popover`) that must go through
  `setAttribute` to behave correctly. SVG needs name fixups (`className` → `class`,
  `xlinkHref` → `href`). Booleans and `false` map to attribute removal, except
  `aria-`/`data-` attributes where `false` is meaningfully different from absent.

### Recurse, then apply controlled values

If there's no `dangerouslySetInnerHTML`, Preact diffs children via `diffChildren`, then
removes any leftover real DOM children that no vnode claimed, then finally applies the
deferred `value`/`checked` so controlled form elements settle correctly.

---

## 10. The diff, part 4: keyed children and the skew algorithm

This is the cleverest part of Preact, and the part that's drifted furthest from both the
old article and from React. Pour a coffee. The goal: given the old array of child vnodes
and the new array, figure out
which new child reuses which old child (and its DOM and component state), what to insert,
what to move, and what to remove - **without allocating a key→index Map in the common
case.**

`diffChildren` runs in two phases.

### Phase A - build the new array and match each child

`constructNewChildrenArray` walks the new children. For each one it:

1. **Normalizes** primitives and arrays into vnodes: a string/number becomes a text vnode
   (`type: null`); an array becomes a `Fragment` vnode; `null`/booleans/functions become
   holes (`null` slots). A vnode already in use elsewhere in the same render is cloned so
   it gets its own DOM/component pointers.

2. **Finds the matching old child** via `findMatchingIndex`, using a running **skew**.

The skew is the whole trick, so it's worth slowing down for. Conceptually: as you insert
or remove children, the position
where you'd expect to find the "next" old child drifts. `skew` tracks that drift, so for
each new child at index `i`, its *expected* old index is `i + skew`. `findMatchingIndex`
checks that expected slot first:

```js
function findMatchingIndex(childVNode, oldChildren, skewedIndex, remainingOldChildren) {
    const key = childVNode.key, type = childVNode.type;
    let oldVNode = oldChildren[skewedIndex];
    const matched = oldVNode != null && (oldVNode._flags & MATCHED) == 0;

    // fast path: the expected slot already matches
    if ((oldVNode === null && key == null) ||
        (matched && key == oldVNode.key && type == oldVNode.type)) {
        return skewedIndex;
    }

    // otherwise fan out left and right looking for a key+type match
    if (remainingOldChildren > (matched ? 1 : 0)) {
        let x = skewedIndex - 1, y = skewedIndex + 1;
        while (x >= 0 || y < oldChildren.length) {
            const childIndex = x >= 0 ? x-- : y++;
            oldVNode = oldChildren[childIndex];
            if (oldVNode != null && (oldVNode._flags & MATCHED) == 0 &&
                key == oldVNode.key && type == oldVNode.type) {
                return childIndex;
            }
        }
    }
    return -1;   // no match → this is a new node
}
```

For the everyday cases - appending, prepending, updating in place - the fast path hits
every time and the whole reconcile is O(n) with zero allocation. Only genuine reorders
trigger the bidirectional search.

After matching, the skew is adjusted. The rules (worth reading slowly):

```js
if (oldVNode == null || oldVNode._original == null) {
    // matched nothing (new node), or matched a "mounting" placeholder
    if (matchingIndex == -1) {
        if (newChildrenLength > oldChildrenLength) skew--;       // list grew
        else if (newChildrenLength < oldChildrenLength) skew++;  // list shrank
    }
    if (typeof childVNode.type != 'function') childVNode._flags |= INSERT_VNODE;
} else if (matchingIndex != skewedIndex) {
    // matched, but not where we expected → something moved
    if (matchingIndex == skewedIndex - 1) skew--;
    else if (matchingIndex == skewedIndex + 1) skew++;
    else {
        if (matchingIndex > skewedIndex) skew--; else skew++;
        childVNode._flags |= INSERT_VNODE;   // a real move/swap → mark for DOM insertion
    }
}
```

Two worked examples make it click:

- **Prepend** `[1,2,3] → [0,1,2,3]`. New child `0` at index 0 finds no match (it's new);
  list grew so `skew--` (skew = −1) and `0` is flagged INSERT. Next, new child `1` at
  index 1 has expected old index `1 + (−1) = 0` → finds old `1` exactly. Likewise `2`→`2`,
  `3`→`3`. Result: only `0` is inserted; nothing else moves. One DOM op.

- **Swap** `[0,1,2] → [1,0,2]`. New `1` at index 0, expected old index 0, finds old `1`
  at index 1 (offset +... ) → it's a move, flag INSERT, adjust skew. New `0` at index 1
  finds old `0`. New `2` lands in place. One node gets moved. The library explicitly
  treats a 1-position offset as an insertion/deletion and a larger offset as a swap; the
  source comments call out that this is a deliberate size-vs-optimality tradeoff.

Matched old vnodes get the `MATCHED` flag (so phase A can later tell which old children
were *not* reused). New DOM vnodes with no match get `INSERT_VNODE`.

### Phase B - diff each child and place its DOM

Now the main loop diffs each new child against its matched old child and positions the
DOM:

```js
for (i = 0; i < newChildrenLength; i++) {
    childVNode = newParentVNode._children[i];
    oldVNode = oldChildren[childVNode._index] || EMPTY_OBJ;   // matched old child
    childVNode._index = i;                                    // now store final index

    let result = diff(parentDom, childVNode, oldVNode, /* … */, oldDom, /* … */);

    newDom = childVNode._dom;
    // …queue ref changes…

    if (childVNode._flags & INSERT_VNODE || oldVNode._children === childVNode._children) {
        oldDom = insert(childVNode, oldDom, parentDom, /* shouldPlace */);
    } else if (typeof childVNode.type == 'function' && result !== undefined) {
        oldDom = result;
    } else if (newDom) {
        oldDom = newDom.nextSibling;
    }
    childVNode._flags &= ~(INSERT_VNODE | MATCHED);
}
newParentVNode._dom = firstChildDom;
```

`oldDom` is the insertion cursor. For each child:
- If it's flagged for insertion (or it's a bail-out that copied children), call `insert`,
  which for a DOM node does `parentDom.insertBefore(dom, oldDom)` and for a component
  recurses into its children (a component has no DOM of its own, so "inserting" it means
  inserting its descendants). The cursor advances past the placed node(s).
- Otherwise the node is already in place; just advance the cursor to the next sibling.

Because most children are neither new nor moved, most iterations perform **zero** DOM
mutations - they only advance the cursor. That's the performance win.

### Phase C - unmount the leftovers

Any old child still lacking the `MATCHED` flag wasn't reused, so it's removed:

```js
if (remainingOldChildren) {
    for (i = 0; i < oldChildrenLength; i++) {
        oldVNode = oldChildren[i];
        if (oldVNode != null && (oldVNode._flags & MATCHED) == 0) {
            if (oldVNode._dom == oldDom) oldDom = getDomSibling(oldVNode);
            unmount(oldVNode, oldVNode);
        }
    }
}
```

`unmount` runs `componentWillUnmount`, detaches refs (sets them to `null`), recurses to
children, removes the DOM node, and clears the vnode's pointers. `getDomSibling` keeps the
cursor valid as nodes disappear.

### Why keys matter, concretely

Without a `key`, matching is by `type` + position. Insert one item at the top of an
unkeyed list and *every* subsequent new child mismatches its old child by one position →
the fan-out search may re-pair them, but if types repeat you can reuse the *wrong* old
node, recreate DOM, and lose component state (an `<input>` loses focus/value, a child
component resets). With a stable `key`, `findMatchingIndex` pairs each new child with the
correct old child and only the inserted node touches the DOM. **This is the single most
important practical rule for anyone using or building a VDOM.**

---

## 11. The commit phase

By the time `diff` returns, the DOM already matches the new tree - the visible work is
done. `commitRoot` mops up the side-effects that have to wait until *after* the DOM is
consistent:

```js
export function commitRoot(commitQueue, root, refQueue) {
    // 1) attach refs (in the order children were diffed)
    for (let i = 0; i < refQueue.length; i++)
        applyRef(refQueue[i], refQueue[++i], refQueue[++i]);

    // 2) plugin slot - hooks flush LAYOUT effects here
    if (options._commit) options._commit(root, commitQueue);

    // 3) run each queued component's callbacks: componentDidMount/Update,
    //    setState callbacks, forceUpdate callbacks, in tree order
    commitQueue.some(c => {
        let cbs = c._renderCallbacks;
        c._renderCallbacks = [];
        cbs.some(cb => cb.call(c));
    });
}
```

Order matters and is guaranteed:
1. **Refs** attach first, so that by the time `componentDidMount` runs, `this.refs` /
   `ref.current` are populated.
2. **Layout effects** (`useLayoutEffect`) run next, synchronously, before the browser
   paints - via the `options._commit` slot that hooks fills.
3. **Lifecycle callbacks** run last.

`applyRef` handles both object refs (`ref.current = value`) and callback refs
(`ref(value)`), and - React-19 style - stores the cleanup a callback ref may return so it
can be invoked when the ref detaches.

---

## 12. The scheduler: why `setState` is async

The old article re-rendered synchronously on every single state change - easy to explain,
rough in practice. Modern Preact **batches** updates and renders them on a microtask
instead. This all lives in the `Component`/scheduler code.

### `setState`

```js
BaseComponent.prototype.setState = function (update, callback) {
    let s = (this._nextState != null && this._nextState != this.state)
        ? this._nextState
        : (this._nextState = assign({}, this.state));    // clone state once

    if (typeof update == 'function') update = update(assign({}, s), this.props);
    if (update) assign(s, update); else return;          // merge the partial

    if (this._vnode) {                                   // only if mounted
        if (callback) this._stateCallbacks.push(callback);
        enqueueRender(this);
    }
};
```

State is accumulated into `_nextState` (a clone, so functional updaters and libraries like
Immer that freeze state still work), then the component is enqueued. It is *not* rendered
yet.

### `enqueueRender` and the microtask flush

```js
const rerenderQueue = [];
let rerenderCount = 0, prevDebounce;

export function enqueueRender(c) {
    if ((!(c._bits & COMPONENT_DIRTY) && (c._bits |= COMPONENT_DIRTY) &&
         rerenderQueue.push(c) && !rerenderCount++) ||
        prevDebounce != options.debounceRendering) {
        prevDebounce = options.debounceRendering;
        (prevDebounce || queueMicrotask)(process);
    }
}
```

Each component is marked dirty and pushed **once**. The flush (`process`) is scheduled
exactly once per batch, on the next microtask (`queueMicrotask`), unless you override
`options.debounceRendering` (tests set it to run synchronously; you could set it to
`requestAnimationFrame`). So ten `setState` calls in one click handler produce **one**
render on the next tick.

### `process`: depth-ordered draining

```js
function process() {
    let c, l = 1;
    while (rerenderQueue.length) {
        if (rerenderQueue.length > l) rerenderQueue.sort((a, b) => a._vnode._depth - b._vnode._depth);
        c = rerenderQueue.shift();
        l = rerenderQueue.length;
        if (c._bits & COMPONENT_DIRTY) renderComponent(c);
    }
    rerenderQueue.length = rerenderCount = 0;
}
```

The queue is kept sorted by tree depth so **parents render before children**. If a parent
render also re-renders a child that was independently queued, the child is already clean
(or gets re-queued in order) and isn't rendered twice. New items added mid-flush (e.g. a
context provider enqueuing its subscribers) are folded into the same pass in the right
order.

### `renderComponent`: re-rendering one subtree

```js
function renderComponent(component) {
    const oldVNode = component._vnode, oldDom = oldVNode._dom;
    const parentDom = component._parentDom;
    if (!parentDom) return;

    const newVNode = assign({}, oldVNode);   // shallow clone
    newVNode._original = oldVNode._original + 1;   // force a real diff (not a ref bail-out)

    diff(parentDom, newVNode, oldVNode, component._globalContext, parentDom.namespaceURI,
         /* excessDom */, commitQueue, oldDom == null ? getDomSibling(oldVNode) : oldDom,
         /* isHydrating */, refQueue, parentDom.ownerDocument);

    newVNode._original = oldVNode._original;        // restore identity
    newVNode._parent._children[newVNode._index] = newVNode;   // splice into the tree
    commitRoot(commitQueue, newVNode, refQueue);

    if (newVNode._dom != oldDom) updateParentDomPointers(newVNode);
}
```

This, right here, is the magic of local updates. To re-render a component sitting deep in
the tree,
Preact clones its vnode, bumps `_original` so the diff doesn't short-circuit, diffs just
that subtree, commits, and stitches the new vnode back into its parent's `_children`. The
rest of the tree is untouched.

### `getDomSibling` and `updateParentDomPointers`

For a subtree-local diff to insert DOM in the right place, it must answer "what real DOM
node comes after me?" without knowing the whole tree's layout. `getDomSibling` answers it
by walking the vnode tree:

```js
export function getDomSibling(vnode, childIndex) {
    if (childIndex == null)
        return vnode._parent ? getDomSibling(vnode._parent, vnode._index + 1) : null;

    for (; childIndex < vnode._children.length; childIndex++) {
        let sibling = vnode._children[childIndex];
        if (sibling != null && sibling._dom != null) return sibling._dom;
    }
    return typeof vnode.type == 'function' ? getDomSibling(vnode) : null;
}
```

It looks rightward among siblings for the first one that owns DOM; failing that, it climbs
to the parent and continues. Because every vnode keeps its `_dom` pointer current, this
finds the correct insertion anchor.

And when a component's first DOM node changes, `updateParentDomPointers` walks **up**,
fixing each ancestor's `_dom` so future `getDomSibling` calls stay correct:

```js
function updateParentDomPointers(vnode) {
    if ((vnode = vnode._parent) != null && vnode._component != null) {
        vnode._dom = null;
        vnode._children.some(child => {
            if (child != null && child._dom != null) return (vnode._dom = child._dom);
        });
        return updateParentDomPointers(vnode);
    }
}
```

Together, `_dom` + `_parent` + these two functions are Preact's whole answer to "how do
you update part of a tree in place" - the role Fiber plays in React, in ~30 lines.

---

## 13. Context

`createContext(defaultValue)` returns a `Context` object that is itself a component. The
provider uses the **legacy context channel** (`getChildContext`) that the component diff
already merges into `globalContext`, plus a subscriber set for targeted updates:

```js
export function createContext(defaultValue) {
    function Context(props) {
        if (!this.getChildContext) {
            let subs = new Set();
            let ctx = {};
            ctx[Context._id] = this;                    // keyed by a unique id

            this.getChildContext = () => ctx;           // merged into globalContext by the diff

            this.shouldComponentUpdate = function (_props) {
                if (this.props.value != _props.value) {
                    subs.forEach(c => {                 // re-render ONLY subscribers
                        c._bits |= COMPONENT_FORCE;
                        enqueueRender(c);
                    });
                }
            };

            this.sub = c => {                           // a consumer subscribes
                subs.add(c);
                let old = c.componentWillUnmount;
                c.componentWillUnmount = () => { subs.delete(c); if (old) old.call(c); };
            };
        }
        return props.children;
    }
    Context._id = '__cC' + i++;
    Context._defaultValue = defaultValue;
    Context.Consumer = (props, contextValue) => props.children(contextValue);
    Context.Provider = Context;
    return Context;
}
```

Two channels at once:
- **Down the tree:** `getChildContext` puts `this` into `globalContext` under
  `Context._id`. Any descendant component whose `contextType` is this context reads
  `provider.props.value` during its diff. The `useContext` hook reads the same place.
- **Targeted updates:** when the provider's `value` changes, instead of re-rendering its
  whole subtree, it force-enqueues only the components that subscribed via `sub`. That's
  why a context update can skip intermediate `memo`'d components and still reach a deep
  consumer - the consumer subscribed directly. Subscriptions auto-clean on unmount by
  wrapping `componentWillUnmount`.

`Context.Consumer` is a function component that calls `props.children(value)` - the
render-prop form. `useContext` is the hook form (section 16).

---

## 14. Refs

A ref is either an object `{ current }` (from `createRef` or `useRef`) or a callback. The
diff collects ref changes into `refQueue` during child diffing and applies them in
`commitRoot` via `applyRef`:

```js
export function applyRef(ref, value, vnode) {
    if (typeof ref == 'function') {
        if (typeof ref._unmount == 'function') ref._unmount();   // run previous cleanup
        if (typeof ref._unmount != 'function' || value != null)
            ref._unmount = ref(value);   // callback refs may return a cleanup (React 19)
    } else ref.current = value;
}
```

Refs are set to the component instance for class/function-with-instance types, or to the
DOM node for elements. On unmount, refs are called with `null` (or `current` is nulled).
A ref only fires when it changes between renders - the child diff compares
`oldVNode.ref != childVNode.ref` before queueing, and detaches the old one first.

---

## 15. Error boundaries

Any throw during diff/commit routes through `options._catchError`, whose core
implementation walks **up** the vnode tree looking for the nearest component that can
handle it:

```js
export function _catchError(error, vnode) {
    for (; (vnode = vnode._parent); ) {
        let component = vnode._component;
        if (component && !(component._bits & COMPONENT_PROCESSING_EXCEPTION)) {
            component._bits |= COMPONENT_FORCE;
            let ctor = component.constructor;
            if (ctor && ctor.getDerivedStateFromError != null) {
                component.setState(ctor.getDerivedStateFromError(error));
                handled = component._bits & COMPONENT_DIRTY;
            }
            if (component.componentDidCatch != null) {
                component.componentDidCatch(error, {});
                handled = component._bits & COMPONENT_DIRTY;
            }
            if (handled) {                                   // it re-rendered → boundary caught it
                component._bits |= COMPONENT_PENDING_ERROR;
                return;
            }
        }
    }
    throw error;   // nobody handled it → rethrow
}
```

A component is an **error boundary** if it defines `getDerivedStateFromError` or
`componentDidCatch`. When found, the boundary is forced to re-render (presumably into a
fallback UI), and `COMPONENT_PENDING_ERROR`/`PROCESSING_EXCEPTION` bits prevent the same
error from being re-caught by the same boundary mid-recovery. If no boundary exists, the
error is rethrown to the host. Compat layers on top of this to intercept thrown
**promises** for Suspense (section 18).

---

## 16. Hooks: the complete picture

Hooks are **not in the core** - and honestly, once that clicks, half their apparent
weirdness stops being weird. They're a separate module that installs handlers on the
`options` slots from section 5. The core component diff knows nothing about them; it just
calls `options._render(vnode)` before running a component, and that's the seam hooks slip
through.

### Where hook state lives

Each component instance gets a `__hooks` object the first time a hook runs:

```js
currentComponent.__hooks = {
    _list: [],            // one entry per hook call, in call order
    _pendingEffects: []   // passive effects queued to run after paint
};
```

`getHookState(index, type)` returns `_list[index]`, growing the list on first render:

```js
function getHookState(index, type) {
    if (options._hook) options._hook(currentComponent, index, currentHook || type);
    const hooks = currentComponent.__hooks ||
        (currentComponent.__hooks = { _list: [], _pendingEffects: [] });
    if (index >= hooks._list.length) hooks._list.push({});
    return hooks._list[index];
}
```

**Hooks are addressed purely by call order.** The first `useState` in your function is
slot 0, the next hook is slot 1, and so on. This is *the* reason you can't call hooks
conditionally: an `if` that skips a hook shifts every later index and corrupts the
mapping between hook calls and stored state. There's no name, no key - only position.
(And yes, this is the real reason that lint rule yells at you, not some arbitrary style
preference.)

### How hooks attach to the render: the `options` wiring

The hooks module installs these handlers (each chains the previous one):

- **`options._diff`** - fires before any vnode diffs. Clears `currentComponent = null`.

- **`options._render`** - fires right before a component's render runs. This is the
  critical one:

  ```js
  options._render = vnode => {
      currentComponent = vnode._component;   // "the component whose hooks are about to run"
      currentIndex = 0;                      // reset the slot counter
      const hooks = currentComponent.__hooks;
      if (hooks) {
          // …flush state updates / run pending effects from a re-entrant render…
      }
  };
  ```

  When your function body then calls `useState()`, that call reads `currentComponent` and
  `currentIndex++` to find its slot. The "current component" is a module-level variable -
  this is the well-known "hooks rely on a global pointer set by the renderer" design.

- **`options.diffed`** - after a component diffs, if it has pending passive effects,
  schedule them to run after paint; then clear `currentComponent`.

- **`options._commit`** - during commit, run this component's **layout** effects
  synchronously (cleanup first, then effect).

- **`options.unmount`** - run every hook's cleanup when the component unmounts.

So the lifetime of a hook call is: `_diff` clears the pointer → `_render` sets it and
resets the index → your function runs and the hooks read/write their slots → `diffed`
schedules passive effects → `_commit` runs layout effects → on removal, `unmount` runs
cleanups.

### `useState` and `useReducer`

`useState` is literally `useReducer` with a trivial reducer:

```js
export function useState(initialState) {
    currentHook = 1;
    return useReducer(invokeOrReturn, initialState);   // invokeOrReturn(arg,f)=typeof f=='function'?f(arg):f
}
```

`useReducer` stores `[value, dispatch]` in its slot. The dispatch computes the next state
and only schedules a render if it actually changed:

```js
export function useReducer(reducer, initialState, init) {
    const hookState = getHookState(currentIndex++, 2);
    hookState._reducer = reducer;
    if (!hookState._component) {
        hookState._value = [
            init ? init(initialState) : invokeOrReturn(undefined, initialState),
            action => {
                const currentValue = hookState._nextValue ? hookState._nextValue[0] : hookState._value[0];
                const nextValue = hookState._reducer(currentValue, action);
                if (!Object.is(currentValue, nextValue)) {
                    hookState._nextValue = [nextValue, hookState._value[1]];
                    hookState._component.setState({});   // schedule a render
                }
            }
        ];
        hookState._component = currentComponent;
        // …install the bail-out shouldComponentUpdate (below)…
    }
    return hookState._value;
}
```

Note the dispatch reads `_nextValue` if present, so multiple dispatches in a row chain
correctly before the render happens. The `setState({})` is an empty update whose only job
is to enqueue the component.

**The bail-out.** On first use, a stateful hook installs a `shouldComponentUpdate` on the
component that flushes pending hook values into place and decides whether anything
actually changed:

```js
function updateHookState(p, s, c) {
    const hooksList = hookState._component.__hooks._list;
    let shouldUpdate = hookState._component.props !== p || hooksList.every(x => !x._nextValue);
    hooksList.some(hookItem => {
        if (hookItem._nextValue) {
            const currentValue = hookItem._value[0];
            hookItem._value = hookItem._nextValue;
            hookItem._nextValue = undefined;
            if (!Object.is(currentValue, hookItem._value[0])) shouldUpdate = true;
        }
    });
    return prevScu ? prevScu.call(this, p, s, c) || shouldUpdate : shouldUpdate;
}
```

This is what makes "set state to the same value → component stops re-rendering" work
(matching React), while still composing with a user-defined `shouldComponentUpdate`. A
paired `componentWillUpdate` ensures the same flush happens on `forceUpdate`, which skips
sCU.

### Effects: `useEffect` vs `useLayoutEffect`

Both compare dependency arrays with `Object.is` per element, and differ only in **when
they run**:

```js
export function useEffect(callback, args) {
    const state = getHookState(currentIndex++, 3);
    if (!options._skipEffects && argsChanged(state._args, args)) {
        state._value = callback;
        state._pendingArgs = args;
        currentComponent.__hooks._pendingEffects.push(state);   // → run AFTER paint
    }
}

export function useLayoutEffect(callback, args) {
    const state = getHookState(currentIndex++, 4);
    if (!options._skipEffects && argsChanged(state._args, args)) {
        state._value = callback;
        state._pendingArgs = args;
        currentComponent._renderCallbacks.push(state);          // → run during commit
    }
}
```

- **`useLayoutEffect`** pushes onto `_renderCallbacks`, which `commitRoot` drains via the
  `options._commit` slot - **synchronously after the DOM is mutated, before the browser
  paints.** Use it for measurements/mutations the user must never see in an intermediate
  state.

- **`useEffect`** pushes onto `__hooks._pendingEffects`. After the component diffs,
  `options.diffed` schedules a flush "after the next paint." That scheduling combines
  `requestAnimationFrame` with a `setTimeout` fallback (35 ms, ~30 Hz) so effects still
  run even when the tab is backgrounded and rAF never fires:

  ```js
  function afterNextFrame(callback) {
      const done = () => { clearTimeout(timeout); if (HAS_RAF) cancelAnimationFrame(raf); setTimeout(callback); };
      const timeout = setTimeout(done, RAF_TIMEOUT);
      let raf; if (HAS_RAF) raf = requestAnimationFrame(done);
  }
  ```

The function you return from an effect is its **cleanup**, stored as `_cleanup`. Cleanup
runs before the effect re-runs (when deps change) and on unmount. The runner carefully
saves/restores `currentComponent` around each cleanup/effect, because an effect can
itself call `render()` and move the global pointer:

```js
function invokeEffect(hook) {
    const comp = currentComponent;
    hook._cleanup = hook._value();
    currentComponent = comp;
}
```

### The rest of the hooks

- **`useRef(initial)`** is just a memoized box: `useMemo(() => ({ current: initial }), [])`.
  A stable object that survives renders.

- **`useMemo(factory, deps)`** recomputes `factory()` only when `deps` change (via
  `argsChanged`). **`useCallback(fn, deps)`** is `useMemo(() => fn, deps)`.

- **`useContext(context)`** reads the provider out of the current component's context and
  subscribes for updates:

  ```js
  export function useContext(context) {
      const provider = currentComponent.context[context._id];
      const state = getHookState(currentIndex++, 9);
      state._context = context;
      if (!provider) return context._defaultValue;   // no provider → default
      if (state._value == null) { state._value = true; provider.sub(currentComponent); }
      return provider.props.value;
  }
  ```

  Subscribing means the consumer re-renders when the provider's value changes, even
  through `memo` boundaries (section 13).

- **`useImperativeHandle(ref, create, deps)`** is implemented on top of `useLayoutEffect`:
  it assigns `ref.current = create()` (or calls a callback ref) after commit, with the ref
  appended to the dependency list so it re-runs if the ref identity changes.

- **`useErrorBoundary(cb)`** wires a `componentDidCatch` onto the instance that stores the
  error in a paired `useState` and calls your callback, returning `[error, reset]`.

- **`useId()`** generates a tree-stable id (e.g. `P0-3`) by walking up to the nearest
  "mask" node - a counter propagated from the render root (and across Suspense/Portal
  boundaries). Because the walk is deterministic, server and client produce identical ids,
  which is what hydration needs.

- **`useDebugValue(value, fmt)`** forwards a label to devtools via `options.useDebugValue`;
  it does nothing in production without devtools.

---

## 17. `preact/compat`: pretending to be React

`preact/compat` makes Preact a drop-in for React. It's a magic trick, and like every good
magic trick it's mostly misdirection: it re-exports core under React names and then
patches `options` to translate React semantics into Preact's. Almost all of it is
implemented as plugins - the core never changes.

### Prop and element normalization (`options.vnode`)

Compat installs an `options.vnode` handler that rewrites DOM-element props to React's
conventions before they reach the diff:

- `className` → `class`; keeps both in sync, with `className` as a getter so reads work.
- `onChange` on inputs/textareas → `onInput` (React's "change" fires on every keystroke);
  `onChange` on file/checkbox/radio is left alone. `onDoubleClick` → `ondblclick`,
  `onFocus`/`onBlur` → the bubbling `onfocusin`/`onfocusout`.
- Numeric `style` values get `px` appended unless the property is unitless (a regex
  encodes the unitless set like `opacity`, `zIndex`, `flex`…).
- `defaultValue` is mapped onto `value` when appropriate; controlled `<select multiple>`
  and `<select defaultValue>` are translated into `selected` flags on the option children.
- camelCase SVG attributes are dashed/lowercased.
- `defaultProps` on a component are merged into props.
- Every vnode is tagged `$$typeof = Symbol.for('react.element')` so `react-is`-style
  checks pass, and class refs are lifted from props to the vnode's `ref`.

It also fixes a `<textarea>` value edge case in `options.diffed`.

### Synthetic events (`options.event`)

React handlers receive a synthetic event with extra methods. Compat adds them to every
event via the `options.event` slot - the slot the core event proxy calls before invoking
your handler:

```js
options.event = e => {
    e.persist = () => {};
    e.isPropagationStopped = () => e.cancelBubble;
    e.isDefaultPrevented = () => e.defaultPrevented;
    return (e.nativeEvent = e);
};
```

### `memo`

Wraps a component so it only re-renders when props change (a shallow compare, or your
custom comparator), by installing a `shouldComponentUpdate` that drives the diff's
bail-out:

```js
export function memo(c, comparer) {
    function shouldUpdate(nextProps) {
        const ref = this.props.ref;
        if (ref != nextProps.ref && ref) { /* detach old ref */ }
        return comparer ? !comparer(this.props, nextProps) || ref != nextProps.ref
                        : shallowDiffers(this.props, nextProps);
    }
    function Memoed(props) { this.shouldComponentUpdate = shouldUpdate; return createElement(c, props); }
    Memoed._forwarded = Memoed.prototype.isReactComponent = true;
    Memoed.type = c;
    return Memoed;
}
```

`shallowDiffers` returns true if any own prop differs by `Object.is` - the same primitive
`PureComponent` uses.

### `forwardRef`

Lets a function component receive a `ref` as a second argument (the pre-automatic-runtime
way to forward refs through a wrapper). It clones props minus `ref`, calls your function
with `(props, ref)`, and stamps the result with the `react.forward_ref` symbol and a
`render` property that some libraries (mobx-react) check for.

### `PureComponent`

A `Component` subclass with a built-in `shouldComponentUpdate` that shallow-compares both
props and state. Pure render bail-out without writing the comparison yourself.

### `createPortal`

Renders a subtree into a *different* DOM container while keeping it logically inside the
parent tree (for context, events). The trick is a **fake DOM parent** whose `insertBefore`
forwards to the real container, with a nested `render()` into it:

```js
function Portal(props) {
    if (!this._temp) {
        this._temp = {
            nodeType: 1, parentNode: props._container, childNodes: [],
            insertBefore(child, before) { this.childNodes.push(child); props._container.insertBefore(child, before); }
            /* …ownerDocument, namespaceURI, a _mask for useId… */
        };
    }
    render(createElement(ContextProvider, { context: this.context }, props._vnode), this._temp);
}
```

The portal's children get diffed against the fake parent, but their real DOM lands in the
target container. Context flows in because the children are wrapped in a provider carrying
the portal's own context. On unmount it renders `null` into the temp to clean up.

### React-18 hooks and entry points

Compat provides the concurrent-era hooks, most as pragmatic shims since Preact is
synchronous:

- `useTransition` → `[false, cb => cb()]`, `startTransition(cb) => cb()`,
  `useDeferredValue(v) => v`, `useInsertionEffect` → `useLayoutEffect`. Preact has no
  concurrent mode, so "transitions" just run synchronously.
- `useSyncExternalStore(subscribe, getSnapshot)` is a real implementation: it reads a
  snapshot, stores it, subscribes in an effect, and forces an update when the snapshot
  changes (checked via `Object.is`) - the standard external-store pattern.
- `flushSync(cb)` temporarily sets `options.debounceRendering` to run synchronously,
  forcing an immediate flush.
- `findDOMNode`, `unmountComponentAtNode`, `createFactory`, `isValidElement`, `isMemo`,
  `Children`, `StrictMode` (aliased to `Fragment`), and `unstable_batchedUpdates`
  (a no-op passthrough) round out the API.
- `version` reports `'18.3.1'` and the legendary
  `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` object exposes the hooks through a
  `ReactCurrentDispatcher` so libraries that reach into React's internals still work.

`Children` (`map`/`forEach`/`count`/`only`/`toArray`) is a thin wrapper over
`toChildArray`, which flattens nested children/arrays into a flat vnode list - essentially
a no-op for Preact, present only for API parity.

---

## 18. Suspense and lazy, in depth

Suspense is built on one idea: **a component can throw a promise to say "I'm not ready."**
Compat patches `options._catchError` to intercept thrown thenables before the normal
error path:

```js
options._catchError = (error, newVNode, oldVNode, errorInfo) => {
    if (error.then) {                                  // it's a promise → suspension
        let vnode = newVNode;
        while ((vnode = vnode._parent)) {
            let component = vnode._component;
            if (component && component._childDidSuspend) {
                if (newVNode._dom == null) {           // preserve current DOM
                    newVNode._dom = oldVNode._dom;
                    newVNode._children = oldVNode._children;
                }
                return component._childDidSuspend(error, newVNode);
            }
        }
    }
    oldCatchError(error, newVNode, oldVNode, errorInfo);   // otherwise, normal error path
};
```

So a thrown promise walks up to the nearest `Suspense` and calls its `_childDidSuspend`.
That method:

1. Records the suspending component and increments a pending count.
2. Nulls the suspender's `_parentDom` so its queued renders no-op while suspended (avoids
   churning the scheduler).
3. On the first suspension (and not during hydration), calls `setState` to swap the
   children for the `fallback`, parking the real children aside (`_detachOnNextRender`).
4. Subscribes to the promise; when it resolves, decrements the count, and once it hits
   zero, restores the parked children, restores `_parentDom`, and `forceUpdate`s the
   suspenders.

`Suspense.prototype.render` returns two fragments - the children (or `null` while
suspended) and the fallback (only while suspended) - and, when detaching, deep-clones the
parked subtree into an off-document parent so its effects/cleanups don't fire while it's
hidden. During hydration the real server markup is intentionally left on screen and
hydrated when the data resolves, rather than flashing the fallback.

`lazy(loader)` is the common producer of suspensions:

```js
export function lazy(loader) {
    let prom, component, error, resolved;
    function Lazy(props) {
        if (!prom) prom = loader().then(m => { component = m.default || m; resolved = true; },
                                        e => { error = e; resolved = true; });
        if (error) throw error;
        if (!resolved) throw prom;                 // suspend until the import resolves
        return createElement(component, props);
    }
    return Lazy;
}
```

First render throws the import promise (suspends → fallback shows); when the module loads,
the Suspense boundary force-updates and `Lazy` renders the real component.

---

## 19. The other packages

- **`preact/debug`** - import once in development (`import 'preact/debug'`). It patches
  `options` to add developer-grade diagnostics: errors on hooks called outside render or
  in bad order, warnings on duplicate keys, invalid nesting (`<table>` without `<tbody>`),
  bad/missing prop types (via an optional `propTypes`), passing a vnode as a prop without
  rendering, and rendering to an invalid container. It also builds a human-readable
  **component stack** for errors by walking `_parent`. None of it ships to production.

- **`preact/devtools`** - `import 'preact/devtools'` connects a running app to the React
  DevTools browser extension, again through `options` slots, so you can inspect the Preact
  tree, props, state, and hooks in the familiar UI.

- **`preact/test-utils`** - provides `act(callback)`, which runs the callback and then
  synchronously flushes the render queue **and** effects (toggling
  `options.requestAnimationFrame`/`debounceRendering` to be synchronous), so tests can
  assert on post-effect DOM without timers. Also `setupRerender`/`teardown` helpers.

- **`preact/jsx-runtime`** - covered in section 4: the `jsx`/`jsxs`/`jsxDEV` factories for
  the automatic transform, plus the SSR string helpers.

---

## 20. Build your own VDOM: an ordered checklist

If your goal is to actually *write* a VDOM library - and you should try it at least once -
implement these in order. Each step is testable on its own and builds on the one before.
Everything you need is already explained above.

1. **VNode + `h()`.** Plain objects with `type`, `props`, `key`, `ref`, and empty
   `_children`/`_dom`/`_parent` slots. Lift `key`/`ref` out of props. (§3, §4)

2. **Mount-only render.** Recursively create real DOM from a vnode tree and append it. No
   diffing yet. Prove a static tree renders. (§6, §9)

3. **Element diff.** Given an old and new vnode of the same type, patch props (two loops:
   remove gone, set changed) and recurse into children by index. Add an event system: one
   shared proxy per node, handler stored on the node, swap on update. (§9)

4. **Keyed children diff.** Add `key`+`type` matching. Start with a simple key→index Map
   for correctness; optimize to the skew heuristic later. Track which old children went
   unmatched and unmount them. This step is where correctness lives - test reorders,
   inserts, removes, and state preservation. (§10)

5. **Components.** Let `type` be a function; create a backing instance so state has a home;
   wrap function components so they share the class path. Run lifecycle in the right order.
   Add the reference + `shouldComponentUpdate` bail-outs. (§8)

6. **Scheduler.** `setState` accumulates into `_nextState`, marks the instance dirty,
   pushes it once, and schedules a single microtask flush. Sort the queue by depth so
   parents render first. Re-render one subtree by cloning its vnode and diffing in place.
   (§12)

7. **DOM placement for local updates.** Implement `getDomSibling` (find the next real DOM
   node by walking the vnode tree) and keep `_dom` pointers correct up the tree after a
   local render, so a deep update inserts in the right spot without touching the root.
   (§12)

8. **Two-phase commit.** Split "compute & apply DOM changes" from "fire refs, then layout
   effects, then lifecycle callbacks." Collect refs and callbacks during the diff; drain
   them after. (§11)

9. **The plugin seam.** Add an `options`-style object with empty callback slots fired at
   create / before-render / after-diff / commit / unmount. Prove you can build something
   on top of it without touching core. (§5)

10. **Hooks (on top of the seam).** A per-instance ordered hook list, a "current
    component" pointer set in the before-render slot and an index reset to zero, state
    setters that schedule a render, and two effect queues - one flushed at commit (layout)
    and one after paint (passive) - with cleanups. Build `useState`/`useReducer` first,
    then `useEffect`, then derive `useMemo`/`useRef`/`useCallback`/`useContext`. (§16)

11. **Context, refs, error boundaries.** Context via a child-context channel plus a
    subscriber set for targeted updates; refs applied in commit; errors bubbled up
    `_parent` to the nearest boundary. (§13, §14, §15)

12. **A compat layer (optional).** Once core is solid, normalize props/events to React
    semantics through the plugin seam and add `memo`/`forwardRef`/`Suspense`/portals.
    (§17, §18)

If you do these in order, you will have rebuilt Preact - and understood every line of it.

---

## 21. Appendix: the underscore field glossary

The source uses leading-underscore fields for "private" internals (the production build
mangles them to single letters). Decoded:

**On a VNode:**

| Field | Meaning |
|---|---|
| `_children` | array of child vnodes (makes it a tree node) |
| `_parent` | parent vnode (upward walk) |
| `_dom` | first real DOM node this vnode owns |
| `_component` | backing component instance (function/class types) |
| `_depth` | tree depth; orders the rerender queue |
| `_original` | version stamp; equal old/new ⇒ subtree can be skipped |
| `_index` | sibling position (also scratch space during matching) |
| `_flags` | bitfield: `INSERT_VNODE`, `MATCHED`, `MODE_HYDRATE`, `MODE_SUSPENDED` |
| `_mask` | id namespace for `useId`, propagated from the root |

**On a Component instance:**

| Field | Meaning |
|---|---|
| `_vnode` | the vnode currently backed by this instance |
| `_parentDom` | the DOM container this component renders into |
| `_globalContext` | merged legacy context visible to this component |
| `_nextState` | pending state accumulated by `setState` before commit |
| `_bits` | bitfield: `DIRTY`, `FORCE`, `PENDING_ERROR`, `PROCESSING_EXCEPTION` |
| `_renderCallbacks` | callbacks (incl. layout effects) to run at commit |
| `_stateCallbacks` | `setState` callbacks to run at commit |
| `__hooks` | `{ _list, _pendingEffects }` - this component's hook state |

**On a hook slot (`__hooks._list[i]`):**

| Field | Meaning |
|---|---|
| `_value` | the hook's stored value (e.g. `[state, dispatch]`, a memo result) |
| `_nextValue` | pending value for a state hook before the next render |
| `_args` | last dependency array (for memo/effect change detection) |
| `_pendingArgs` | dependency array awaiting commit |
| `_cleanup` | the function returned by an effect, run before re-run/unmount |
| `_component` | the owning component (for state hooks) |

---

### Suggested reading + debugging path

Read the source in this order, with the matching sections here open beside you:

1. the flag/constant definitions (small, sets vocabulary) - §3
2. vnode creation - §3, §4
3. `options` (it's two lines, but it's the spine) - §5
4. `render`/`hydrate` - §6
5. the diff: element branch first, then the component branch - §7, §9, §8
6. children reconciliation (the hard, rewarding part) - §10
7. the scheduler - §12
8. hooks - §16

Then set a breakpoint at the top of `diff` and at the top of `diffChildren`, render a
tiny app with a keyed list and a `useState`, and single-step through one mount and one
update. The whole engine is about 1500 lines; once you've stepped through it twice it
stops being mysterious and starts being obvious.
