---
title: "Owl 3 Internals, Part 2: blockdom, The Rendering Engine"
date: "2026-07-31"
summary: "How Owl turns a static subtree into one cloneNode plus a topologically sorted list of pointer hops, why patching costs nothing for markup that never changes, and how the keyed list diff avoids allocating anything in the common case."
tags: [owl, framework-internals, virtual-dom, performance, javascript]
series: "Owl 3 Internals"
order: 2
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 2 of 12*

> A classic virtual DOM allocates one object per element on every render and then diffs
> every attribute of every one of them. For a business UI with thousands of mostly-static
> elements, almost all of that work is provably useless. blockdom is what you get when you
> take that observation seriously.

---

## 1. The idea

Split a template into **blocks** - maximal static subtrees - and for each block emit a class
that does two things: clone a prepared `<template>`, then apply a flat array of dynamic
values at positions known at compile time.

That's it. The rest is implementation.

```
   template string
        │  createBlock(str)                    block_compiler.ts
        ▼
   ┌──────────────────────────────────────────┐
   │ step 0: DOMParser → a real DOM prototype │
   │ step 1: buildTree → IntermediateTree     │  a binary tree
   │ step 2: buildContext → BlockCtx          │  flat arrays
   │ step 3: createBlockClass → class Block   │  monomorphic
   └──────────────────────────────────────────┘
        │  memoised in cache[str]
        ▼
   block1(data, children)  →  a VNode instance
```

`createBlock` is cached by the template string in a module-global map, so two components
with identical markup share one block class.

---

## 2. Everything is a VNode

```
Block (generated)   a static subtree + its update points
VText               a bare text node
VMulti              fixed-arity fragment, slots may be undefined
VList               variable-arity keyed list (t-foreach)
VToggler            swap the child when a key changes
VHtml               raw HTML injection (t-out of Markup)
VCatcher            event handlers on a component or slot boundary
ComponentNode       ← a child component. yes, really.
```

They all satisfy one interface:

```ts
interface VNode<T = any> {
    mount(parent: MountTarget, afterNode: Node | null): void;
    moveBeforeDOMNode(node: Node | null, parent?: MountTarget): void;
    moveBeforeVNode(other: T | null, afterNode: Node | null): void;
    patch(other: T, withBeforeRemove: boolean): void;
    beforeRemove(): void;
    remove(): void;
    firstNode(): Node | undefined;
    el?; parentEl?; isOnlyChild?; key?;
}
```

Seven methods. Because `ComponentNode` implements them too, blockdom has no concept of a
component - a component is just a node that happens to render a subtree when you patch it.

**One invariant runs through all of this and nothing enforces it:** `patch(other)` is only
ever called with an `other` of the same concrete type. There is no type tag, no `instanceof`
check, nowhere in the patch path. Type changes are handled a level up by `VToggler`, which
removes and remounts when its key changes. Break the invariant and you don't get an
exception, you get silently corrupted DOM. Keep it in mind if you ever touch the code
generator.

---

## 3. Step 1: an intermediate binary tree

The compiler emits markup with synthetic markers in it. `buildTree` walks that markup and
decodes them:

| Marker | Meaning |
| --- | --- |
| `<block-text-N/>` | dynamic text at data index N |
| `<block-child-N/>` | anchor position for child vnode N |
| `block-handler-N="click"` | event handler |
| `block-attribute-N="class"` | dynamic attribute |
| `block-property-N="value"` | dynamic DOM **property** |
| `block-attributes="N"` | spread attributes (`t-att`) |
| `block-ref="N"` | `t-ref` callback |

The tree it builds is binary - `firstChild` and `nextSibling`, not an array of children:

```ts
interface IntermediateTree {
    parent; firstChild; nextSibling;
    el: Node;
    info: DynamicInfo[];
    isRef?: boolean; refIdx?: number; refN: number;
    currentNS: string | null;
}
```

`refN` is the interesting field. When a node needs a runtime reference, `addRef` walks up
the whole ancestor chain incrementing `refN`:

