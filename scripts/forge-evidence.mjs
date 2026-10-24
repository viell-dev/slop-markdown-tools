import assert from "node:assert/strict";
import images from "./forge-images.json" with { type: "json" };
export { images };

/** A release needs both pinned real hosts, not an empty or partial comparison. */
export function validateForgeEvidence(report) {
  assert.equal(report.renderers?.length, images.length);
  for (const [index, image] of images.entries()) {
    const observed = report.renderers[index];
    assert.equal(observed.name, image.name);
    assert.equal(observed.version, image.version);
    assert.equal(observed.observedVersion?.split("+")[0], image.version);
    assert.equal(observed.image, image.image);
    assert(observed.compared > 0, `No ${image.name} documents compared`);
    assert(observed.fileViews > 0, `No ${image.name} repository file views compared`);
  }
}
