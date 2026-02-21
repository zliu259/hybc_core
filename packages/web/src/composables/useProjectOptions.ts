import { ref } from "vue";
import { listProjects, type Project } from "@/api/project";

const byProjectTimeDesc = (a: Project, b: Project) => {
  const aTime = Date.parse(a.updated_at || a.created_at || "") || 0;
  const bTime = Date.parse(b.updated_at || b.created_at || "") || 0;
  if (bTime !== aTime) return bTime - aTime;
  return b.id - a.id;
};

export function useProjectOptions() {
  const projects = ref<Project[]>([]);

  const loadProjects = async (pageSize = 500) => {
    const result = await listProjects({ page: 1, pageSize });
    projects.value = [...result.data].sort(byProjectTimeDesc);
  };

  return {
    projects,
    loadProjects
  };
}
