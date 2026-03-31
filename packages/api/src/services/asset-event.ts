export interface AssetEventWriteInput {
  tracked_asset_id: number;
  event_type: string;
  event_time: string;
  operator_userid: string;
  project_id?: number | null;
  warehouse_id?: number | null;
  detail?: string | null;
}

export interface ConfigurationParticipant {
  tracked_asset_id: number;
  role: "shell" | "core" | "console";
}

export const collectConfigurationParticipants = (payload: {
  shell_asset_id?: number | null;
  core_asset_id?: number | null;
  console_asset_id?: number | null;
}): ConfigurationParticipant[] => {
  const participants: ConfigurationParticipant[] = [];
  if (payload.shell_asset_id) {
    participants.push({ tracked_asset_id: payload.shell_asset_id, role: "shell" });
  }
  if (payload.core_asset_id) {
    participants.push({ tracked_asset_id: payload.core_asset_id, role: "core" });
  }
  if (payload.console_asset_id) {
    participants.push({ tracked_asset_id: payload.console_asset_id, role: "console" });
  }

  const deduped = new Map<number, ConfigurationParticipant>();
  for (const participant of participants) {
    if (!deduped.has(participant.tracked_asset_id)) {
      deduped.set(participant.tracked_asset_id, participant);
    }
  }
  return [...deduped.values()];
};

export const getConfigurationParticipants = async (
  db: D1Database,
  configurationId: number
): Promise<ConfigurationParticipant[]> => {
  const row = await db.prepare(
    `SELECT shell_asset_id, core_asset_id, console_asset_id
     FROM tracked_asset_configuration WHERE id = ?`
  )
    .bind(configurationId)
    .first<{
      shell_asset_id: number | null;
      core_asset_id: number | null;
      console_asset_id: number | null;
    }>();

  if (!row) return [];
  return collectConfigurationParticipants(row);
};

export const emitTrackedAssetEvents = async (
  db: D1Database,
  events: AssetEventWriteInput[]
): Promise<void> => {
  for (const event of events) {
    await db.prepare(
      `INSERT INTO tracked_asset_event
        (tracked_asset_id, event_type, event_time, operator_userid, project_id, warehouse_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        event.tracked_asset_id,
        event.event_type,
        event.event_time,
        event.operator_userid,
        event.project_id ?? null,
        event.warehouse_id ?? null,
        event.detail ?? null,
        event.event_time
      )
      .run();
  }
};
