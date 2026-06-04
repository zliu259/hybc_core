const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSectionProgressInsight } = require("./project-section-progress");

test("buildSectionProgressInsight derives miniapp section progress and deviations", () => {
  const insight = buildSectionProgressInsight(217, [
    {
      id: 3,
      log_date: "2026-05-30",
      shift: "day",
      footage_m: 13,
      cumulative_footage_m: 130,
      completed_pipe_count: 4,
      cumulative_pipe_count: 43,
      chamber_pressure_mpa: 0.05,
      cutter_current_a: 35,
      cutter_frequency_hz: 50,
      horizontal_deviation_direction: "right",
      horizontal_deviation_mm: 5,
      vertical_deviation_direction: "high",
      vertical_deviation_mm: 5,
    },
    {
      id: 1,
      log_date: "2026-05-27",
      shift: "day",
      footage_m: 9,
      cumulative_footage_m: 105,
      completed_pipe_count: 3,
      cumulative_pipe_count: 35,
      chamber_pressure_mpa: 0.04,
      cutter_current_a: 33,
      cutter_frequency_hz: 48,
      horizontal_deviation_direction: "left",
      horizontal_deviation_mm: 2,
      vertical_deviation_direction: "low",
      vertical_deviation_mm: 3,
    },
    {
      id: 2,
      log_date: "2026-05-28",
      shift: "night",
      footage_m: 12,
      cumulative_footage_m: 117,
      completed_pipe_count: 4,
      cumulative_pipe_count: 39,
      chamber_pressure_mpa: 0.05,
      cutter_current_a: 34,
      cutter_frequency_hz: 50,
      horizontal_deviation_direction: "right",
      horizontal_deviation_mm: 4,
      vertical_deviation_direction: "high",
      vertical_deviation_mm: 4,
    },
  ]);

  assert.equal(insight.summary.advancedM, 130);
  assert.equal(insight.summary.remainingM, 87);
  assert.equal(insight.summary.averageDailyFootageM, 11.3);
  assert.equal(insight.summary.estimatedDaysRemaining, 8);
  assert.deepEqual(
    insight.trendRows.map((item) => item.label),
    ["2026-05-27 白班", "2026-05-28 夜班", "2026-05-30 白班"],
  );
  assert.deepEqual(
    insight.trendRows.map((item) => item.horizontalDeviationMm),
    [-2, 4, 5],
  );
  assert.deepEqual(
    insight.trendRows.map((item) => item.verticalDeviationMm),
    [-3, 4, 5],
  );
});
