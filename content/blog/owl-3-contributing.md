---
title: "Owl 3 Internals, Part 12: Reading The Source and Sending Patches"
date: "2026-07-21"
summary: "A file-by-file reading order for the Owl codebase, the conventions the maintainers actually enforce, the invariants nothing checks, and a list of things that need doing."
tags: [owl, framework-internals, open-source, contributing, javascript]
series: "Owl 3 Internals"
order: 12
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 12 of 12*

> The whole framework is about 18k lines including tests. That's small enough to read
> completely, which is unusual and worth taking advantage of.

---

## 1. A reading order that works

I read the repo in roughly the wrong order the first time and had to go back. Here's the
order I'd use now.

### Phase 0 — orientation, an hour

`README.md`, then `doc/v3/owl/owl3_design.md` (the team's own rationale for every version 3
decision - read all of it), then `doc/v3/owl/migration_owl2_to_owl3.md` for the history.
Then the root `package.json` and `packages/owl/src/index.ts`, which is 24 lines and shows you
the whole package topology.

Get `npm ci && npm run build && npm run test` green before reading further.

### Phase 1 — the reactivity kernel, two days

Start here, not with rendering. It has no DOM dependency, it's fully testable in Node, and
everything else depends on it.

| Order | File | Lines |
| --- | --- | --- |
| 1 | `owl-core/src/{owl_error,status,batched}.ts` | 42 total |
| 2 | **`owl-core/src/computations.ts`** | 258 |
| 3 | `owl-core/src/signal.ts` | 155 |
| 4 | `owl-core/src/computed.ts` | 68 |
| 5 | `owl-core/src/effect.ts` | 69 |
| 6 | `owl-core/tests/{signals,computed,effect}.test.ts` | — |
| 7 | `owl-core/src/proxy.ts` | 435 |
| 8 | `owl-core/bench/reactivity.bench.ts` | — |

Read `computations.ts` three times. The whole framework's update model is in there.

**Checkpoint:** can you explain PENDING versus STALE, and why a diamond recomputes once?

### Phase 2 — lifetime and DI, one day

