const { request } = require("../../../utils/request");
const { wxGetLocation } = require("../../../utils/wx");

const getNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const pickCoordinates = (project) => {
  if (!project) return null;
  let lat = getNumber(project.latitude);
  if (lat === null) lat = getNumber(project.lat);
  if (lat === null) lat = getNumber(project.location_lat);
  if (lat === null) lat = getNumber(project.locationLatitude);

  let lng = getNumber(project.longitude);
  if (lng === null) lng = getNumber(project.lng);
  if (lng === null) lng = getNumber(project.location_lng);
  if (lng === null) lng = getNumber(project.locationLongitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
};

const distanceMeters = (aLat, aLng, bLat, bLng) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

Component({
  properties: {
    value: {
      type: Number,
      value: 0
    },
    label: {
      type: String,
      value: "所属项目"
    }
  },

  data: {
    loading: false,
    projects: [],
    projectNames: [],
    selectedIndex: 0,
    autoHint: ""
  },

  lifetimes: {
    attached() {
      this.loadProjects();
    }
  },

  observers: {
    value(newValue) {
      this.syncSelectedIndex(newValue);
    }
  },

  methods: {
    syncSelectedIndex(value) {
      const id = Number(value || 0);
      const list = this.data.projects || [];
      const index = list.findIndex((item) => Number(item.id) === id);
      if (index >= 0) {
        this.setData({ selectedIndex: index });
      }
    },

    emitChange(project) {
      this.triggerEvent("change", {
        projectId: Number(project.id),
        projectName: project.project_name,
        project
      });
    },

    loadProjects() {
      if (this.data.loading) return;
      this.setData({ loading: true, autoHint: "" });
      request({ method: "GET", path: "/api/v1/project?page=1&pageSize=200&status=active" })
        .then((res) => {
          const projects = (res && res.data) || [];
          const names = projects.map((item) => item.project_name || `项目#${item.id}`);
          this.setData({
            projects,
            projectNames: names,
            selectedIndex: 0
          });

          if (!projects.length) return;

          const current = Number(this.properties.value || 0);
          const currentProject = projects.find((item) => Number(item.id) === current);
          if (currentProject) {
            this.syncSelectedIndex(current);
            return;
          }

          this.emitChange(projects[0]);
        })
        .catch((error) => {
          wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
        })
        .finally(() => {
          this.setData({ loading: false });
        });
    },

    onPickerChange(e) {
      const index = Number(e.detail.value || 0);
      const project = this.data.projects[index];
      if (!project) return;
      this.setData({ selectedIndex: index, autoHint: "" });
      this.emitChange(project);
    },

    autoSelectByGps() {
      if (this.data.loading) return;
      if (!this.data.projects.length) {
        wx.showToast({ title: "暂无可选项目", icon: "none" });
        return;
      }

      this.setData({ loading: true, autoHint: "定位中..." });
      wxGetLocation()
        .then((loc) => {
          const withCoords = this.data.projects
            .map((project) => {
              const coords = pickCoordinates(project);
              if (!coords) return null;
              return {
                project,
                distance: distanceMeters(loc.latitude, loc.longitude, coords.lat, coords.lng)
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.distance - b.distance);

          if (!withCoords.length) {
            this.setData({ autoHint: "项目未配置坐标，已保留当前选择" });
            return;
          }

          const nearest = withCoords[0].project;
          const index = this.data.projects.findIndex((item) => Number(item.id) === Number(nearest.id));
          if (index < 0) return;
          this.setData({
            selectedIndex: index,
            autoHint: `已按定位匹配：${nearest.project_name}`
          });
          this.emitChange(nearest);
        })
        .catch(() => {
          this.setData({ autoHint: "定位失败，请手动选择项目" });
        })
        .finally(() => {
          this.setData({ loading: false });
        });
    }
  }
});
