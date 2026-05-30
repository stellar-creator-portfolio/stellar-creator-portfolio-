/**
 * Static tests for the persisted auth store.
 *
 * AsyncStorage is mocked (see jest.setup.js) so persistence is exercised
 * without a device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEY, useAuthStore } from '../store/authStore';
import type { User } from '../store/types';

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const sampleUser: User = { id: 'u1', email: 'u1@example.com', displayName: 'U1' };

beforeEach(async () => {
  await AsyncStorage.clear();
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isHydrated: false,
  });
  jest.clearAllMocks();
});

describe('authStore', () => {
  it('setUser sets user, token, and isAuthenticated', () => {
    useAuthStore.getState().setUser(sampleUser, 'token-123');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(sampleUser);
    expect(state.token).toBe('token-123');
    expect(state.isAuthenticated).toBe(true);
  });

  it('clearAuth resets user, token, and isAuthenticated', () => {
    useAuthStore.getState().setUser(sampleUser, 'token-123');
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('transitions isHydrated from false to true after rehydrate', async () => {
    useAuthStore.setState({ isHydrated: false });
    expect(useAuthStore.getState().isHydrated).toBe(false);

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().isHydrated).toBe(true);
  });

  it('persists to AsyncStorage when setUser is called', async () => {
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    useAuthStore.getState().setUser(sampleUser, 'token-123');
    await flushPromises();

    expect(setItemSpy).toHaveBeenCalledWith(
      AUTH_STORAGE_KEY,
      expect.any(String),
    );
    const [, persisted] = setItemSpy.mock.calls[0];
    expect(persisted).toContain('token-123');
  });

  it('does not persist the transient isHydrated flag', async () => {
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    useAuthStore.getState().setUser(sampleUser, 'token-123');
    await flushPromises();

    const [, persisted] = setItemSpy.mock.calls[0];
    expect(persisted).not.toContain('isHydrated');
  });
});
