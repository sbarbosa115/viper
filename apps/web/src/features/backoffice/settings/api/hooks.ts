import {
  getSettings,
  settingsSections,
  testSettings,
  type PlatformSettings,
  type SettingsSection,
} from '@app/contracts/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

export const settingsQueryKey = ['staff', 'settings'] as const;

/** FR-8: every section as GET returns it, secrets masked. */
export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => api('/staff/settings', { schema: getSettings.response }),
    retry: false,
  });
}

/** One section save (PUT /api/staff/settings/:section); the cache takes the masked response. */
export function useSaveSection(section: SettingsSection) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      settingsSections[section].parse(
        await api<unknown>(`/staff/settings/${section}`, { method: 'PUT', body }),
      ),
    onSuccess: (saved) => {
      client.setQueryData<PlatformSettings>(settingsQueryKey, (old) =>
        old ? { ...old, [section]: saved } : old,
      );
    },
  });
}

export function useTestSetting() {
  return useMutation({
    mutationFn: (body: { target: string; to?: string }) =>
      api('/staff/settings/test', { method: 'POST', body, schema: testSettings.response }),
  });
}
