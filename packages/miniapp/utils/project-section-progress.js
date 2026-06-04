const shiftOrder = (shift) => {
  if (shift === "day") return 1;
  if (shift === "night") return 2;
  return 3;
};

const shiftLabel = (shift) => {
  if (shift === "day") return "白班";
  if (shift === "night") return "夜班";
  return shift || "-";
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const signedDeviation = (direction, value) => {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  if (direction === "left" || direction === "low") return -Math.abs(numeric);
  if (direction === "right" || direction === "high") return Math.abs(numeric);
  return numeric;
};

const round1 = (value) => Number(value.toFixed(1));

const buildDailyFootage = (rows) => {
  const daily = new Map();
  rows.forEach((row) => {
    const footage = row.footageM || 0;
    if (footage <= 0) return;
    daily.set(row.logDate, (daily.get(row.logDate) || 0) + footage);
  });
  return Array.from(daily.entries())
    .map(([date, footage]) => ({ date, footage }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const buildSectionProgressInsight = (sectionLengthM, logs) => {
  const sortedLogs = (Array.isArray(logs) ? logs : [])
    .slice()
    .sort((left, right) => {
      const dateCompare = String(left.log_date || "").localeCompare(
        String(right.log_date || ""),
      );
      if (dateCompare !== 0) return dateCompare;
      const shiftCompare = shiftOrder(left.shift) - shiftOrder(right.shift);
      if (shiftCompare !== 0) return shiftCompare;
      return Number(left.id || 0) - Number(right.id || 0);
    });

  const trendRows = [];
  let rollingCumulative = 0;
  sortedLogs.forEach((item) => {
    const footage = toNumberOrNull(item.footage_m);
    const cumulative = toNumberOrNull(item.cumulative_footage_m);
    rollingCumulative =
      cumulative === null ? rollingCumulative + (footage || 0) : cumulative;

    trendRows.push({
      id: Number(item.id || 0),
      label: `${item.log_date || "-"} ${shiftLabel(item.shift)}`,
      logDate: item.log_date || "",
      shift: shiftLabel(item.shift),
      footageM: footage,
      cumulativeFootageM: round1(rollingCumulative),
      completedPipeCount: toNumberOrNull(item.completed_pipe_count),
      cumulativePipeCount: toNumberOrNull(item.cumulative_pipe_count),
      chamberPressureMpa: toNumberOrNull(item.chamber_pressure_mpa),
      cutterCurrentA: toNumberOrNull(item.cutter_current_a),
      cutterFrequencyHz: toNumberOrNull(item.cutter_frequency_hz),
      horizontalDeviationMm: signedDeviation(
        item.horizontal_deviation_direction || item.deviation_direction,
        item.horizontal_deviation_mm === null ||
          item.horizontal_deviation_mm === undefined
          ? item.deviation_value_mm
          : item.horizontal_deviation_mm,
      ),
      verticalDeviationMm: signedDeviation(
        item.vertical_deviation_direction,
        item.vertical_deviation_mm,
      ),
    });
  });

  const advancedM =
    trendRows.length > 0
      ? Math.max.apply(
          null,
          trendRows.map((item) => item.cumulativeFootageM),
        )
      : 0;
  const lengthM = Math.max(0, toNumberOrNull(sectionLengthM) || 0);
  const remainingM = Math.max(0, lengthM - advancedM);
  const progressPercent =
    lengthM > 0 ? Math.min(100, (advancedM / lengthM) * 100) : 0;
  const dailyFootage = buildDailyFootage(trendRows);
  const activeDays = dailyFootage.length;
  const averageDailyFootageM =
    activeDays > 0
      ? round1(
          dailyFootage.reduce((sum, item) => sum + item.footage, 0) /
            activeDays,
        )
      : null;
  const recentDailyRows = dailyFootage.slice(-3);
  const recentDailyFootageM =
    recentDailyRows.length > 0
      ? round1(
          recentDailyRows.reduce((sum, item) => sum + item.footage, 0) /
            recentDailyRows.length,
        )
      : null;
  const speedForEstimate = recentDailyFootageM || averageDailyFootageM || 0;
  const estimatedDaysRemaining =
    remainingM > 0 && speedForEstimate > 0
      ? Math.ceil(remainingM / speedForEstimate)
      : null;

  return {
    summary: {
      sectionLengthM: lengthM,
      advancedM: round1(advancedM),
      remainingM: round1(remainingM),
      progressPercent: round1(progressPercent),
      averageDailyFootageM,
      recentDailyFootageM,
      estimatedDaysRemaining,
      activeDays,
      logCount: trendRows.length,
      latestLogDate: trendRows.length
        ? trendRows[trendRows.length - 1].logDate
        : null,
    },
    trendRows,
    recentRows: trendRows.slice(-6).reverse(),
  };
};

module.exports = {
  buildSectionProgressInsight,
};
