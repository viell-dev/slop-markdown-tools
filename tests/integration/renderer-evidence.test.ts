import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  createRendererReport,
  validateRendererEvidence,
  validateRendererReport,
} from "../../scripts/renderer-evidence.mjs";
import { images } from "../../scripts/forge-evidence.mjs";
import baseline from "../../scripts/obsidian/baseline.json" with { type: "json" };

function complete(renderer: string) {
  const settings = {
    profile: "realistic",
    seeds: [1, 2, 3, 4, 5],
    count: renderer === "github" ? 25 : 10,
  };
  const report = createRendererReport(renderer, settings);
  return {
    ...report,
    documents: report.plan.documents.flatMap((item, documentIndex) =>
      item.widths.map((width, widthIndex) => ({
        name: item.name,
        width,
        attempted: true,
        completed: true,
        changed: renderer !== "forges" && documentIndex === 0 && widthIndex === 0,
        views: item.views.map((name) => ({
          name,
          changed: renderer !== "forges" && documentIndex === 0 && widthIndex === 0,
          status:
            name === "repository-file" ||
            (renderer !== "forges" && documentIndex === 0 && widthIndex === 0)
              ? "compared"
              : "unchanged",
        })),
      })),
    ),
    controls: report.plan.controls.map((name) => ({ name, passed: true })),
    unexpected: [] as { name: string }[],
    compared: renderer === "forges" ? 6 : 1,
    identity:
      renderer === "github"
        ? { service: "GitHub Markdown API", version: "externally-uncontrolled" }
        : {
            app: baseline.app,
            installer: baseline.installer,
            electron: baseline.electron,
            chrome: baseline.chrome,
            image: {
              declaredBase: baseline.baseImage,
              id: `sha256:${"a".repeat(64)}`,
              platform: "linux/amd64",
            },
          },
    requested: { app: baseline.app, installer: baseline.installer },
    widths: [80, 30],
    renderers: images.map((image) => ({
      ...image,
      observedVersion: image.version,
      compared: 3,
      fileViews: 6,
    })),
  };
}

describe.each(["github", "obsidian", "forges"])("%s complete native evidence", (renderer) => {
  it("allows unchanged documents without freezing changed counts", () => {
    const report = complete(renderer);
    expect(() => validateRendererEvidence(report, renderer)).not.toThrow();
    report.documents[1]!.changed = true;
    report.documents[1]!.views.forEach((view) => {
      view.changed = true;
      view.status = "compared";
    });
    report.compared++;
    if (renderer === "forges") report.renderers[0]!.compared++;
    expect(() => validateRendererEvidence(report, renderer)).not.toThrow();
  });

  it.each([
    "missing-document",
    "duplicate-document",
    "incomplete",
    "unattempted",
    "missing-width",
    "missing-view",
    "duplicate-view",
    "missing-control",
    "failed-control",
    "duplicate-control",
    "wrong-count",
    "wrong-profile",
    "difference",
    "missing-identity",
    "shrunk-plan",
  ])("rejects %s", (mutation) => {
    const report = complete(renderer);
    const first = report.documents[0]!;
    if (mutation === "missing-document") report.documents.pop();
    if (mutation === "duplicate-document") report.documents[1] = first;
    if (mutation === "incomplete") first.completed = false;
    if (mutation === "unattempted") first.attempted = false;
    if (mutation === "missing-width") Reflect.deleteProperty(first, "width");
    if (mutation === "missing-view") first.views.pop();
    if (mutation === "duplicate-view") first.views.push(first.views[0]!);
    if (mutation === "missing-control") report.controls.pop();
    if (mutation === "failed-control") report.controls[0]!.passed = false;
    if (mutation === "duplicate-control") report.controls.push(report.controls[0]!);
    if (mutation === "wrong-count") report.compared++;
    if (mutation === "wrong-profile") report.profile = "adversarial";
    if (mutation === "difference") report.unexpected.push({ name: "changed" });
    if (mutation === "missing-identity") {
      Reflect.deleteProperty(report, "identity");
      Reflect.deleteProperty(report, "renderers");
    }
    if (mutation === "shrunk-plan") {
      const omitted = report.plan.documents.pop()!;
      report.documents = report.documents.filter((item) => item.name !== omitted.name);
      expect(() => validateRendererEvidence(report, renderer)).toThrow(
        "Native plan differs from intended workload",
      );
    }
    expect(() => validateRendererEvidence(report, renderer)).toThrow();
  });

  it("binds a consumer to its own host", () => {
    const report = complete(renderer);
    expect(() =>
      validateRendererEvidence(report, renderer === "github" ? "obsidian" : "github"),
    ).toThrow("another native renderer");
  });
});

