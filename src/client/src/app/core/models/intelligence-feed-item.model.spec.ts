import { describe, expect, it } from 'vitest';
import {
  isEventItem,
  type BriefFeedItem,
  type EventFeedItem,
} from './intelligence-feed-item.model';

describe('isEventItem', () => {
  it('narrows event rows', () => {
    const e = { kind: 'event', id: '1', category_name: 'Clinical' } as EventFeedItem;
    expect(isEventItem(e)).toBe(true);
    if (isEventItem(e)) expect(e.category_name).toBe('Clinical');
  });

  it('rejects brief rows', () => {
    const b = { kind: 'brief', id: '2' } as BriefFeedItem;
    expect(isEventItem(b)).toBe(false);
  });
});