```ts
function addRef(tree) {
    tree.isRef = true;
    do { tree.refN++; } while ((tree = tree.parent));
}
```

So `refN` at any node equals the number of references living in its subtree. That count is
what lets the next step assign reference indices in one pre-order pass with no map lookups.

There's also a small detail I liked: when the root element is created, it gets appended into
a detached `<template>.content` first. The comment explains why - setting `src` on an
`<img>` fires a network request, and you really don't want that happening at compile time.

---

## 4. Step 2: the reference-collection plan

This is the cleverest part of blockdom, and it took me two readings to see what it was
doing.

The goal: at mount time, get from the cloned root element to every dynamic location using
only `firstChild` and `nextSibling`, with no `querySelector`, no `childNodes[i]`, and no
tree walk.

```ts
function buildContext(tree, ctx?, fromIdx?) {
    if (tree.refN) {
        const initialIdx = fromIdx;

        if (tree.isRef) {
            tree.refIdx = initialIdx;
            updateCtx(ctx, tree);
            fromIdx++;
        }

        if (nextSibling) {                        // right subtree
            const idx = fromIdx + firstChild;     // skip past the left subtree's refs
            ctx.collectors.push({ idx, prevIdx: initialIdx, getVal: nodeGetNextSibling });
            buildContext(tree.nextSibling, ctx, idx);
        }

        if (firstChild) {                         // left subtree
            ctx.collectors.push({ idx: fromIdx, prevIdx: initialIdx, getVal: nodeGetFirstChild });
            buildContext(tree.firstChild, ctx, fromIdx);
        }
    }
}
```

A collector is `{ idx, prevIdx, getVal }`, which means exactly one thing:

```
refs[idx] = getVal.call(refs[prevIdx])
```

Because indices are handed out in the same order the collectors are pushed, running the
array **front to back** at mount time guarantees every `prevIdx` is already populated. No
sorting, no dependency resolution, no checks. Just a list of two-operation instructions in a
valid order.

The getters aren't `node.firstChild` either. They're the raw property descriptors, grabbed
once at module load:

```ts
const nodeGetFirstChild  = getDescriptor(Node.prototype, "firstChild").get!;
const nodeGetNextSibling = getDescriptor(Node.prototype, "nextSibling").get!;
const characterDataSetData = getDescriptor(CharacterData.prototype, "data").set!;
```

Calling the descriptor directly sidesteps the megamorphic prototype lookup you'd otherwise
get across mixed element types. Same trick is used for `insertBefore`, `cloneNode`,
`remove`, and `classList.add/remove`.

---

## 5. Step 3: bit-packing

`createBlockClass` flattens everything into parallel arrays and squeezes the small integers
into single numbers:

```js
// collectors: bits 0-14 idx, bits 15-29 prevIdx, bit 30 isFirstChild
colPacked = collectors.map(c =>
    (c.idx & 0x7fff)
    | ((c.prevIdx & 0x7fff) << 15)
    | ((c.getVal === nodeGetFirstChild ? 1 : 0) << 30));

// children: bits 0-14 parentRefIdx, bit 15 isOnlyChild, bits 16-30 afterRefIdx
childInfos = children.map(c =>
    (c.parentRefIdx & 0x7fff)
    | ((c.isOnlyChild ? 1 : 0) << 15)
    | (((c.afterRefIdx ?? 0) & 0x7fff) << 16));
```

Everything stays in V8's small-integer range, so no boxing and no heap allocation, and three
property loads collapse into one array read plus shifts.

The cost: a hard cap of **32767 references per block**, and nothing checks it. A pathological
template would silently corrupt rather than throw. It's theoretical, but it's a real bug and
it's about four lines to fix - a decent first patch if you want one.

---

## 6. Mount

