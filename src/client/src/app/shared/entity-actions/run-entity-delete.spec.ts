import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEntityDelete } from './run-entity-delete';

vi.mock('../utils/confirm-delete', () => ({ confirmDelete: vi.fn() }));
import { confirmDelete } from '../utils/confirm-delete';

const mockConfirm = confirmDelete as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

function deps() {
  return {
    confirmation: {} as never,
    messageService: { add: vi.fn() } as never,
  };
}

describe('runEntityDelete', () => {
  it('previews, confirms, deletes, toasts and calls onSuccess', async () => {
    mockConfirm.mockResolvedValue(true);
    const preview = vi.fn().mockResolvedValue({ trials: 2 });
    const del = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const d = deps();

    await runEntityDelete({
      ...d,
      confirm: { header: 'Delete company', entityLabel: 'Acme', requireTypedConfirmation: true },
      preview,
      delete: del,
      successSummary: 'Company deleted.',
      onSuccess,
    });

    expect(preview).toHaveBeenCalledOnce();
    expect(mockConfirm.mock.calls[0][1].counts).toEqual({ trials: 2 });
    expect(del).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect((d.messageService as { add: ReturnType<typeof vi.fn> }).add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Company deleted.' })
    );
  });

  it('aborts when the user cancels: no delete, no onSuccess', async () => {
    mockConfirm.mockResolvedValue(false);
    const del = vi.fn();
    const onSuccess = vi.fn();
    await runEntityDelete({
      ...deps(),
      confirm: { header: 'Delete event', typedConfirmationValue: 'delete' },
      delete: del,
      successSummary: 'Event deleted.',
      onSuccess,
    });
    expect(del).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('surfaces an error toast and does not call onSuccess on delete failure', async () => {
    mockConfirm.mockResolvedValue(true);
    const del = vi.fn().mockRejectedValue(new Error('boom'));
    const onSuccess = vi.fn();
    const d = deps();
    await runEntityDelete({
      ...d,
      confirm: { header: 'Delete trial', typedConfirmationValue: 'delete' },
      delete: del,
      successSummary: 'Trial deleted.',
      onSuccess,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect((d.messageService as { add: ReturnType<typeof vi.fn> }).add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'boom' })
    );
  });

  it('aborts with an error toast when the preview fails', async () => {
    mockConfirm.mockResolvedValue(true);
    const preview = vi.fn().mockRejectedValue(new Error('rls'));
    const del = vi.fn();
    const onSuccess = vi.fn();
    const d = deps();
    await runEntityDelete({
      ...d,
      confirm: { header: 'Delete asset', entityLabel: 'X', requireTypedConfirmation: true },
      preview,
      delete: del,
      successSummary: 'Asset deleted.',
      onSuccess,
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect((d.messageService as { add: ReturnType<typeof vi.fn> }).add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' })
    );
  });
});
