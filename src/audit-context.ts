const MAX_AUDIT_STRING_LENGTH = 256;
const MAX_AUDIT_ARRAY_ITEMS = 50;

const USER_TARGET_TOOLS = new Set([
  'cipp_edit_user',
  'cipp_manage_user_licenses',
  'cipp_disable_user',
  'cipp_reset_password',
  'cipp_reset_mfa',
  'cipp_revoke_sessions',
  'cipp_offboard_user',
  'cipp_bec_check',
  'cipp_list_user_devices',
  'cipp_list_user_groups',
]);

const MAILBOX_TARGET_TOOLS = new Set([
  'cipp_list_mailbox_permissions',
  'cipp_set_out_of_office',
  'cipp_set_email_forwarding',
]);

const OFFBOARD_ACTIONS = [
  'ConvertToShared',
  'HideFromGAL',
  'removeCalendarInvites',
  'removePermissions',
  'removeCalendarPermissions',
  'RemoveRules',
  'RemoveMobile',
  'RemoveGroups',
  'RemoveLicenses',
  'RevokeSessions',
  'DisableSignIn',
  'ClearImmutableId',
  'ResetPass',
  'RemoveMFADevices',
  'RemoveTeamsPhoneDID',
  'DeleteUser',
  'DisableOneDriveSharing',
  'disableForwarding',
] as const;

export type AuditContext = Record<string, string | string[]>;

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = Array.from(value.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('');
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_AUDIT_STRING_LENGTH);
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .slice(0, MAX_AUDIT_ARRAY_ITEMS)
    .map(safeString)
    .filter((item): item is string => item !== undefined);
  return values.length > 0 ? values : undefined;
}

function setIfPresent(context: AuditContext, key: string, value: string | string[] | undefined) {
  if (value !== undefined) context[key] = value;
}

/**
 * Build a minimal, explicit audit summary for a tool invocation.
 *
 * This function never copies the raw argument object. Only fields selected
 * below can reach an audit log. Passwords, secrets, tokens, message bodies,
 * forwarding destinations, and arbitrary scheduled-task parameters are
 * intentionally absent.
 */
export function buildToolAuditContext(
  tool: string,
  args: Record<string, unknown>
): AuditContext {
  const context: AuditContext = {};
  setIfPresent(context, 'tenant', safeString(args.tenantFilter));

  if (USER_TARGET_TOOLS.has(tool)) {
    setIfPresent(context, 'targetUser', safeString(args.userId));
  }
  if (MAILBOX_TARGET_TOOLS.has(tool)) {
    setIfPresent(context, 'targetMailbox', safeString(args.upn));
  }

  switch (tool) {
    case 'cipp_list_users':
      setIfPresent(context, 'searchField', safeString(args.searchField));
      setIfPresent(context, 'targetUser', safeString(args.searchValue));
      break;
    case 'cipp_create_user':
      setIfPresent(context, 'targetUser', safeString(args.userPrincipalName));
      context.action = 'create';
      break;
    case 'cipp_edit_user': {
      const changedFields = ['displayName', 'jobTitle', 'department', 'usageLocation'].filter(
        (field) => args[field] !== undefined
      );
      if (changedFields.length > 0) context.changedFields = changedFields;
      context.action = 'edit';
      break;
    }
    case 'cipp_manage_user_licenses':
      setIfPresent(context, 'addedLicenseSkuIds', safeStringArray(args.addLicenseSkuIds));
      setIfPresent(context, 'removedLicenseSkuIds', safeStringArray(args.removeLicenseSkuIds));
      context.action = 'modify_licenses';
      break;
    case 'cipp_disable_user':
      context.action = 'disable';
      break;
    case 'cipp_reset_password':
      context.action = 'reset_password';
      break;
    case 'cipp_reset_mfa':
      context.action = 'reset_mfa';
      break;
    case 'cipp_revoke_sessions':
      context.action = 'revoke_sessions';
      break;
    case 'cipp_offboard_user': {
      const selectedActions: string[] = OFFBOARD_ACTIONS.filter(
        (action) => args[action] === true
      );
      if (safeString(args.forward)) selectedActions.push('SetForwarding');
      if (safeString(args.OOO)) selectedActions.push('SetOutOfOffice');
      if (safeStringArray(args.AccessNoAutomap)) selectedActions.push('GrantMailboxAccessNoAutomap');
      if (safeStringArray(args.AccessAutomap)) selectedActions.push('GrantMailboxAccessAutomap');
      if (safeStringArray(args.OnedriveAccess)) selectedActions.push('GrantOneDriveAccess');
      if (selectedActions.length > 0) context.selectedActions = selectedActions;
      context.action = 'offboard';
      break;
    }
    case 'cipp_list_groups':
      setIfPresent(context, 'targetGroup', safeString(args.search));
      break;
    case 'cipp_create_distribution_group':
      setIfPresent(context, 'targetGroup', safeString(args.displayName));
      setIfPresent(context, 'groupAddress', safeString(args.primaryEmailAddress));
      context.action = 'create';
      break;
    case 'cipp_modify_distribution_group_member':
      setIfPresent(context, 'targetGroup', safeString(args.groupId));
      setIfPresent(context, 'member', safeString(args.memberUserPrincipalName));
      setIfPresent(context, 'action', safeString(args.action));
      break;
    case 'cipp_set_out_of_office':
      setIfPresent(context, 'action', safeString(args.state));
      break;
    case 'cipp_set_email_forwarding':
      context.action = safeString(args.forwardTo) ? 'enable_or_change' : 'disable';
      break;
    case 'cipp_delete_standard_template':
      setIfPresent(context, 'targetTemplate', safeString(args.templateId));
      context.action = 'delete';
      break;
    case 'cipp_create_standard_template': {
      const template =
        typeof args.template === 'object' && args.template !== null && !Array.isArray(args.template)
          ? (args.template as Record<string, unknown>)
          : undefined;
      setIfPresent(
        context,
        'targetTemplate',
        safeString(template?.name) ?? safeString(template?.displayName)
      );
      context.action = 'create';
      break;
    }
    case 'cipp_add_scheduled_item':
      setIfPresent(context, 'targetTask', safeString(args.taskName));
      context.action = 'schedule';
      break;
    default:
      break;
  }

  return context;
}
