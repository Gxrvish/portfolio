---
title: "Owl vs React, Vue, Solid, Svelte, Preact, Lit and Angular"
date: "2026-07-22"
summary: "A subsystem-by-subsystem comparison of Owl 3 against seven other frameworks: rendering, scheduling, compilers, reactivity, hooks, DI, error handling, bundle size and DX - with the constraints that produced each design."
tags: [owl, react, vue, solid, svelte, framework-comparison, javascript]
series: "Owl 3 Internals"
order: 11
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 11 of 12*

> The point of this isn't picking a winner. It's understanding which constraint produced
> each design, so you can tell whether a proposed change to Owl is coherent with Owl's own
> constraints.

---

## Rendering

| | Strategy | Diff unit | Static cost | List diff |
| --- | --- | --- | --- | --- |
| **Owl** | block VDOM | static subtree | ~0 (`cloneNode`) | 2-ended + lazy map |
| React | fiber VDOM | element | full walk | index map, single pass |
| Vue 3 | VDOM + PatchFlags | element, flag-gated | hoisted, skipped | 2-ended + LIS |
| Preact | VDOM | element | full walk | keyed, single pass |
| Solid | no VDOM | expression | 0 | reconcile array |
| Svelte | no VDOM | expression | 0 | keyed each-block |
| Lit | template parts | part | ~0 (`cloneNode`) | `repeat()` directive |
| Angular | LView instructions | binding | 0 | `ngForOf` differ |

Owl sits between Lit (clone a template, keep a list of parts) and Vue (compiled VDOM with
flags). It re-renders a whole component template, but the *cost* of doing so scales with the
number of dynamic locations, not the number of elements.

Solid and Svelte are strictly finer-grained - they never re-run a component body at all. That
is a genuine architectural advantage and Owl doesn't have an answer to it. What Owl has
instead is the ability to compile a template it received five seconds ago from an HTTP
response, which neither of them can do.

---

## Scheduling

| | Clock | Interruptible | Priorities | Async components |
| --- | --- | --- | --- | --- |
| **Owl** | microtask → rAF | no | none | `onWillStart` await |
| React 18 | microtask + scheduler | **yes** | lanes, transitions | Suspense, throw a promise |
| Vue 3 | microtask | no | pre / post / sync | async setup + `<Suspense>` |
| Preact | microtask (rAF optional) | no | none | none built in |
| Solid | sync + batch | no | `startTransition` | `createResource` |
| Svelte | microtask | no | none | `{#await}` |
| Angular | zone / signals | no | none | resolvers, `@defer` |

Owl's rAF alignment is unusual - most frameworks flush on a microtask. It guarantees at most
one DOM write per frame at the cost of up to ~16ms of latency. For a data-heavy business UI
that's clearly right; for a drawing app it wouldn't be.

The async model is the more interesting difference. `onWillStart` is a **coarse, explicit**
suspension point declared per component. React's throw-a-promise and Vue's async setup
compose better - you can suspend anywhere - but they're also much harder to reason about.
Owl picked the boring option and I think it holds up.

---

## Compiler

| | Input | Expression parser | Runtime compile | Source maps |
| --- | --- | --- | --- | --- |
| **Owl** | XML string | hand tokenizer, ~400 LOC | **yes, primary** | **no** |
| React | JSX | Babel / SWC | no | yes |
| Vue 3 | SFC or string | full, Babel in dev | optional | yes |
| Svelte | `.svelte` | acorn | no | yes |
| Solid | JSX | Babel plugin | no | yes |
| Lit | tagged literal | native JS | n/a | yes |
| Angular | HTML | full | JIT deprecated | yes |

**Owl is the only mainstream framework where runtime compilation is the primary path.**
Everything follows from it: XML instead of JSX (XPath has to be able to address templates),
expressions as strings inside attributes, a tokenizer small enough to ship to every browser,
and no source maps because there's no build step to emit them.

That last one is the biggest hole in Owl's developer experience, and it's the work I'd pick
up first.

---

## Reactivity

| | Model | Deep by default | Derived | Glitch-free | Outside components |
| --- | --- | --- | --- | --- | --- |
| **Owl 3** | signals, call syntax | no (`proxy` opt-in) | `computed`, lazy | yes | **yes** |
| React | immutable + re-render | n/a | `useMemo`, manual deps | n/a | no |
| Vue 3 | proxy + refs | **yes** (`reactive`) | `computed`, lazy | yes | yes |
| Preact Signals | signals, `.value` | no | `computed` | yes | yes |
| Solid | signals, call | no (`createStore`) | `createMemo` | yes | yes |
| Svelte 5 | runes, compiled | `$state` is deep | `$derived` | yes | `.svelte.js` |
| Angular | signals | no | `computed` | yes | yes |

Owl 3's algorithm - push a PENDING marker, pull lazily - is the same family as Solid, Angular
signals and Preact Signals. What distinguishes it is offering **both** signals and a deep
proxy on one atom substrate. Vue offers both too, but via two separate implementations.

One Owl-specific detail nobody else has: **a component only subscribes during render.**
Construction, `setup()`, event handlers, lifecycle hooks - all untracked. Vue's `setup()` is
likewise untracked, React has no such notion, and Solid's fine-grained model makes the
question moot.

---

## Hooks and composition

| | Discovery | Runs | Conditional calls | Outside components |
| --- | --- | --- | --- | --- |
| **Owl** | `scopeStack` top | once | **allowed** | **yes, in plugins** |
| React | positional index | every render | forbidden | no |
| Vue 3 | `currentInstance` | once | allowed | partly |
| Solid | owner | once | allowed | yes |
| Svelte 5 | compiler | once | allowed | `.svelte.js` |
| Angular | injection context | once | partly | yes |

