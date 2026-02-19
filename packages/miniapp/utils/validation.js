const required = (value, label) => {
  if (value === undefined || value === null) return `${label}不能为空`;
  if (typeof value === "string" && !value.trim()) return `${label}不能为空`;
  return "";
};

const positiveNumber = (value, label) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return `${label}需为大于0的数字`;
  }
  return "";
};

const ymdDate = (value, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return `${label}格式应为YYYY-MM-DD`;
  }
  return "";
};

const firstError = (rules) => {
  for (const rule of rules) {
    if (rule) return rule;
  }
  return "";
};

module.exports = {
  required,
  positiveNumber,
  ymdDate,
  firstError
};
