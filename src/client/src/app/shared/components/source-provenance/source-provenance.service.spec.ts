/**
 * Unit tests for SourceProvenanceService.
 *
 * The service uses inject(SupabaseService) at field-initializer time, so it is
 * constructed inside an Angular injection context. The units runner is a plain
 * node environment (vitest.units.config.ts), so we skip TestBed and build a
 * minimal Injector with a stub SupabaseService whose .client.rpc is vi-tracked.
 * Mirrors src/app/core/services/space.service.spec.ts.
 */
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { SourceProvenanceService } from './source-provenance.service';
import { SupabaseService } from '../../../core/services/supabase.service';

/** rpc() returns a thenable resolving to { data, error }; the service awaits it. */
function rpcResult(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

interface ClientStub {
  rpc: ReturnType<typeof vi.fn>;
}

function makeService(client: ClientStub): SourceProvenanceService {
  const supabaseStub = { client } as unknown as SupabaseService;
  const injector = Injector.create({
    providers: [{ provide: SupabaseService, useValue: supabaseStub }],
  });
  return runInInjectionContext(injector, () => new SourceProvenanceService());
}

describe('SourceProvenanceService.getSourceDocument', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let service: SourceProvenanceService;

  beforeEach(() => {
    rpc = vi.fn();
    service = makeService({ rpc });
  });

  it('calls get_source_document with p_source_doc_id', async () => {
    rpc.mockReturnValueOnce(rpcResult({ source_doc_id: 'doc-1' }));
    await service.getSourceDocument('doc-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_source_document', { p_source_doc_id: 'doc-1' });
  });

  it('returns the provenance payload on success', async () => {
    const payload = { source_doc_id: 'doc-1', source_title: 'Press release' };
    rpc.mockReturnValueOnce(rpcResult(payload));
    const result = await service.getSourceDocument('doc-1');
    expect(result).toEqual(payload);
  });

  it('returns null when the RPC yields null (unknown source document)', async () => {
    rpc.mockReturnValueOnce(rpcResult(null));
    const result = await service.getSourceDocument('missing');
    expect(result).toBeNull();
  });

  it('throws when the RPC returns an error (e.g. 42501 for a viewer)', async () => {
    rpc.mockReturnValueOnce(rpcResult(null, { code: '42501', message: 'forbidden' }));
    await expect(service.getSourceDocument('doc-1')).rejects.toMatchObject({ code: '42501' });
  });
});
