---
title: "Owl 3 Internals, Part 3: The Template Compiler"
date: "2026-07-30"
summary: "Owl compiles XML templates to JavaScript in the browser, at runtime, using a hand-written 400-line expression tokenizer instead of a real parser. Here's the whole pipeline, the optimisations, and the parts that are held together with string replacement."
tags: [owl, framework-internals, compilers, javascript]
series: "Owl 3 Internals"
order: 3
---

*[Owl 3 From The Inside Out](/blog/owl-3-internals) · Part 3 of 12*

> Odoo stores templates as XML records in a database and lets modules override them with
> XPath at install time. The template text is therefore only known at runtime, in the
> browser. Every strange thing about Owl's compiler follows from that one requirement.

---

## 1. The pipeline

```
  XML string, or an Element
        │
        ▼   parse_xml.ts
  parseXML()  ── DOMParser("text/xml"), parsererror → OwlError with line/col
        │
        ▼   parser.ts
  normalizeXML()   in-place: normalizeTIf, normalizeTOut
  parseNode()      an ordered chain of 14 recognisers  →  AST
        │
        ▼   code_generator.ts
  CodeGenerator.generateCode()   AST  →  a JavaScript source string
        │      ├─ BlockDescription   one per block: DOM + data slots
        │      └─ CodeTarget         one per generated function
        │
        ▼   index.ts
  new Function("app, bdom, helpers", code)   →  TemplateFunction
        │
        ▼   template_set.ts
  templateFn(app, bdom, runtimeUtils)        →  Template   (the render fn)
```

Three function layers, which trips everyone up at first:

```
TemplateFunction = (app, bdom, helpers) => Template     the factory, from new Function
Template         = (ctx, node, key) => BDom             the render function
node.renderFn    = Template.bind(component, ctx, node)  the per-instance bound render
```

`parseXML` uses `"text/xml"` and not `"text/html"` deliberately - tag case has to survive,
because **a capitalised tag means a component**.

---

## 2. The AST

Sixteen numeric tags, not strings, so the dispatch `switch` compiles to a jump table:

```ts
export const ASTType = {
    Text: 0, DomNode: 2, Multi: 3, TIf: 4, TSet: 5, TCall: 6, TOut: 7,
    TForEach: 8, TKey: 9, TComponent: 10, TDebug: 11, TLog: 12,
    TCallSlot: 13, TCallBlock: 14, TTranslation: 15, TTranslationContext: 16,
} as const;
```

One field on the base type deserves attention: `hasNoRepresentation?: true`. It marks nodes
that produce no DOM at all - `t-set`, and any wrapper around one. The code generator uses it
to work out arity when building a fragment. Without it, `<t t-set="x" .../><div/>` would
allocate a two-slot `multi` for what is really one child.

### The recogniser chain

```ts
parseTCustom || parseTDebugLog || parseTForEach || parseTIf ||
parseTTranslation || parseTTranslationContext || parseTCall || parseTCallBlock ||
parseTKey || parseTOutNode || parseTCallSlot || parseComponent ||
parseDOMNode || parseTSetNode || parseTNode
```

**That order is the semantics.** Every recogniser is destructive: it reads its attribute,
calls `node.removeAttribute(...)`, and re-enters `parseNode` on the same element. Directives
compose by peeling layers off one element, one at a time. `t-foreach` sitting before `t-if`
means `<div t-foreach t-if>` iterates first and applies the condition *inside* the loop
body.

Reorder that list and you change the meaning of templates across every Odoo module ever
written. Treat it as frozen.

Because parsing mutates the element, `parse()` clones when handed an `Element` and memoises
the result in a `WeakMap`.

### Two normalisation passes

`normalizeTIf` strips whitespace and comment nodes sitting between `t-if` / `t-elif` /
`t-else` so they end up true siblings, and throws on text between branches, two branch
directives on one node, or `t-if` mixed with `t-foreach` in an elif chain.

`normalizeTOut` rewrites `<MyComp t-out="x"/>` into `<MyComp><t t-out="x"/></MyComp>` - so
`t-out` on a component becomes its default slot.

---

## 3. The expression "parser"

This is the most controversial file in the repo, and its own header comment calls it
"an extremely naive tokenizer/parser". It has to turn this:

```
computeSomething({val: state.val})
```

into this:

```js
ctx['computeSomething']({val: ctx['state'].val})
```

The method is: tokenize, then classify each `SYMBOL` as a variable or not by peeking at its
neighbours.

