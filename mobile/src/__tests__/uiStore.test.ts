/**
 * Static tests for the in-memory UI store.
 */
import { useUIStore } from '../store/uiStore';

beforeEach(() => {
  useUIStore.setState({ isLoading: false, toastMessage: null });
});

describe('uiStore', () => {
  it('setLoading toggles isLoading', () => {
    useUIStore.getState().setLoading(true);
    expect(useUIStore.getState().isLoading).toBe(true);

    useUIStore.getState().setLoading(false);
    expect(useUIStore.getState().isLoading).toBe(false);
  });

  it('showToast sets the toast message', () => {
    useUIStore.getState().showToast('Saved!');
    expect(useUIStore.getState().toastMessage).toBe('Saved!');
  });

  it('clearToast clears the toast message', () => {
    useUIStore.getState().showToast('Saved!');
    useUIStore.getState().clearToast();
    expect(useUIStore.getState().toastMessage).toBeNull();
  });
});