it.each(["app", "installer", "electron", "chrome", "image"])(
  "requires actual Obsidian %s identity",
  (key) => {
    const report = complete("obsidian");
    Reflect.deleteProperty(report.identity, key);
    expect(() => validateRendererEvidence(report, "obsidian")).toThrow();
  },
);

it("requires the pinned observed app, installer, runtime and image identity", () => {
  for (const key of ["app", "installer", "electron", "chrome"] as const) {
    const report = complete("obsidian");
    report.identity[key] = "0.0.0";
    expect(() => validateRendererEvidence(report, "obsidian")).toThrow();
  }
  const report = complete("obsidian");
  report.identity.image!.declaredBase = "mutable:latest";
  expect(() => validateRendererEvidence(report, "obsidian")).toThrow();
});

it("allows an explicit latest observation only outside deterministic gate evidence", () => {
  const report = complete("obsidian");
  report.requested = { app: "latest", installer: "latest" };
  report.identity.app = "2.0.0";
  report.identity.installer = "2.0.0";
  expect(() => validateRendererReport(report, report, "obsidian")).not.toThrow();
  expect(() => validateRendererEvidence(report, "obsidian")).toThrow();
});

it.each(["github", "obsidian"])(
  "retains the independent positive-comparison floor for %s",
  (renderer) => {
    const report = complete(renderer);
    for (const record of report.documents) {
      record.changed = false;
      for (const view of record.views) {
        view.changed = false;
        view.status = "unchanged";
      }
    }
    report.compared = 0;
    expect(() => validateRendererReport(report, report, renderer)).not.toThrow();
    expect(() => validateRendererEvidence(report, renderer)).toThrow(
      "No native documents compared",
    );
  },
);

it("keeps deliberate latest workflow inputs separate from reusable baseline defaults", () => {
  const workflow = parse(
    readFileSync(new URL("../../.github/workflows/obsidian.yml", import.meta.url), "utf8"),
  ) as {
    on: Record<string, { inputs: Record<string, { default?: string }> }>;
    jobs: { compare: { steps: { name?: string; env?: Record<string, string> }[] } };
  };
  for (const name of ["obsidian-version", "obsidian-installer-version"]) {
    expect(workflow.on.workflow_dispatch!.inputs[name]!.default).toBe("latest");
    expect(workflow.on.workflow_call!.inputs[name]!.default).toBeUndefined();
  }
  const environment = workflow.jobs.compare.steps.find((step) => step.name === "Compare")!.env!;
  for (const name of ["OBSIDIAN_VERSION", "OBSIDIAN_INSTALLER_VERSION"])
    expect(environment[name]).toContain("github.event_name == 'schedule' && 'latest'");
});

it("binds the Docker base and inspected identity label to the verified baseline", () => {
  const instructions = readFileSync(
    new URL("../../scripts/obsidian/Dockerfile", import.meta.url),
    "utf8",
  ).split("\n");
  const verify = (lines: string[]) => {
    // The declared-base contract currently has one stage. Revisit this check
    // when introducing multi-stage builds rather than accepting a first FROM.
    expect(lines.filter((line) => /^FROM\s/i.test(line.trim()))).toEqual([
      `FROM ${baseline.baseImage}`,
    ]);
    expect(lines.find((line) => line.startsWith("LABEL org.mdrefine.base-image="))).toBe(
      `LABEL org.mdrefine.base-image="${baseline.baseImage}"`,
    );
  };
  verify(instructions);
  expect(() => verify([...instructions, "FROM scratch"])).toThrow();
  for (const prefix of ["FROM ", "LABEL org.mdrefine.base-image="])
    expect(() =>
      verify(instructions.map((line) => (line.startsWith(prefix) ? `${prefix}wrong` : line))),
    ).toThrow();
});
