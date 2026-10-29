// Parser-only corrections; upstream source identities are deliberate review gates.
// Adapted dependency code retains its upstream MIT notices in the generated license artifact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { repairLabelEnd, repairFootnoteSyntax } from "./parser-labels.mjs";
import { parserAdaptationSource } from "./parser-adaptations.mjs";

const specs = {
  labelEnd: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/label-end.js",
    hash: "055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364",

    provenance:
      "mdrefine#94: trusted nested-label impossibility proof; empty dictionaries skip serialization on every path",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/94"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove only after an adopted compatible label implementation preserves complete positioned trees and token observations and bounds nested-label work with empty, unrelated and matching definitions; re-prove the builtin label contract on new constructs or definition writers.",
    },
  },
  footnoteSyntax: {
    name: "micromark-extension-gfm-footnote",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "5fd8d63fcbb9918a0f7b92f2ba6adea3845e9cbf7f1e74ee239f4d018943ef6b",

    provenance:
      "mdrefine#94: trusted nearest-barrier prefix cache and earlier-closer proof; original nonempty tokenizer for external syntax",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/94"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove only after an adopted compatible tokenizer preserves positioned trees, event/token observations and positive/negative prefix and closing-only work bounds. Retain original nonempty tokenization for external syntax until equivalent compatibility is demonstrated.",
    },
  },
  editMap: {
    name: "micromark-util-edit-map",
    version: "1.0.0",
    relative: "index.js",
    hash: "0a29b60e6299a7b17e57e3c185014ad9bfe5a0ad6fd1365ce14605d6d299cbf0",

    provenance: "micromark/micromark#249: retain the untouched event prefix",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/300"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove after an adopted compatible correction retains the untouched prefix at all three import sites and passes positioned/event/array identity, container work and package/native checks.",
    },
  },
  footnote: {
    name: "mdast-util-from-markdown",
    version: "2.1.0",
    relative: "lib/index.js",
    hash: "dd0cd20672558ab4ca548b4f7e442e850863228915fff8eafd6d987d29fb107b",

    provenance: "mdrefine#280: include GFM footnote indentation in list-tail scanning",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/280"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove after an adopted mdast-util-from-markdown correction includes GFM footnote indentation in list-tail scanning and preserves exact tight/loose LF/CRLF ranges and spread across footnote dialects; retain the separate defensive range guards.",
    },
  },
  text: {
    name: "micromark",
    version: "4.0.3",
    relative: "lib/initialize/text.js",
    hash: "1c5682291dbb6cea7f95edeb6d50421238b91752c9e0fb9485bdde44628ce090",

    provenance:
      "micromark/micromark#233 and #238: compact adjacent data events; register the audited no-extra resolver identity",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: [
        "https://github.com/viell-dev/slop-markdown-tools/issues/151",
        "https://github.com/viell-dev/slop-markdown-tools/issues/240",
        "https://github.com/viell-dev/slop-markdown-tools/issues/94",
      ],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove compaction after an adopted equivalent correction passes data-event identity, repeated undefined-reference work and public parse checks. Keep or replace audited resolver registration while homogeneous batching needs it.",
    },
  },
  htmlFlow: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/html-flow.js",
    hash: "d32bc5869302bb4b54bd6c5c9c25b3004bd97a2155e0d9cdeb53fbd08510e7d8",

    provenance:
      "mdrefine#762: read a lazy type 7 HTML line as CommonMark does; GitHub's renderer differs and is protected separately",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/762"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove after an adopted micromark-core-commonmark release keeps a lazy type 7 HTML line in the container's paragraph, as CommonMark, commonmark.js, markdown-it, Forgejo, Gitea and Obsidian read it, while lazy type 1-6 starts still interrupt it, across lists, quotes, nesting and LF/CRLF. GitHub's protection for its own reading (src/syntax/github-protections.ts) stays either way.",
    },
  },
  code: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/code-text.js",
    hash: "6e59e9b77a76a825c8cd142b0a2f0495aa5122da271770cb09322456a5207451",

    provenance: "micromark/micromark#238: compact code-span data without changing padding",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/151"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove after an adopted equivalent code compaction preserves padding, suffixes, line endings and event/endpoint identities and passes inline-tree and work checks.",
    },
  },
  attention: {
    name: "micromark-core-commonmark",
    version: "2.0.4",
    relative: "lib/attention.js",
    hash: "cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4",

    provenance:
      "micromark/micromark#239 walked prefix; local exact-state opener groups, no-closer cleanup and builtin two-run batching; original-resolver compatibility",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: [
        "https://github.com/viell-dev/slop-markdown-tools/issues/151",
        "https://github.com/viell-dev/slop-markdown-tools/issues/94",
      ],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "The walked-prefix origin in micromark/micromark#239 does not cover every local adaptation. Retire each local opener, cleanup or batching component only after equivalent adopted behavior passes exact event/token/point and callback observations, work bounds, external-syntax fallback and actual compiled-product reachability.",
    },
  },
  autolink: {
    name: "micromark-extension-gfm-autolink-literal",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "2b45c68982c1f80daf125b709faba88803b131a0d710b0374dd309495a74efeb",

    provenance:
      "micromark-extension-gfm-autolink-literal#14: guard cached jumps by index, token identity, label type and current unbalanced state before jumping; keep the positive cache private in a WeakMap",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: ["https://github.com/viell-dev/slop-markdown-tools/issues/542"],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove only after a compatible adopted guarded cache passes all stale-witness controls, enumerable-token observations, actual-at-sign work and package/native checks. Equivalent adoption must include label-role/current-balance guards and a private cache; index/identity-only guards or a public token cache are insufficient.",
    },
  },
  strike: {
    name: "micromark-extension-gfm-strikethrough",
    version: "2.1.0",
    relative: "lib/syntax.js",
    hash: "293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250",

    provenance:
      "local walked-prefix, equal-length opener groups and no-closer cleanup; register the audited resolver identity and retain original-resolver compatibility",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: [
        "https://github.com/viell-dev/slop-markdown-tools/issues/151",
        "https://github.com/viell-dev/slop-markdown-tools/issues/94",
      ],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "Remove these local matching/no-closer paths after adopted equivalent handling preserves event/token/point identity and deterministic work, external-syntax fallback and the homogeneous resolver pipeline's audited function identities.",
    },
  },
  cjk: {
    name: "micromark-extension-cjk-friendly",
    version: "2.0.2",
    relative: "dist/ext/attention.js",
    hash: "32a4319b1ee61c02fcf1febe995668abaa6fa2e5c033d48099182543df5e408a",

    provenance:
      "retain CJK tokenization and original resolver; share the local fast attention resolver and register the audited method identity",
    tracking: {
      dependencyIndex: "https://github.com/viell-dev/slop-markdown-tools/issues/330",
      issues: [
        "https://github.com/viell-dev/slop-markdown-tools/issues/151",
        "https://github.com/viell-dev/slop-markdown-tools/issues/94",
      ],
      owner: "mdrefine maintaining agents",
      removalCondition:
        "This shares the core attention adaptation, not a separate CJK defect. Retire its forwarding/registration only when the shared adaptation is replaced or removed with complete CJK trees/token observations, original external-syntax fallback and compiled reachability preserved.",
    },
  },
};

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one source anchor: ${before}`);
  return source.replace(before, () => after);
}
function section(source, startText, endText, replacement) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `Missing source section: ${startText}`);
  return source.slice(0, start) + replacement(source.slice(start, end)) + source.slice(end);
}
function rewriteAttention(source) {
  return (
    section(
      source,
      "function resolveAllAttention(events, context) {",
      "\n/**",
      (original) =>
        'function resolveAllAttention(events, context) {\n  return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllAttentionOriginal(events, context) : resolveAllAttentionFast(events, context);\n}\n' +
        original.replace(
          "function resolveAllAttention(",
          () => "function resolveAllAttentionOriginal(",
        ) +
        parserAdaptationSource("attention") +
        "\nexport { mdrefineRegisterHomogeneousResolver };\n",
    ) + "\nexport const mdrefineResolveAttention = resolveAllAttention;\n"
  );
}
function rewriteStrike(source) {
  const corrected = section(
    source,
    "  function resolveAllStrikethrough(events, context) {",
    "\n  /**",
    (original) =>
      '  function resolveAllStrikethrough(events, context) {\n    return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllStrikethroughOriginal(events, context) : resolveAllStrikethroughFast(events, context);\n  }\n' +
      original.replace(
        "function resolveAllStrikethrough(",
        () => "function resolveAllStrikethroughOriginal(",
      ),
  );
  return (
    registryImport +
    once(
      corrected,
      "    resolveAll: resolveAllStrikethrough\n",
      '    resolveAll: mdrefineRegisterHomogeneousResolver(resolveAllStrikethrough, "strike")\n',
    ) +
    "\n" +
    parserAdaptationSource("strike")
  );
}
/** @param {string} kind @param {string} source @returns {string} */
function repair(kind, source) {
  if (kind === "labelEnd") return repairLabelEnd(source);
  if (kind === "footnoteSyntax") return repairFootnoteSyntax(source);
  if (kind === "editMap")
    return once(source, "    vecs.push(events.slice());\n    events.length = 0;\n", "");
  if (kind === "footnote")
    return once(
      source,
      'tailEvent[1].type === "listItemIndent")',
      'tailEvent[1].type === "listItemIndent" || tailEvent[1].type === "gfmFootnoteDefinitionIndent")',
    );
  // Upstream lets complete (type 7) HTML interrupt a paragraph on a lazy line,
  // which ends the container there; the specification does not (#762). GitHub's
  // renderer ends the container too but reads HTML to the next blank line, so
  // a renderer protection, not this reading, covers the GitHub dialect.
  if (kind === "htmlFlow")
    return once(
      source,
      "return self.interrupt && !self.parser.lazy[self.now().line] ? nok(code)",
      "return self.interrupt ? nok(code)",
    );
  if (kind === "text") {
    const at = source.indexOf("function resolveAllText");
    const start = source.indexOf("    let index = -1;", at);
    const end = source.indexOf("    return extraResolver", start);
    assert(at >= 0 && start > at && end > start);
    return registerTextResolverIdentity(
      source.slice(0, start) + parserAdaptationSource("compact-text") + source.slice(end),
    );
  }
  if (kind === "code")
    return section(source, "  // Merge adjacent spaces and data.", "  return events;", () =>
      parserAdaptationSource("compact-code"),
    );
  if (kind === "autolink") {
    const at = source.indexOf("function previousUnbalanced(events)");
    assert(at > 0 && source.indexOf("function ", at + 10) === -1);
    return source.slice(0, at) + parserAdaptationSource("autolink");
  }
  if (kind === "attention") return rewriteAttention(source);
  if (kind === "strike") return rewriteStrike(source);
  if (kind === "cjk")
    return registerCjkResolverIdentity(
      'import { mdrefineResolveAttention } from "mdrefine:core-attention";\n' +
        once(
          source,
          "resolveAll: resolveAllAttention,",
          'resolveAll(events, context) { return context.parser.constructs.disable.null.includes("mdrefineDeferredInline") ? resolveAllAttention(events, context) : mdrefineResolveAttention(events, context); },',
        ),
    );
  throw new Error(`Unknown repair ${kind}`);
}

/**
 * Validate the reviewed dependency identity before applying anchored corrections.
 * @param {string} kind
 * @param {string} source
 * @param {{name: string, version: string}} metadata
 * @returns {string}
 */
export function repairReviewedParserSource(kind, source, metadata) {
  const guard = specs[kind];
  assert(guard, `Unknown parser correction ${kind}`);
  assert.equal(metadata.name, guard.name);
  assert.equal(metadata.version, guard.version, `Review changed ${kind} package version`);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    guard.hash,
    `Review changed ${kind} package source`,
  );
  return repair(kind, source);
}

export { specs as sourceGuards, repair as repairParserSource };

function registerTextResolverIdentity(corrected) {
  // Only the EXPORTED no-extra resolver. Do not mark initializer text/string
  // callbacks, which can carry resolveAllLineSuffixes.
  return (
    registryImport +
    once(
      corrected,
      "  resolveAll: createResolver()\n",
      '  resolveAll: mdrefineRegisterHomogeneousResolver(createResolver(), "text")\n',
    )
  );
}

function registerCjkResolverIdentity(corrected) {
  corrected = once(
    corrected,
    'import { mdrefineResolveAttention } from "mdrefine:core-attention";',
    'import { mdrefineResolveAttention, mdrefineRegisterHomogeneousResolver } from "mdrefine:core-attention";',
  );
  // Kept after initialization; register the actual corrected method identity,
  // retaining its original-resolver branch for external syntax plugins.
  return corrected + '\nmdrefineRegisterHomogeneousResolver(attention.resolveAll, "attention");\n';
}

const registryImport =
  'import { mdrefineRegisterHomogeneousResolver } from "mdrefine:core-attention";\n';
