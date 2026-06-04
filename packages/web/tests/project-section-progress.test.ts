import assert from "node:assert/strict";
import { test } from "node:test";

test("buildSectionProgressInsight derives progress, speed and signed deviations", async () => {
  const { buildSectionProgressInsight } =
    await import("../src/utils/project-section-progress.ts");
  const insight = buildSectionProgressInsight(100, [
    {
      id: 1,
      log_date: "2026-05-01",
      shift: "day",
      footage_m: 10,
      cumulative_footage_m: 10,
      completed_pipe_count: 3,
      cumulative_pipe_count: 3,
      chamber_pressure_mpa: 0.04,
      cutter_frequency_hz: 48,
      horizontal_deviation_direction: "left",
      horizontal_deviation_mm: 4,
      vertical_deviation_direction: "low",
      vertical_deviation_mm: 2
    },
    {
      id: 2,
      log_date: "2026-05-02",
      shift: "night",
      footage_m: 20,
      cumulative_footage_m: 30,
      completed_pipe_count: 6,
      cumulative_pipe_count: 9,
      chamber_pressure_mpa: 0.05,
      cutter_frequency_hz: 50,
      horizontal_deviation_direction: "right",
      horizontal_deviation_mm: 5,
      vertical_deviation_direction: "high",
      vertical_deviation_mm: 3
    },
    {
      id: 3,
      log_date: "2026-05-03",
      shift: "day",
      footage_m: 15,
      cumulative_footage_m: 45,
      completed_pipe_count: 4,
      cumulative_pipe_count: 13,
      chamber_pressure_mpa: 0.06,
      cutter_frequency_hz: 49,
      horizontal_deviation_direction: "right",
      horizontal_deviation_mm: 2,
      vertical_deviation_direction: "low",
      vertical_deviation_mm: 1
    }
  ]);

  assert.equal(insight.summary.advancedM, 45);
  assert.equal(insight.summary.remainingM, 55);
  assert.equal(insight.summary.progressPercent, 45);
  assert.equal(insight.summary.averageDailyFootageM, 15);
  assert.equal(insight.summary.recentDailyFootageM, 15);
  assert.equal(insight.summary.estimatedDaysRemaining, 4);
  assert.deepEqual(
    insight.trendRows.map(item => item.horizontalDeviationMm),
    [-4, 5, 2]
  );
  assert.deepEqual(
    insight.trendRows.map(item => item.verticalDeviationMm),
    [-2, 3, -1]
  );
});