```js
mount(parent, afterNode) {
    const el = nodeCloneNode.call(template, true);   // one deep clone, whole subtree

    const refs = new Array(refN);
    this.refs = refs;
    refs[0] = el;
    for (let i = 0; i < colN; i++) {                 // resolve refs — O(refs)
        const packed = colPacked[i];
        refs[packed & 0x7fff] =
            GETTERS[(packed >> 30) & 1].call(refs[(packed >> 15) & 0x7fff]);
    }

    if (locN) {                                      // apply data — O(locations)
        const data = this.data;
        for (let i = 0; i < locN; i++) {
            locSetters[i].call(refs[locRefIdxs[i]], data[i]);
        }
    }

    if (childN) { /* mount children into refs, still off-document */ }

    nodeInsertBefore.call(parent, el, afterNode);    // ONE document mutation
    this.el = el; this.parentEl = parent;

    /* then fire t-ref callbacks, now that el is live */
}
```

The thing to notice: attributes, text, children, and event listeners are all applied to a
**detached** clone. Exactly one `insertBefore` touches the live document per block. No
layout thrash, no intermediate style recalculation. If you take one idea away from blockdom,
take that one.

---

## 7. Patch

```js
patch(other, withBeforeRemove) {
    if (this === other) return;                      // identity fast path
    const refs = this.refs;

    if (locN) {
        const data1 = this.data, data2 = other.data;
        for (let i = 0; i < locN; i++) {
            const val1 = data1[i], val2 = data2[i];
            if (val1 !== val2) {
                locUpdaters[i].call(refs[locRefIdxs[i]], val2, val1);
            }
        }
        this.data = data2;
    }

    if (childN) { /* pairwise by index; null→node mounts, node→null removes */ }
}
```

What's *absent* is the point. No attribute enumeration. No tag comparison. No key matching.
No children reordering. Positions were fixed at compile time, so patch cost is **O(number of
dynamic locations)** and completely independent of how big the DOM subtree is.

Also: `patch` reuses `this.refs`. Only `mount` allocates it.

And if `refN === 0` - a fully static block - the class keeps the trivial base-class `mount`
and `patch`, where patch is an empty function. Static markup is genuinely free to re-render.

---

## 8. The keyed list diff

`VList.patch` is a two-ended diff of the Vue 2 / ivi school, with a lazy map fallback.

```
ch1: [a b c d e]        ch2: [a c b e f]
      ^       ^               ^       ^
     s1      e1              s2      e2

loop while s1 <= e1 && s2 <= e2:

  1. skip nulled-out old entries at either end
  2. key(s1) === key(s2)?   patch in place,  s1++, s2++
  3. key(e1) === key(e2)?   patch in place,  e1--, e2--
  4. key(s1) === key(e2)?   moved RIGHT: patch, moveBefore(ch2[e2+1]), s1++, e2--
  5. key(e1) === key(s2)?   moved LEFT:  patch, moveBefore(ch1[s1]),   e1--, s2++
  6. else: build key→index map over ch1[s1..e1] ONCE, then
             found   → move into place, patch, ch1[idx] = null
             missing → mount ch2[s2] before firstNode(ch1[s1])
           s2++

tail: s1 > e1  →  mount the remaining ch2 entries before the anchor
      else     →  remove the remaining ch1 entries
```

Details that matter:

- The map is built **lazily**. Appends, prepends, reversals and plain in-place updates never
  allocate it. Only a genuine shuffle pays.
- The *new* array gets mutated to hold the *old*, already-DOM-bound vnodes (`ch2[startIdx2]
  = startVn1`). `this.children = ch2` is assigned before the loop, which is why that works.
- Prototype methods are destructured out once and called with `.call`, making every call
  site monomorphic. In practice all children of a list are the same block type, so V8 inlines
  them.
- A trailing anchor text node is always mounted, so an empty list still occupies a position.
- Fast path: emptying a list that is its parent's only child becomes
  `parent.textContent = ""` plus re-appending the anchor. One operation instead of N.

Complexity is O(n) time and O(1) space in the good cases, O(n)/O(n) on a shuffle.

There's no longest-increasing-subsequence pass, unlike Vue 3 or Inferno, so Owl performs
more DOM moves than strictly necessary on a full shuffle. That's a deliberate trade -
simpler code, no O(n log n) step, and full shuffles are rare in business UIs. It's also an
open opportunity if you want to benchmark something real.

