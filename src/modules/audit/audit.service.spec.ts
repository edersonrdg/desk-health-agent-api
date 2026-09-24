import { EntityManager } from 'typeorm';
import { AuditEventEntity } from './audit-event.entity';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const service = new AuditService();

  it('saves through the given manager, defaulting optional fields to null', async () => {
    const create = jest.fn((_entity: unknown, value: object) => value);
    const save = jest.fn().mockResolvedValue(undefined);
    const manager = { create, save } as unknown as EntityManager;

    await service.record(manager, {
      tenantId: 't1',
      actorType: 'system',
      action: 'inbox_message.received',
      entityType: 'inbox_message',
      entityId: 'e1',
      after: { event_type: 'text' },
      traceId: 'tr1',
    });

    const expected = {
      tenantId: 't1',
      actorType: 'system',
      actorId: null,
      action: 'inbox_message.received',
      entityType: 'inbox_message',
      entityId: 'e1',
      before: null,
      after: { event_type: 'text' },
      modelVersion: null,
      promptVersion: null,
      traceId: 'tr1',
    };
    expect(create).toHaveBeenCalledWith(AuditEventEntity, expected);
    expect(save).toHaveBeenCalledWith(expected);
  });

  it('exposes no update or delete', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype);

    expect(methods.sort()).toEqual(['constructor', 'record']);
  });
});
