const assert = require("node:assert/strict");
const test = require("node:test");

const { buildProjectSectionLabel } = require("./log-context");

test("builds project-section label for operator logs", () => {
  assert.equal(
    buildProjectSectionLabel({
      project_name: "东线顶管项目",
      section_name: "一标段"
    }),
    "东线顶管项目-一标段"
  );
});

test("falls back to section code when section name is absent", () => {
  assert.equal(
    buildProjectSectionLabel({
      project_name: "东线顶管项目",
      section_code: "S-01"
    }),
    "东线顶管项目-S-01"
  );
});

test("marks manager logs as project level when no section exists", () => {
  assert.equal(
    buildProjectSectionLabel({
      project_name: "东线顶管项目"
    }),
    "东线顶管项目-项目级"
  );
});
