export type ProjectSectionProgressLog = {
  id: number;
  log_date: string;
  shift?: string | null;
  footage_m?: number | null;
  cumulative_footage_m?: number | null;
  completed_pipe_count?: number | null;
  cumulative_pipe_count?: number | null;
  chamber_pressure_mpa?: number | null;
  cutter_current_a?: number | null;
  cutter_frequency_hz?: number | null;
  horizontal_deviation_direction?: string | null;
  horizontal_deviation_mm?: number | null;
  vertical_deviation_direction?: string | null;
  vertical_deviation_mm?: number | null;
  deviation_direction?: string | null;
  deviation_value_mm?: number | null;
};

export type SectionTrendRow = {
  id: number;
  label: string;
  logDate: string;
  shift: string;
  footageM: number | null;
  cumulativeFootageM: number;
  completedPipeCount: number | null;
  cumulativePipeCount: number | null;
  chamberPressureMpa: number | null;
  cutterCurrentA: number | null;
  cutterFrequencyHz: number | null;
  horizontalDeviationMm: number | null;
  verticalDeviationMm: number | null;
};

export type SectionProgressInsight = {
  summary: {
    sectionLengthM: number;
    advancedM: number;
    remainingM: number;
    progressPercent: number;
    averageDailyFootageM: number | null;
    recentDailyFootageM: number | null;
    estimatedDaysRemaining: number | null;
    activeDays: number;
    logCount: number;
    latestLogDate: string | null;
  };
  trendRows: SectionTrendRow[];
  recentRows: SectionTrendRow[];
};

const shiftOrder = (shift: string | null | undefined): number => {
  if (shift === "day") return 1;
  if (shift === "night") return 2;
  return 3;
};

const shiftLabel = (shift: string | null | undefined): string => {
  if (shift === "day") return "白班";
  if (shift === "night") return "夜班";
  return shift || "-";
};

const toNumberOrNull = (value: number | null | undefined): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const signedDeviation = (
  direction: string | null | undefined,
  value: number | null | undefined
): number | null => {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return null;
  if (direction === "left" || direction === "low") return -Math.abs(numeric);
  if (direction === "right" || direction === "high") return Math.abs(numeric);
  return numeric;
};

const round1 = (value: number): number => Number(value.toFixed(1));

const buildDailyFootage = (
  rows: SectionTrendRow[]
): Array<{ date: string; footage: number }> => {
  const daily = new Map<string, number>();
  for (const row of rows) {
    const footage = row.footageM ?? 0;
    if (footage <= 0) continue;
    daily.set(row.logDate, (daily.get(row.logDate) ?? 0) + footage);
  }
  return [...daily.entries()]
    .map(([date, footage]) => ({ date, footage }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

export const buildSectionProgressInsight = (
  sectionLengthM: number | null | undefined,
  logs: ProjectSectionProgressLog[]
): SectionProgressInsight => {
  const sortedLogs = [...logs].sort((left, right) => {
    const dateCompare = left.log_date.localeCompare(right.log_date);
    if (dateCompare !== 0) return dateCompare;
    const shiftCompare = shiftOrder(left.shift) - shiftOrder(right.shift);
    if (shiftCompare !== 0) return shiftCompare;
    return left.id - right.id;
  });

  const trendRows: SectionTrendRow[] = [];
  let rollingCumulative = 0;
  for (const item of sortedLogs) {
    const footage = toNumberOrNull(item.footage_m);
    const cumulative = toNumberOrNull(item.cumulative_footage_m);
    rollingCumulative = cumulative ?? rollingCumulative + (footage ?? 0);

    trendRows.push({
      id: item.id,
      label: `${item.log_date} ${shiftLabel(item.shift)}`,
      logDate: item.log_date,
      shift: shiftLabel(item.shift),
      footageM: footage,
      cumulativeFootageM: round1(rollingCumulative),
      completedPipeCount: toNumberOrNull(item.completed_pipe_count),
      cumulativePipeCount: toNumberOrNull(item.cumulative_pipe_count),
      chamberPressureMpa: toNumberOrNull(item.chamber_pressure_mpa),
      cutterCurrentA: toNumberOrNull(item.cutter_current_a),
      cutterFrequencyHz: toNumberOrNull(item.cutter_frequency_hz),
      horizontalDeviationMm: signedDeviation(
        item.horizontal_deviation_direction ?? item.deviation_direction,
        item.horizontal_deviation_mm ?? item.deviation_value_mm
      ),
      verticalDeviationMm: signedDeviation(
        item.vertical_deviation_direction,
        item.vertical_deviation_mm
      )
    });
  }

  const advancedM =
    trendRows.length > 0
      ? Math.max(...trendRows.map(item => item.cumulativeFootageM))
      : 0;
  const lengthM = Math.max(0, sectionLengthM ?? 0);
  const remainingM = Math.max(0, lengthM - advancedM);
  const progressPercent =
    lengthM > 0 ? Math.min(100, (advancedM / lengthM) * 100) : 0;
  const dailyFootage = buildDailyFootage(trendRows);
  const activeDays = dailyFootage.length;
  const averageDailyFootageM =
    activeDays > 0
      ? round1(
          dailyFootage.reduce((sum, item) => sum + item.footage, 0) / activeDays
        )
      : null;
  const recentDailyRows = dailyFootage.slice(-3);
  const recentDailyFootageM =
    recentDailyRows.length > 0
      ? round1(
          recentDailyRows.reduce((sum, item) => sum + item.footage, 0) /
            recentDailyRows.length
        )
      : null;
  const speedForEstimate = recentDailyFootageM ?? averageDailyFootageM ?? 0;
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
      latestLogDate: trendRows.at(-1)?.logDate ?? null
    },
    trendRows,
    recentRows: trendRows.slice(-8).reverse()
  };
};
