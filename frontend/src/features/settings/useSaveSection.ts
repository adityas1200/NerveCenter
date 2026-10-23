import { connectorKeys } from "@/api/connectors";
import { settingsApi, settingsKeys, type SettingsSection } from "@/api/settings";
import { useAction } from "@/lib/useAction";

/** True when a section draft differs from what operations.yaml holds; Save stays disabled otherwise. */
export function isDirty(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Save one section of operations.yaml (optionally a second one after it) and refresh everything that reads it. */
export function useSaveSection({ successMessage = "Settings saved" }: { successMessage?: string } = {}) {
  return useAction({
    mutationFn: async (input: { section: SettingsSection; value: unknown; then?: { section: SettingsSection; value: unknown } }) => { await settingsApi.update(input.section, input.value); if (input.then) await settingsApi.update(input.then.section, input.then.value); },
    invalidate: [settingsKeys.all, connectorKeys.all],
    success: successMessage,
    error: "Settings not saved",
  });
}
