import { buildToolAuditContext } from '../src/audit-context.js';

describe('tool audit context', () => {
  it('records tenant, user target, and action for account disablement', () => {
    expect(
      buildToolAuditContext('cipp_disable_user', {
        tenantFilter: 'contoso.com',
        userId: 'alice@contoso.com',
      })
    ).toEqual({
      tenant: 'contoso.com',
      targetUser: 'alice@contoso.com',
      action: 'disable',
    });
  });

  it('records group and member targets for membership changes', () => {
    expect(
      buildToolAuditContext('cipp_modify_distribution_group_member', {
        tenantFilter: 'contoso.com',
        groupId: 'sales@contoso.com',
        memberUserPrincipalName: 'alice@contoso.com',
        action: 'add',
      })
    ).toEqual({
      tenant: 'contoso.com',
      targetGroup: 'sales@contoso.com',
      member: 'alice@contoso.com',
      action: 'add',
    });
  });

  it('records license SKU changes without copying unrelated arguments', () => {
    const context = buildToolAuditContext('cipp_manage_user_licenses', {
      tenantFilter: 'contoso.com',
      userId: 'alice@contoso.com',
      addLicenseSkuIds: ['sku-one'],
      removeLicenseSkuIds: ['sku-two'],
      password: 'NeverLogThis1!',
    });

    expect(context).toEqual({
      tenant: 'contoso.com',
      targetUser: 'alice@contoso.com',
      addedLicenseSkuIds: ['sku-one'],
      removedLicenseSkuIds: ['sku-two'],
      action: 'modify_licenses',
    });
    expect(JSON.stringify(context)).not.toContain('NeverLogThis1!');
  });

  it('records selected offboarding action names but not sensitive values', () => {
    const context = buildToolAuditContext('cipp_offboard_user', {
      tenantFilter: 'contoso.com',
      userId: 'alice@contoso.com',
      DisableSignIn: true,
      ResetPass: true,
      forward: 'manager@contoso.com',
      OOO: 'Private auto-reply body',
      AccessAutomap: ['manager@contoso.com'],
      password: 'NeverLogThis2!',
      clientSecret: 'NeverLogThis3!',
    });

    expect(context).toEqual({
      tenant: 'contoso.com',
      targetUser: 'alice@contoso.com',
      selectedActions: [
        'DisableSignIn',
        'ResetPass',
        'SetForwarding',
        'SetOutOfOffice',
        'GrantMailboxAccessAutomap',
      ],
      action: 'offboard',
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('manager@contoso.com');
    expect(serialized).not.toContain('Private auto-reply body');
    expect(serialized).not.toContain('NeverLogThis');
  });

  it('logs a forwarding state but not the forwarding destination', () => {
    expect(
      buildToolAuditContext('cipp_set_email_forwarding', {
        tenantFilter: 'contoso.com',
        upn: 'alice@contoso.com',
        forwardTo: 'external@example.net',
        keepCopy: true,
      })
    ).toEqual({
      tenant: 'contoso.com',
      targetMailbox: 'alice@contoso.com',
      action: 'enable_or_change',
    });
  });

  it('records an exact user lookup target but never returned data', () => {
    expect(
      buildToolAuditContext('cipp_list_users', {
        tenantFilter: 'contoso.com',
        searchField: 'userPrincipalName',
        searchValue: 'alice@contoso.com',
        fields: ['userPrincipalName', 'LicJoined'],
        returnedUsers: [{ password: 'NeverLogThis4!' }],
      })
    ).toEqual({
      tenant: 'contoso.com',
      searchField: 'userPrincipalName',
      targetUser: 'alice@contoso.com',
    });
  });
});
