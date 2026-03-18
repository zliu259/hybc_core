const asDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatBeijingDateTime = (
  value: string | null | undefined
): string => {
  const d = asDate(value);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(item => [item.type, item.value]));
  const year = map.year ?? "0000";
  const month = map.month ?? "00";
  const day = map.day ?? "00";
  const hour = map.hour ?? "00";
  const minute = map.minute ?? "00";
  const second = map.second ?? "00";
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};
