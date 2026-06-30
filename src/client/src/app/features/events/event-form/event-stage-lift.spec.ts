import { describe, it, expect } from 'vitest';

import {
  APPROVAL_EVENT_TYPE_ID,
  LAUNCH_EVENT_TYPE_ID,
  assetApprovalUnreflected,
  eventTypeLiftsStatus,
  shouldWarnMissingIndication,
} from './event-stage-lift';

describe('eventTypeLiftsStatus', () => {
  it('prefers the lifts_development_status column when present', () => {
    expect(eventTypeLiftsStatus({ id: 'whatever', lifts_development_status: 'APPROVED' })).toBe(true);
    expect(eventTypeLiftsStatus({ id: 'whatever', lifts_development_status: 'LAUNCHED' })).toBe(true);
    expect(eventTypeLiftsStatus({ id: 'whatever', lifts_development_status: null })).toBe(false);
  });

  it('falls back to the two system ids when the column is absent', () => {
    expect(eventTypeLiftsStatus({ id: APPROVAL_EVENT_TYPE_ID })).toBe(true);
    expect(eventTypeLiftsStatus({ id: LAUNCH_EVENT_TYPE_ID })).toBe(true);
    expect(eventTypeLiftsStatus({ id: 'a0000000-0000-0000-0000-000000000099' })).toBe(false);
  });

  it('is false for null / undefined / a non-lifting type', () => {
    expect(eventTypeLiftsStatus(null)).toBe(false);
    expect(eventTypeLiftsStatus(undefined)).toBe(false);
    expect(eventTypeLiftsStatus({ id: 'topline', lifts_development_status: null })).toBe(false);
  });
});

describe('shouldWarnMissingIndication', () => {
  it('warns only when a lifting type has no indication mapped', () => {
    expect(shouldWarnMissingIndication({ lifts: true, indicationId: null })).toBe(true);
    expect(shouldWarnMissingIndication({ lifts: true, indicationId: 'ind-1' })).toBe(false);
    expect(shouldWarnMissingIndication({ lifts: false, indicationId: null })).toBe(false);
    expect(shouldWarnMissingIndication({ lifts: false, indicationId: 'ind-1' })).toBe(false);
  });
});

describe('assetApprovalUnreflected', () => {
  const approval = { id: APPROVAL_EVENT_TYPE_ID, projection: 'actual', no_longer_expected: false };

  it('flags an actual approval when no indication reached APPROVED/LAUNCHED', () => {
    expect(assetApprovalUnreflected({ statuses: ['P3'], events: [approval] })).toBe(true);
    expect(assetApprovalUnreflected({ statuses: ['PRECLIN', 'P2'], events: [approval] })).toBe(true);
    expect(assetApprovalUnreflected({ statuses: [null], events: [approval] })).toBe(true);
    expect(assetApprovalUnreflected({ statuses: [], events: [approval] })).toBe(true);
  });

  it('does not flag when an indication is already APPROVED or LAUNCHED', () => {
    expect(assetApprovalUnreflected({ statuses: ['APPROVED'], events: [approval] })).toBe(false);
    expect(assetApprovalUnreflected({ statuses: ['P3', 'LAUNCHED'], events: [approval] })).toBe(false);
  });

  it('does not flag without an actual, still-expected lifting event', () => {
    // no lifting event at all
    expect(
      assetApprovalUnreflected({
        statuses: ['P3'],
        events: [{ id: 'topline', projection: 'actual', no_longer_expected: false }],
      }),
    ).toBe(false);
    // approval is forecasted, not actual
    expect(
      assetApprovalUnreflected({
        statuses: ['P3'],
        events: [{ ...approval, projection: 'forecasted' }],
      }),
    ).toBe(false);
    // approval was marked no-longer-expected
    expect(
      assetApprovalUnreflected({
        statuses: ['P3'],
        events: [{ ...approval, no_longer_expected: true }],
      }),
    ).toBe(false);
    expect(assetApprovalUnreflected({ statuses: ['P3'], events: [] })).toBe(false);
  });

  it('detects the lift type via the column too (launch by status column)', () => {
    expect(
      assetApprovalUnreflected({
        statuses: ['P3'],
        events: [{ lifts_development_status: 'LAUNCHED', projection: 'actual', no_longer_expected: false }],
      }),
    ).toBe(true);
  });
});
