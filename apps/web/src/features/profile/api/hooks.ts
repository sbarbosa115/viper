import {
  createProduct,
  getProfile,
  product,
  updateProfile,
  type ProfileInput,
  type ProductInput,
} from '@app/contracts/profile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';

/** One cache entry for the Business Profile, shared with the assistant and plans features. */
export const profileKey = ['profile'] as const;

export function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => api('/profile', { schema: getProfile.response }),
    retry: false,
  });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileInput) =>
      api('/profile', { method: 'PUT', body, schema: updateProfile.response }),
    onSuccess: (profile) => client.setQueryData(profileKey, profile),
  });
}

export function useSaveProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ProductInput }) =>
      id
        ? api(`/profile/products/${id}`, { method: 'PUT', body: input, schema: product })
        : api('/profile/products', { method: 'POST', body: input, schema: createProduct.response }),
    onSuccess: () => client.invalidateQueries({ queryKey: profileKey }),
  });
}

export function useDeleteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/profile/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: profileKey }),
  });
}
