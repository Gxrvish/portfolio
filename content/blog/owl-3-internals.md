---
title: "Owl 3 From The Inside Out"
date: "2026-08-02"
summary: "A twelve-part teardown of Odoo's Owl 3 framework - the block VDOM, the signal graph, the template compiler, the fiber scheduler, and the plugin system - written for people who want to send patches, not read API docs."
tags: [owl, framework-internals, javascript, typescript, odoo]
series: "Owl 3 Internals"
order: 0
---

> I spent a few weeks reading Owl 3 line by line, and this is what fell out. Twelve parts,
> covering every subsystem: how a template becomes a JavaScript function, how a static
> `<div>` costs you nothing at runtime, how the signal graph avoids recomputing a diamond
> twice, why there are two schedulers running on two different clocks, and why the whole
> thing is built the way it is.
>
> This is not a tutorial. There's a perfectly good [official documentation
> site](https://odoo.github.io/owl/) for that. This is the thing I wanted when I opened the
> repo and found `block_compiler.ts` staring back at me.

Owl is Odoo's UI framework. About 30kb gzipped, zero dependencies, written in TypeScript,
LGPL-3.0. It runs the Odoo web client, which is one of the largest open-source business
applications anyone has shipped. That last fact explains almost every design decision in
the codebase, and if you keep it in mind the whole thing stops looking idiosyncratic.

Version 3 is a hard break from version 2. The proxy-based `useState` reactivity was thrown
out and replaced with signals. The `env` object and the service registry were replaced with
a plugin system. Props were rebuilt on top of a runtime type-validation DSL. The rendering
core - blockdom, fibers, the scheduler - survived mostly intact, because it was already
good.

Everything below is against `3.0.0-alpha.45`. Line numbers will drift; the ideas won't.

---

## The series

I split this into twelve parts. They're meant to be read in order, but each one stands on
its own if you already know the neighbouring bits.

1. **[Architecture and bootstrap](/blog/owl-3-architecture)** - four packages, the
   dependency graph, and what actually happens between `mount()` and the first DOM node.
2. **[blockdom: the rendering engine](/blog/owl-3-blockdom)** - how a static subtree
   becomes one `cloneNode` plus a flat array of update points.
3. **[The template compiler](/blog/owl-3-template-compiler)** - XML to AST to a JavaScript
   source string, via a 400-line hand-rolled expression tokenizer.
4. **[Reactivity](/blog/owl-3-reactivity)** - atoms, the STALE/PENDING two-colour marking
   scheme, signals, computeds, effects, and the deep proxy built on the same substrate.
5. **[The scheduler and fibers](/blog/owl-3-scheduler-fibers)** - two queues, two clocks, a
   counting semaphore, and what happens when a render supersedes another mid-flight.
6. **[Components and hooks](/blog/owl-3-components-hooks)** - why `Component` is 26 lines,
   why there are no rules of hooks, and how props became signals.
7. **[Plugins and dependency injection](/blog/owl-3-plugins-di)** - sequenced async
   startup, prototype-chain scoping, and DI that knows the consumer's lifetime.
8. **[Events and directives](/blog/owl-3-events-directives)** - real DOM events by default,
   opt-in delegation, and what each `t-*` directive compiles down to.
9. **[Performance engineering](/blog/owl-3-performance)** - every optimisation in the
   codebase, the caches, the allocation budget, and the cliffs nobody documents.
10. **[Error handling](/blog/owl-3-error-handling)** - the handler walk, why a broken render
    never reaches the DOM, and why an unhandled error nukes the entire app.
11. **[Owl vs React, Vue, Solid, Svelte, and the
    rest](/blog/owl-vs-react-vue-solid-svelte)** - subsystem by subsystem, with the
    constraints that produced each design.
12. **[Reading the source and sending patches](/blog/owl-3-contributing)** - a file-by-file
    reading order, the conventions, and a list of things that need doing.

---

## The shape of the thing

Before the details, the one diagram worth memorising:

```
   XML template
        │  compiled once, at runtime, into a JS function
        ▼
   render function  ──────►  a tree of block/list/multi/text vnodes
        │                    (components are vnodes too)
        ▼
   Fiber tree  ─── counter hits 0 ───►  Scheduler  ─── rAF ───►  one DOM pass
        ▲
        │ a signal write marks this component dirty
        │
   Signal graph  (atoms ⇄ computations)
```

Four subsystems, and the interesting part is how thin the seams between them are.

The seam between reactivity and rendering, for instance, is about ten lines. Every
component owns a computation whose body is its own render:

```js
// component_node.ts
this.signalComputation = createComputation(
    () => this.render(false),
    false,                       // not derived - it's an effect, not a computed
    ComputationState.EXECUTED
);
```

When a fiber renders, it points the global tracking pointer at that computation, calls the
template function, and every reactive read inside subscribes the component. That's the
whole integration. There is no `connect()`, no dependency array, no observer registry.

The seam between components and the VDOM is even thinner: `ComponentNode` **implements the
`VNode` interface**. It has `mount`, `patch`, `remove`, `firstNode`, `moveBeforeVNode`. So a
child component is just another node type in the tree, and blockdom needs no concept of a
component at all. I found that genuinely clever the first time I traced it.

---

## Four packages

```
  @odoo/owl                    the facade - 24 lines
     │   injects the compiler into TemplateSet.prototype
     ├──────────────┬───────────────────┐
     ▼              ▼                   │
  owl-runtime   owl-compiler            │
   blockdom      parser.ts              │
   fibers        code_generator.ts      │
   scheduler     inline_expressions.ts  │
   components         │                 │
     │                │                 │
     └────────┬───────┘                 │
              ▼                         │
          owl-core  ◄───────────────────┘
        computations.ts   (no DOM anywhere)
        signal / computed / effect
        proxy.ts  scope.ts
        plugin_manager.ts  types.ts
```

`owl-core` has no DOM dependency at all - you can import `signal`, `computed` and `effect`
in Node and they work. `owl-compiler` needs a `DOMParser`. `owl-runtime` depends only on
core, and its `TemplateSet._compileTemplate` **throws** by default. The `owl` package exists
purely to fill that hole:

```js
// packages/owl/src/index.ts - this is the entire package
(TemplateSet.prototype)._compileTemplate = function (name, template) {
    return compile(template, { name, dev: this.dev, /* ... */ });
};
(TemplateSet.prototype)._parseXML = function (xml) { return parseXML(xml); };
```

Capability injection, done in two assignments. It buys you a runtime-only bundle for
precompiled apps at zero tree-shaking effort.

---

## Why any of this exists

Odoo stores templates as XML records in a database, and third-party modules override them
with XPath at install time. That means **the template text is only known at runtime, in the
browser**. No other mainstream framework treats runtime compilation as the primary path,
and once you accept that requirement, a lot of Owl's shape becomes forced:

- Templates have to be XML, not JSX, because XPath needs to address them.
- Expressions have to be strings inside attributes, so they need their own parser.
- That parser has to be tiny, because it ships to every browser. Hence 400 hand-written
  lines instead of acorn.
- No source maps, because there's no build step to emit them. This is the biggest thing
  wrong with Owl's developer experience and I'll come back to it.

The other constraint is that Odoo modules monkey-patch each other's components. When addon
B patches addon A's prototype, implicit proxy-based reactivity becomes impossible to reason
about - you cannot tell by reading the code what subscribes to what. An explicit `count()`
at the read site is greppable. That's most of the argument for signals, and the Owl team
says so almost in those words in their [design
notes](https://github.com/odoo/owl/blob/master/doc/v3/owl/owl3_design.md).

---

## Five files, and you can review most PRs

If you only ever read five files:

| File | Lines | What it owns |
| --- | --- | --- |
| `owl-core/src/computations.ts` | 258 | the entire update model |
| `owl-runtime/src/blockdom/block_compiler.ts` | 675 | the rendering kernel |
| `owl-runtime/src/component_node.ts` | 390 | where reactivity, VDOM and lifetime meet |
| `owl-runtime/src/rendering/fibers.ts` | 375 | async render orchestration |
| `owl-compiler/src/code_generator.ts` | 1384 | what your templates actually become |

The whole framework is about 18k lines including tests, and the comments are unusually
good - many of them name the exact bug that forced the code to look the way it does. That
made this series a lot easier to write than it had any right to be.

Start with **[part one](/blog/owl-3-architecture)**.