`scope.ts` (196 lines, and it's the mechanism behind every hook), then `lifecycle_hooks.ts`
(15 lines, shows the entire hook pattern), `hooks.ts`, `plugin_manager.ts`,
`registry.ts` / `resource.ts`, and finally `async_computed.ts` - which is the model for
writing a new reactive primitive correctly, because it composes existing pieces and never
touches internals.

### Phase 3 — blockdom, three days

The densest part. Read the tests alongside it; blockdom is tested standalone so you can run
it without any component machinery.

`index.ts` (the `VNode` contract - memorise the seven methods), `text.ts` (simplest possible
node), `toggler.ts` (how type changes are handled), `multi.ts` (anchors), then **`list.ts`**
(trace the keyed diff on paper), then **`block_compiler.ts`**, which is the hardest file in
the repo. Go step by step: `buildTree`, then `buildContext`, then `createBlockClass`.

Finish with `attributes.ts`, `events.ts`, `event_catcher.ts`.

**Checkpoint:** hand-execute `buildContext` on a four-node tree and verify that running the
collectors front-to-back always finds `prevIdx` already populated.

### Phase 4 — the component runtime, three days

`component.ts` first, for contrast - it's 26 lines. Then **`component_node.ts`**,
**`fibers.ts`**, `scheduler.ts` (94 lines), `error_handling.ts`, and
**`template_helpers.ts`** - everything the generated code calls, with `createComponent` as
the hot path.

Then `app.ts`, `template_set.ts`, `props.ts`, `lifecycle_hooks.ts`, and the three built-ins
(`error_boundary.ts`, `portal.ts`, `suspense.ts`) which are all written in public API.

Finish with `tests/components/concurrency.test.ts`, which is the real spec for async
rendering.

### Phase 5 — the compiler, three days

Leave it until last. The compiler's *output* only makes sense once you know blockdom and the
helpers.

`index.ts` (the whole pipeline in one function), `parse_xml.ts`, then **`parser.ts`** - AST
types first, then the order of `parseNode`, then each recogniser. Then
`inline_expressions.ts`, then **`code_generator.ts`**: read `BlockDescription` and
`CodeTarget` first, then `generateCode`, then one `compileTXxx` at a time.

**Do this with a REPL open.** For each directive, compile a minimal template and log the
output *before* reading the corresponding `compileTXxx`. That turns 1384 lines of string
assembly into twenty small obvious functions. It's the single most useful thing I did while
writing this series.

---

## 2. The invariants nothing enforces

These are the ones that produce **silent corruption** rather than an exception. Worth
knowing before you touch anything.

1. **`patch(other)` receives the same concrete VNode type.** Guaranteed by the compiler and
   `toggler`; checked nowhere.
2. **`refN ≤ 32767`** per block, because of the bit-packing layout.
3. **A block's DOM shape never changes.** The template is cloned and refs are resolved by
   fixed pointer hops.
4. **A component's top-level DOM nodes are contiguous siblings.** `VCatcher`'s range walk
   depends on it.
5. **`scopeStack` push/pop never spans an `await`.** Every push site is wrapped in
   `try/finally`.
6. **`currentComputation` is always restored in a `finally`.** Three sites:
   `updateComputation`, `untrack`, `Fiber.render`.
7. **One copy of `owl-core` per bundle.** Module-level `currentComputation` and `scopeStack`
   are shared state; two copies means reactivity silently stops working across the boundary.
8. **`t-key` values are unique within a list.** Dev-mode check only.

Number seven is the one that will cost you an afternoon if the build changes.

---

## 3. Conventions

**Formatting** is Prettier with `printWidth: 100`, and CI runs `check-formatting`. That's the
most common CI failure by a wide margin.

**Linting** is ESLint flat config. Two rules to know: `no-restricted-globals` bans the
implicit `event` and `self`, and `no-restricted-syntax` forbids `test.only` and
`describe.only`. A stray `.only` fails the build.

**Style observed throughout:** cache prototype methods and descriptors at module top on hot
paths. Lazy-allocate optional state with `??=` and `||=`. Guard DOM access with
`typeof Node !== "undefined"`, because several modules must import cleanly in Node.

And the one that matters most: **comment the *why*, never the *what*.** The codebase is
genuinely exemplary here. Many comments name the exact bug or issue number that forced the
code to look the way it does. Read `computations.ts`, `fibers.ts` and `component_node.ts` for
the standard to match.

**Commit messages** follow Odoo's convention:

```
[FIX] owl-core: compare useOnChange dependencies by value
[IMP] owl-runtime: add useOnChange hook
[REF] owl: remove the CANCELLED scope status
[DOC] owl: use the useConfig hook name throughout the docs
[REL] v3.0.0-alpha.45
```

`FIX`, `IMP`, `REF`, `DOC`, `REL`, `ADD`, `REM`. Scope is the package. Imperative subject,
lowercase after the colon.

---

## 4. Testing

| Package | Environment | Notes |
| --- | --- | --- |
| `owl-core` | node | `onUnhandledError` filters `IntentionalTestError` |
| `owl-compiler` | jsdom | parser + expression tests |
| `owl-runtime` | jsdom | aliases `@odoo/owl-core` to **source**, not dist |
| `owl` | jsdom | smoke + type tests |

**Run tests per package, not from the root**, when you're iterating:
`npm run test -w packages/owl-runtime`. Each package has its own vitest config with a
different environment and its own aliases, and a root-level invocation doesn't pick them up.
This trips up everyone once.

The runtime suite is the bulk of the project:

```
tests/
├── blockdom/    11 files — the VDOM, tested standalone, no components
├── compiler/    22 files — one per directive
├── components/  25 files — lifecycle, props, slots, concurrency, errors
├── reactivity/   3 files
├── app/          3 files
└── shadow_dom/   1 file
```

Test at the right level. A blockdom bug gets a blockdom test, not a component test that
happens to exercise it.

Two things that will fail CI: leaving a `console.log` in a runtime test, and committing
`test.only`.

`test:types` runs `tsc` over `tests/types_*.ts`. Type-level assertions are part of the suite,
so changing a public type signature usually means touching those files.

---

## 5. CI

On pull requests to `master`, Node 20 and 22:

```
npm ci
npm run test
npm run test:types
npm run check-formatting
npm run lint
npm run build
npm run build:types
npm run build:doc
npm run build:doc-v2
```

Docs are built on PRs specifically so dead links fail before merge rather than after - there's
a comment in the workflow saying so.

---

## 6. How reviewers seem to think

From reading the commit history and the comments left in the code, the things that get
attention are:

1. **Does it preserve the invariants?** See section 2.
2. **Is the *why* written down?** Non-obvious code without a rationale comment gets pushback.
3. **Is it tested at the right level?**
4. **Does it allocate on a hot path?**
5. **Is the error message good?** A new `throw` with a bare message will be asked to say what
   to do instead. This project cares about that more than most.
6. **Does it work in Odoo?** Odoo is the reference consumer and the appetite for breaking
   changes is very low.

---

## 7. Patterns worth imitating

| Pattern | Example |
| --- | --- |
| capability injection | `TemplateSet._compileTemplate`, filled by `packages/owl` |
| injectable config seam | `blockdom/config.ts` `mainEventHandler` |
| compile-time specialisation | `createComponent`'s four `arePropsDifferent` variants |
| prototype-chain scoping | template `ctx`, `PluginManager.plugins` |
| WeakMap side tables | `nodeErrorHandlers`, `fibersInError`, `signalCaches` |
| lazy allocation | `_controller ??=`, `(this.trackedRefs ||= new Map())` |
| cached prototype descriptors | `nodeGetFirstChild`, `characterDataSetData` |
| counting latch for async completion | `RootFiber.counter` |
| building features from public API | `Portal`, `Suspense`, `ErrorBoundary` |

That last row is the one I'd hold up as the real quality signal. Three things that look like
framework features are written entirely in userland API, in 23, 78 and 87 lines.

---

## 8. Things that need doing

Ordered roughly by impact over difficulty.

| Task | Impact | Difficulty |
| --- | --- | --- |
| **rendering benchmark + perf CI** | very high | medium |
| **template source maps** | very high (DX) | hard |
| plugin cycle detection | medium | easy |
| throw in dev when `refN > 0x7fff` | low, but free | easy |
| precompute event modifiers at compile time | low-medium | easy |
| add a `.once` event modifier | low | easy |
| `onUnhandledError` config hook | medium | easy |
| dev assertions for the unenforced invariants | medium | easy |
| per-key presence atoms for the `has` trap | medium | medium |
| structural declaration tracking in the codegen | medium | medium |
| LIS move minimisation in `VList` | medium | medium |
| slot-aware props diffing | high (perf) | hard |
| template type-checking via a TS LSP plugin | high (DX) | hard |

If I were picking one to actually do, it'd be the benchmark suite. Not because it's the most
interesting, but because right now nothing in the repository would catch a threefold
regression in the list diff, and every other performance change is guesswork until that
exists.

The repo also has no `CONTRIBUTING.md`, which is a small and genuinely useful thing to add.

---

## 9. That's the series

Twelve parts:
[architecture](/blog/owl-3-architecture),
[blockdom](/blog/owl-3-blockdom),
[the compiler](/blog/owl-3-template-compiler),
[reactivity](/blog/owl-3-reactivity),
[the scheduler](/blog/owl-3-scheduler-fibers),
[components and hooks](/blog/owl-3-components-hooks),
[plugins](/blog/owl-3-plugins-di),
[events and directives](/blog/owl-3-events-directives),
[performance](/blog/owl-3-performance),
[error handling](/blog/owl-3-error-handling),
[the comparison](/blog/owl-vs-react-vue-solid-svelte),
and this one.

Owl's complexity is concentrated in three files: `computations.ts`, `block_compiler.ts` and
`fibers.ts`. Everything else is comparatively straightforward once you've got those.

And the coherence of the whole thing comes from one constraint: it has to serve Odoo's web
client, where templates live in a database, third parties patch your components, and a broken
screen costs somebody money. Read every design decision against that constraint and the
codebase stops looking idiosyncratic and starts looking close to inevitable.

*Part 12 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