"Runs once" is the fault line, and everything else follows from it. Owl, Vue, Solid and
Svelte set up once and rely on reactivity for updates. React re-runs the body every render
and therefore needs the rules of hooks, plus `useMemo` and `useCallback` to compensate for
the re-running.

Owl having no rules of hooks isn't a design achievement so much as a direct consequence of
setup running once.

---

## Dependency injection

| | Mechanism | Typed | Lifetime | Ordered async init | Consumer-aware view |
| --- | --- | --- | --- | --- | --- |
| **Owl 3** | plugins, class + id | exact | Scope + cascade | `sequence` batches | **`static scoped`** |
| React | context | generic | none | no | no |
| Vue 3 | provide/inject | `InjectionKey` | none | no | no |
| Solid | context | generic | owner | no | no |
| Svelte | context | weak | component | no | no |
| Angular | injectors | exact | injector scope | `APP_INITIALIZER` | no |

That last column is the one thing Owl does that nobody else does. A plugin can hand each
consumer a view whose async methods are wrapped in the *consumer's* `scope.run`, so results
arriving after the component is destroyed reject with an `AbortError` instead of writing into
a dead component.

It exists because Odoo has thousands of "fetch, then write into a component that might be
gone" call sites. Everyone has that problem; Owl is the only one that made the correct
behaviour the default.

---

## Error handling

| | Boundary | Unhandled result | Covers async/effects |
| --- | --- | --- | --- |
| **Owl** | `onError` in any component | **destroys the app** | no |
| React | class lifecycle only | unmounts the tree | no |
| Vue 3 | `errorCaptured` | console | partly |
| Svelte 5 | `<svelte:boundary>` | console | no |
| Angular | global `ErrorHandler` | console | yes, via zones |

Owl is the strictest by a wide margin, and it's a deliberate product decision rather than a
technical one. See [part ten](/blog/owl-3-error-handling).

---

## Performance and memory

| | Update granularity | Memoisation | Alloc per update | Perf CI |
| --- | --- | --- | --- | --- |
| **Owl** | component → block locations | automatic props diff | low | **none** |
| React | component subtree | manual (`memo`, `useMemo`) | high | yes |
| Vue 3 | component + PatchFlags | automatic | medium | yes |
| Solid | expression | n/a | very low | yes |
| Svelte | expression | n/a | very low | yes |
| Lit | part | n/a | low | yes |
| Angular | binding | `OnPush` | medium | yes |

The "automatic props diff" column is underrated. In React you reach for `memo` and
`useCallback` constantly; in Owl the compiler works out which props matter and generates a
comparison specialised to that component, including the free-variable trick for arrow
functions. You basically never think about it.

The "none" in the last column is not underrated. It's just a gap.

---

## Bundle size, gzipped and approximate

| Framework | Size | Includes |
| --- | --- | --- |
| Svelte | ~2kb | runtime only; the rest is compiled per component |
| Preact | ~4kb | +signals ≈ 6kb |
| Lit | ~5kb | full |
| Solid | ~7kb | full |
| **Owl 3** | **~30kb** | runtime + reactivity + **template compiler** + plugins + type validation |
| Vue 3 | ~34kb | runtime + reactivity, compiler separate |
| React + ReactDOM | ~45kb | full |
| Angular | ~60kb+ | varies with tree-shaking |

The usual mistake is comparing Owl-with-compiler against Vue-without-compiler. Owl's
runtime-only build, with precompiled templates, is meaningfully smaller than the headline
number.

---

## Developer experience

| | Owl | React | Vue | Svelte | Angular |
| --- | --- | --- | --- | --- | --- |
| template type-checking | none | full (JSX) | good (Volar) | good | good |
| editor support | owl-vision, basic | excellent | excellent | excellent | excellent |
| devtools | own extension | excellent | excellent | good | good |
| template source maps | **no** | yes | yes | yes | yes |
| error messages | **very good** | good | good | good | mixed |
| ecosystem | Odoo, essentially | vast | large | growing | large |

The error messages column is not a courtesy. Owl's errors routinely name the component, state
the likely cause, and suggest the fix - the render loop error, the `t-on` arrow function
hint, the static prop error. That's a deliberate investment and it partly compensates for the
missing source maps.

Partly.

---

## Where Owl is genuinely ahead

1. **Runtime template compilation as a first-class, supported path.** Nothing else does this.
2. **Lifetime-aware DI** - `Scope`, `scope.run`, `abortSignal`, `static scoped`.
3. **Signal-backed registries and resources**, so extension points are reactive by
   construction and a module registering something later Just Works.
4. **Sequenced async plugin startup** with batches that settle before the next one begins.
5. **Runtime type validation of props** integrated with TypeScript inference.
6. **Error message quality.**

## Where it's behind

1. No template source maps.
2. No template type-checking - expressions are opaque strings.
3. A restricted expression grammar that's undocumented in practice.
4. No SSR or hydration story at all. Blocks have a `toString()`, but there's no path to
   adopting existing DOM instead of cloning.
5. No performance CI.
6. Ecosystem is effectively Odoo.
7. Component-level granularity, where Solid and Svelte update individual expressions.

---

## When Owl is the right choice

When you need runtime-loadable, overridable templates. When you want DI with real lifetimes.
When you're building a long-lived, extension-heavy business client that other teams will
patch.

Outside those constraints the ecosystem argument for React or Vue is usually decisive, and I
suspect the Owl team would say the same thing. Owl isn't trying to win a general framework
competition. It's trying to make a very specific, very large application maintainable, and
judged on that it's an impressive piece of work.

---

Next, the last part: **[reading the source and sending patches](/blog/owl-3-contributing)**.

*Part 11 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