---

## 9. Text, class, style, attributes

**Text** goes through a hand-written switch rather than `String(v)`:

```ts
function toText(value) {
    switch (typeof value) {
        case "string":  return value;
        case "number":  return String(value);
        case "boolean": return value ? "true" : "false";
        default:        return value || "";
    }
}
```

That default branch is why `null` renders as empty and not as the literal string `"null"`.

**Attributes** treat `false | null | undefined` as removal and `true` as an empty string, so
`t-att-disabled="false"` correctly drops the attribute.

**Classes** normalise both old and new values into objects (`"a b"` becomes
`{a: true, b: true}`), then diff and touch only the difference via `classList.add/remove`.
The practical consequence is that classes added by non-Owl code - jQuery plugins,
third-party widgets, which Odoo has plenty of - survive a patch.

**Styles** have one rule that is not obvious at all:

```js
let changed = false;
for (let prop in val) {
    if (changed || val[prop] !== oldVal[prop]) {
        setStyleProp(style, prop, val[prop]);
        changed = true;
    }
}
```

Once *any* property has been re-applied, every property after it must be re-applied too.
CSS shorthands like `background` and `margin` reset the longhands they cover, and
declaration order decides the winner. A naive "only set what changed" loop produces silently
wrong styles. There's a comment above this explaining it, which I appreciated.

The string parser for styles is hand-written too, and respects quotes and parentheses so
`background: url(a;b)` doesn't split on the semicolon.

**Properties vs attributes** is decided by the *compiler*, not the runtime. A hardcoded
`isProp(tag, key)` table covers `input.value/checked/disabled/readOnly/indeterminate`,
`option.selected` and friends. For those, the generated code wraps the value:

```js
expr = `new String((${expr}) === 0 ? 0 : ((${expr}) || ""))`;   // for value
expr = `new Boolean(${expr})`;                                   // for booleans
```

A freshly boxed object every render defeats the `val1 !== val2` check on purpose. The user
may have typed into the input, so the DOM property has drifted from the vdom and needs
re-asserting.

---

## 10. Allocation budget

Per block instance, per render:

```
1 × Block object
1 × data array        (only if there are dynamic locations)
1 × refs array        (only at mount — patch reuses it)
1 × children array    (only if the block has child slots)
```

Everything else - setters, updaters, packed collectors, the template DOM itself - is created
once per block *type* and shared across every instance via the closure in
`createBlockClass`.

On patch, the old `Block` keeps the DOM and the freshly-rendered one is discarded once its
`data` and `children` have been stolen. Steady-state garbage is roughly one small object and
one small array per block.

---

## 11. Where it bites

- **Duplicate `t-key`** collapses entries in the key map and nodes vanish. Owl throws in dev
  mode only.
- **A missing anchor** - a code-generator change that forgets `insertAnchor` for a
  conditionally-empty child - produces "element ended up in the wrong place" bugs that are
  miserable to track down.
- **Dangling `t-ref`** after a *bulk* removal, where an ancestor block dropped the subtree so
  the child block's own `remove()` never ran. Owl handles this with a `trackedRefs` map on
  `ComponentNode` and a sweep keyed off `el.isConnected`. It's the most intricate corner of
  the whole render path and it exists because of real bugs.
- **`VToggler` shares one module-level anchor text node** across every toggler instance. It's
  only used transiently inside `patch`, but it means toggler patches are not reentrant.

---

## 12. Why this and not something else

blockdom started as a standalone experiment by the Owl team - a separate repo, benchmarked
against js-framework-benchmark - asking how fast a virtual DOM could be if you knew the
shape at compile time. It landed near the top for a VDOM library, and Owl 2 absorbed it
wholesale.

The alternative would have been compiling straight to imperative DOM calls, Svelte-style.
That's faster still, but it rules out runtime template compilation, which for Odoo is
non-negotiable. Given the constraint, blocks are close to the best you can do.

---

Next: **[the template compiler](/blog/owl-3-template-compiler)** - where those
`<block-text-0/>` markers come from in the first place.

*Part 2 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