```
A SYMBOL is a variable UNLESS
  · it's in RESERVED_WORDS   (true, false, null, Math, Object, __globals__, …)
  · the previous token is `.`               →  property access:  a.b
  · previous is `{` or `,` AND next is `:`  →  object key:      {a: b}
```

Plus scope tracking for arrow functions:

```ts
const scopeStack: { vars: Set<string>; depth: number }[] = [];
```

When `=>` shows up, the parameters go into a new scope tagged with the current bracket
depth. Scopes pop when the bracket stack drops back below that depth. Locals get renamed
with a `_` prefix (`x` becomes `_x`) so they can never collide with a `ctx` lookup. Template
literals recurse back into `compileExpr` with the current locals threaded through.

`processExpr` also returns `freeVariables` - the non-local identifiers referenced inside a
top-level arrow function. That powers a props optimisation I'll get to in section 5.

### What doesn't work

Regex literals, because `/` is the division operator. Destructuring in arrow parameters.
`async` / `await`. Class expressions. Comments inside expressions. Optional chaining
tokenizes by accident - `?` and `.` are separate operators - so the semantics are
coincidental rather than designed.

`OPERATORS` is a hand-written array and longest-match works only because of the order the
entries appear in it. That's the kind of thing that's fine until it isn't.

There are also word replacements for XML-hostile characters: `and` → `&&`, `or` → `||`,
`gt/gte/lt/lte` → comparisons, because `<` and `&` need escaping inside XML attributes.

Is a 400-line tokenizer instead of acorn a good trade? For a parser that ships to every
browser on every page load, yes. The cost is that the supported dialect is undocumented in
practice - you learn its boundaries by hitting `Tokenizer error`.

---

## 4. Code generation

Two bookkeeping classes carry all the state.

**`BlockDescription`** - one per emitted block. Holds `varName` (`b3`), `blockName`
(`block3`), the DOM tree being accumulated (built against an XML document so `innerHTML`
serialises as XML), `data` (names of the generated `let d1 = ...` variables), and children.

**`CodeTarget`** - one per generated *function*. There's the main template, plus one per
slot, per `t-call` body, per `t-set` body, per default slot content. It tracks
`indentLevel`, `loopLevel`, `tSetVars`, `hasRoot`, `needsScopeProtection`.

Output looks like this:

```js
function (app, bdom, helpers) {
    let { text, createBlock, list, multi, html, toggler } = bdom;
    let { withKey, prepareList, createComponent } = helpers;

    const hdlr_fn1 = (ctx) => ctx['increment']();        // hoisted handlers
    const comp1 = createComponent(app, `Child`, true, false, false, ["value"]);

    let block1 = createBlock(`<div class="x"><block-text-0/></div>`);

    function slot1(ctx, node, key = "") { /* … */ }      // sub-targets

    return function template(ctx, node, key = "") {
        let d1 = ctx['state']();
        return block1([d1]);
    }
}
```

Three things get hoisted out of the render function into factory scope, and each one is a
real win:

- **Blocks.** `createBlock` - and therefore `DOMParser` - runs once per template, not once
  per render.
- **Event handlers.** Written into `staticDefs` as module-level arrows and handed `ctx` at
  call time as `[hdlr_fn1, ctx]`. Before this, every render allocated a closure per handler.
- **`createComponent`.** The props-comparison strategy is chosen once, at compile time.

### `ctx` is a prototype chain

The rendering context is a plain object. The root is `{ this: component, __owl__: node }`.
Every `t-foreach` body does `let ctx = Object.create(ctxN)` and writes its loop variables
onto the new object. A `t-set` at the outer scope sets `needsScopeProtection`, which
prepends `ctx = Object.create(ctx)` to the whole function so the assignment can't leak into
a caller's context.

Prototype chains rather than a Map means near-O(1) lookup with V8 inline caches, and
shadowing is free.

---

## 5. Compile-time optimisations

| What | Where | Payoff |
| --- | --- | --- |
| static markup folded into the block string | `compileTDomNode` | zero per-render cost |
| `createBlock` hoisted | `generateCode` | one DOMParser call per template |
| handlers hoisted to `staticDefs` | `generateHandlerCode` | no closure alloc per render |
| `createComponent` hoisted | `compileComponent` | diff strategy decided once |
| `t-foreach` flag elision | `parseTForEach` | skips 4 ctx writes × N iterations |
| `hasNoRepresentation` | parser + `compileMulti` | avoids needless `multi()` wrappers |
| prop list computed statically | `compileComponent` | `arePropsDifferent` is a fixed loop |

The `t-foreach` flag elision is my favourite piece of pragmatic engineering in the
codebase:

```js
const html = node.outerHTML;
const hasNoTCall = !html.includes("t-call");
if (hasNoTCall && !html.includes(`${elem}_index`)) noFlags |= ForEachNoFlag.Index;
```

It's a **substring search over the raw markup**. Not scope analysis, not a symbol table - a
string search. Conservative (any `t-call` disables all elision, since the callee might touch
the loop variables) and occasionally over-conservative (a comment mentioning `item_index`
defeats it). But it's O(n), it's four lines, and it's correct by over-approximation.

### The free-variable trick

For a prop whose value is a top-level arrow function, the generator emits **synthetic
props**:

```js
props.push(`onClick: (ctx, x) => ...`);
propList.push(`"\x01onClick.count"`);
props.push(`"\x01onClick.count": ctx['count']`);
```

The arrow's identity changes on every render, so comparing it is useless. Instead Owl
compares the variables it captured. The `\x01` prefix makes the keys unmistakably internal,
and `useProps` filters them out with `k.charCodeAt(0) !== 1`.

This is what made Owl 2's manual `.alike` prop suffix unnecessary. It's a neat solution to a
problem React solves by making you write `useCallback` everywhere.

---

## 6. The part that's held together with string replacement

`t-if` compiles to a real `if / else if / else` chain writing into a `multi` block's child
slots. Because the same variable gets assigned in different branches, the generator has to
turn `const bN = ...` into `bN = ...` and hoist a `let b1, b2;` above the `if`.

It does that by matching on already-emitted source lines:

```js
if (code[i].trimStart().startsWith(`const ${current.varName} `)) {
    code[i] = code[i].replace(`const ${current.varName}`, current.varName);
    current = children.shift();
    if (!current) break;
}
```

This appears three times - in `compileTDomNode`, `compileTIf`, and `compileMulti` - and it's
the weakest point in the compiler. A generated line that coincidentally starts with
`const bN ` in a nested target would be rewritten wrongly. It hasn't bitten anyone yet as
far as I can tell, but it's the sort of thing that should be structural declaration tracking
on `CodeTarget` rather than text matching.

---

## 7. There are no source maps

`new Function` output has no `//# sourceURL`, no source map, no line mapping back to the
original XML. A runtime error inside a template gives you a frame in `anonymous`.

What you get instead:

- `t-debug` emits a `debugger;` statement **and** dumps the entire generated function to
  the console.
- `t-log="expr"` emits a `console.log`.
- Compile failures embed the full generated source in the error message, with `err.cause`
  set to the original.
- XML parse errors get a line, a column, and a caret pointing at the character.

Those are genuinely good error messages. But they don't replace a source map, and this is
the single biggest thing holding Owl's developer experience back. The fix is hard - you'd
need a custom XML scanner, because `DOMParser` doesn't hand you positions - but it's the
work I'd pick up first if I had a month.

There's no incremental compilation either. Caching is all-or-nothing per template name,
plus a `WeakMap<Element, AST>` in the parser and the block-string cache in blockdom. Change
one line and the whole template recompiles. At Owl's scale that's fine.

Ahead-of-time compilation does exist - `npm run compile_templates` walks `.xml` files under
jsdom and emits a `{ name: templateFunction }` map you can register directly, which lets you
ship the runtime-only build. That's also the only option if you're behind a strict CSP,
since `new Function` needs `unsafe-eval`.

---

## 8. Adding a directive

If you want to add `t-my-thing`, the path is:

1. Add `MyThing: 17` to `ASTType` and an `ASTMyThing` interface.
2. Write `parseMyThing(node, ctx)` and insert it into the chain in `parseNode`. Position
   matters.
3. Add a `case` to `compileAST` and write `compileMyThing`.
4. If it needs runtime support, add a helper to `template_helpers.ts` and register it with
   `this.helpers.add("myHelper")`.
5. Tests go in `owl-runtime/tests/compiler/` (compile and render) and
   `owl-compiler/tests/parser.test.ts` (AST shape).

There's a much cheaper path if you only need preprocessing: `customDirectives` in the app
config. A custom directive is `(node, value, modifiers) => void`, invoked as
`t-custom-name="..."`, that mutates the element before parsing continues. Pure sugar, no new
codegen.

---

Next: **[reactivity](/blog/owl-3-reactivity)** - the signal graph, and why a diamond
dependency only recomputes once.

*Part 3 of 12 in [Owl 3 From The Inside Out](/blog/owl-3-internals).*
