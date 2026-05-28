const asText = (value) => String(value || "").trim();

const buildProjectSectionLabel = (item) => {
  const projectName = asText(item && (item.project_name || item.project_code)) || "未知项目";
  const sectionName = asText(item && (item.section_name || item.section_code)) || "项目级";
  return `${projectName}-${sectionName}`;
};

module.exports = {
  buildProjectSectionLabel
};
