// CIPP Tool Handler
// Dispatches MCP tool calls to the correct CippService method.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { CippService, OutOfOfficeInput } from '../services/cipp.service.js';
import { Logger } from '../utils/logger.js';
import { TOOL_DEFINITIONS } from '../mcp/tool.definitions.js';
import { DEFAULT_ENABLED_TOOLS } from '../utils/config.js';

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const SENSITIVE_KEY = /(password|secret|token|authorization|api[-_]?key|credential)/i;

export function redactSensitiveValues(
  value: unknown,
  key = '',
  seen = new WeakSet<object>()
): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item, key, seen));
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[Circular Reference]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactSensitiveValues(childValue, childKey, seen),
      ])
    );
  }
  return value;
}

export class CippToolHandler {
  private cippService: CippService;
  private logger: Logger;
  private mcpServer: Server | null = null;
  private enabledTools: Set<string>;

  constructor(
    cippService: CippService,
    logger: Logger,
    enabledTools: readonly string[] = DEFAULT_ENABLED_TOOLS
  ) {
    this.cippService = cippService;
    this.logger = logger;
    this.enabledTools = new Set(enabledTools);
  }

  setServer(server: Server): void {
    this.mcpServer = server;
  }

  getServer(): Server | null {
    return this.mcpServer;
  }

  getToolDefinitions() {
    return TOOL_DEFINITIONS.filter((tool) => this.enabledTools.has(tool.name));
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.enabledTools.has(name)) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Tool is disabled by the server-side allowlist: ${name}`
      );
    }

    this.logger.debug(`Dispatching tool call: ${name}`, {
      args: redactSensitiveValues(args),
    });

    try {
      let result: unknown;

      switch (name) {
        // -----------------------------------------------------------------------
        // Tenants
        // -----------------------------------------------------------------------
        case 'cipp_list_tenants': {
          const { allTenants } = args as { allTenants?: boolean };
          result = await this.cippService.listTenants({ allTenants });
          break;
        }

        case 'cipp_get_tenant_details': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.getTenantDetails(tenantFilter);
          break;
        }

        // -----------------------------------------------------------------------
        // Users
        // -----------------------------------------------------------------------
        case 'cipp_list_users': {
          const { tenantFilter, searchField, searchValue } = args as {
            tenantFilter: string;
            searchField?: string;
            searchValue?: string;
          };
          result = await this.cippService.listUsers(tenantFilter, { searchField, searchValue });
          break;
        }

        case 'cipp_create_user': {
          const {
            tenantFilter,
            displayName,
            userPrincipalName,
            password,
            givenName,
            surname,
            jobTitle,
            department,
            usageLocation,
            country,
            mustChangePasswordNextSignIn,
          } = args as {
            tenantFilter: string;
            displayName: string;
            userPrincipalName: string;
            password?: string;
            givenName?: string;
            surname?: string;
            jobTitle?: string;
            department?: string;
            usageLocation?: string;
            country?: string;
            mustChangePasswordNextSignIn?: boolean;
          };
          const userData: Record<string, unknown> = {
            displayName,
            userPrincipalName,
          };
          if (password !== undefined) userData.password = password;
          if (givenName !== undefined) userData.givenName = givenName;
          if (surname !== undefined) userData.surname = surname;
          if (jobTitle !== undefined) userData.jobTitle = jobTitle;
          if (department !== undefined) userData.department = department;
          if (usageLocation !== undefined) userData.usageLocation = usageLocation;
          if (country !== undefined) userData.country = country;
          if (mustChangePasswordNextSignIn !== undefined) {
            userData.mustChangePasswordNextSignIn = mustChangePasswordNextSignIn;
          }
          result = await this.cippService.createUser(tenantFilter, userData);
          break;
        }

        case 'cipp_edit_user': {
          const {
            tenantFilter,
            userId,
            displayName,
            jobTitle,
            department,
            usageLocation,
          } = args as {
            tenantFilter: string;
            userId: string;
            displayName?: string;
            jobTitle?: string;
            department?: string;
            usageLocation?: string;
          };
          const editData: Record<string, unknown> = {};
          if (displayName !== undefined) editData.displayName = displayName;
          if (jobTitle !== undefined) editData.jobTitle = jobTitle;
          if (department !== undefined) editData.department = department;
          if (usageLocation !== undefined) editData.usageLocation = usageLocation;
          result = await this.cippService.editUser(tenantFilter, userId, editData);
          break;
        }

        case 'cipp_manage_user_licenses': {
          const { tenantFilter, userId, addLicenseSkuIds, removeLicenseSkuIds } = args as {
            tenantFilter: string;
            userId: string;
            addLicenseSkuIds?: string[];
            removeLicenseSkuIds?: string[];
          };
          result = await this.cippService.manageUserLicenses(tenantFilter, userId, {
            addLicenseSkuIds,
            removeLicenseSkuIds,
          });
          break;
        }

        case 'cipp_disable_user': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.disableUser(tenantFilter, userId);
          break;
        }

        case 'cipp_reset_password': {
          const { tenantFilter, userId, mustChangePasswordNextSignIn } = args as {
            tenantFilter: string;
            userId: string;
            mustChangePasswordNextSignIn?: boolean;
          };
          result = await this.cippService.resetPassword(
            tenantFilter,
            userId,
            mustChangePasswordNextSignIn
          );
          break;
        }

        case 'cipp_reset_mfa': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.resetMFA(tenantFilter, userId);
          break;
        }

        case 'cipp_revoke_sessions': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.revokeSessions(tenantFilter, userId);
          break;
        }

        case 'cipp_offboard_user': {
          // Offboarding actions are named exactly as CIPP reads them, so the
          // whole argument bag passes through untouched; the service selects
          // the keys it recognises and rejects an empty action set.
          const { tenantFilter, userId, ...offboardOptions } = args as {
            tenantFilter: string;
            userId: string;
          } & Record<string, unknown>;
          result = await this.cippService.offboardUser(tenantFilter, userId, offboardOptions);
          break;
        }

        case 'cipp_bec_check': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.becCheck(tenantFilter, userId);
          break;
        }

        case 'cipp_list_mfa_users': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listMfaUsers(tenantFilter);
          break;
        }

        case 'cipp_list_user_devices': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.listUserDevices(tenantFilter, userId);
          break;
        }

        case 'cipp_list_user_groups': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          result = await this.cippService.listUserGroups(tenantFilter, userId);
          break;
        }

        // -----------------------------------------------------------------------
        // Groups
        // -----------------------------------------------------------------------
        case 'cipp_list_groups': {
          const { tenantFilter, search } = args as { tenantFilter: string; search?: string };
          result = await this.cippService.listGroups(tenantFilter, { search });
          break;
        }

        case 'cipp_create_distribution_group': {
          const {
            tenantFilter,
            displayName,
            description,
            primaryEmailAddress,
            allowExternal,
            owners,
            members,
          } = args as {
            tenantFilter: string;
            displayName: string;
            description?: string;
            primaryEmailAddress: string;
            allowExternal?: boolean;
            owners?: string[];
            members?: string[];
          };
          const groupData: Record<string, unknown> = { displayName, primaryEmailAddress };
          if (description !== undefined) groupData.description = description;
          if (allowExternal !== undefined) groupData.allowExternal = allowExternal;
          if (owners !== undefined) groupData.owners = owners;
          if (members !== undefined) groupData.members = members;
          result = await this.cippService.createDistributionGroup(tenantFilter, groupData);
          break;
        }

        case 'cipp_modify_distribution_group_member': {
          const { tenantFilter, groupId, memberUserPrincipalName, action } = args as {
            tenantFilter: string;
            groupId: string;
            memberUserPrincipalName: string;
            action: 'add' | 'remove';
          };
          result = await this.cippService.modifyDistributionGroupMember(
            tenantFilter,
            groupId,
            memberUserPrincipalName,
            action
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Mailboxes
        // -----------------------------------------------------------------------
        case 'cipp_list_mailboxes': {
          const { tenantFilter, type } = args as { tenantFilter: string; type?: string };
          result = await this.cippService.listMailboxes(tenantFilter, { type });
          break;
        }

        case 'cipp_list_mailbox_permissions': {
          const { tenantFilter, upn } = args as { tenantFilter: string; upn: string };
          result = await this.cippService.listMailboxPermissions(tenantFilter, upn);
          break;
        }

        case 'cipp_set_out_of_office': {
          // The optional fields are named as the service expects, so they pass
          // through as-is. The cast reflects the declared schema; the service
          // validates `state` at runtime and rejects scheduled-only fields
          // supplied for any other state.
          const { tenantFilter, upn, ...oooData } = args as unknown as {
            tenantFilter: string;
            upn: string;
          } & OutOfOfficeInput;
          result = await this.cippService.setOutOfOffice(tenantFilter, upn, oooData);
          break;
        }

        case 'cipp_set_email_forwarding': {
          const { tenantFilter, upn, forwardTo, keepCopy } = args as {
            tenantFilter: string;
            upn: string;
            forwardTo?: string;
            keepCopy?: boolean;
          };
          const forwardData: Record<string, unknown> = {};
          if (forwardTo !== undefined) forwardData.forwardTo = forwardTo;
          if (keepCopy !== undefined) forwardData.keepCopy = keepCopy;
          result = await this.cippService.setEmailForwarding(tenantFilter, upn, forwardData);
          break;
        }

        // -----------------------------------------------------------------------
        // Security
        // -----------------------------------------------------------------------
        case 'cipp_list_conditional_access_policies': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listConditionalAccessPolicies(tenantFilter);
          break;
        }

        case 'cipp_list_named_locations': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listNamedLocations(tenantFilter);
          break;
        }

        // -----------------------------------------------------------------------
        // Applications
        // -----------------------------------------------------------------------
        case 'cipp_list_enterprise_apps': {
          const { tenantFilter, includeBuiltIn } = args as {
            tenantFilter: string;
            includeBuiltIn?: boolean;
          };
          result = await this.cippService.listEnterpriseApps(tenantFilter, { includeBuiltIn });
          break;
        }

        // -----------------------------------------------------------------------
        // Standards
        // -----------------------------------------------------------------------
        case 'cipp_list_standards': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listStandards(tenantFilter);
          break;
        }

        case 'cipp_run_standards_check': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.runStandardsCheck(tenantFilter);
          break;
        }

        case 'cipp_list_standard_templates': {
          result = await this.cippService.listStandardTemplates();
          break;
        }

        // `tenantFilter` is optional for these two tools: omit it to report
        // across all tenants. This diverges intentionally from other Standards
        // cases that require it.
        case 'cipp_get_tenant_drift': {
          const { tenantFilter } = args as { tenantFilter?: string };
          result = await this.cippService.getTenantDrift(tenantFilter);
          break;
        }

        case 'cipp_get_tenant_alignment': {
          const { tenantFilter } = args as { tenantFilter?: string };
          result = await this.cippService.getTenantAlignment(tenantFilter);
          break;
        }

        case 'cipp_create_standard_template': {
          const { template } = args as { template: Record<string, unknown> };
          result = await this.cippService.createStandardTemplate(template);
          break;
        }

        case 'cipp_delete_standard_template': {
          const { templateId } = args as { templateId: string };
          result = await this.cippService.deleteStandardTemplate(templateId);
          break;
        }

        case 'cipp_list_bpa': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listBPA(tenantFilter);
          break;
        }

        case 'cipp_list_domain_health': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listDomainHealth(tenantFilter);
          break;
        }

        // -----------------------------------------------------------------------
        // Licenses
        // -----------------------------------------------------------------------
        case 'cipp_list_licenses': {
          const { tenantFilter } = args as { tenantFilter: string };
          result = await this.cippService.listLicenses(tenantFilter);
          break;
        }

        case 'cipp_list_csp_licenses': {
          result = await this.cippService.listCSPLicenses();
          break;
        }

        // -----------------------------------------------------------------------
        // Alerts
        // -----------------------------------------------------------------------
        case 'cipp_list_audit_logs': {
          const { tenantFilter, days, type } = args as {
            tenantFilter: string;
            days?: number;
            type?: string;
          };
          result = await this.cippService.listAuditLogs(tenantFilter, {
            Days: days,
            Type: type,
          });
          break;
        }

        case 'cipp_list_alert_queue': {
          result = await this.cippService.listAlertQueue();
          break;
        }

        // -----------------------------------------------------------------------
        // GDAP
        // -----------------------------------------------------------------------
        case 'cipp_list_gdap_roles': {
          result = await this.cippService.listGDAPRoles();
          break;
        }

        case 'cipp_list_gdap_invites': {
          result = await this.cippService.listGDAPInvites();
          break;
        }

        // -----------------------------------------------------------------------
        // Scheduler
        // -----------------------------------------------------------------------
        case 'cipp_list_scheduled_items': {
          result = await this.cippService.listScheduledItems();
          break;
        }

        case 'cipp_add_scheduled_item': {
          const { taskName, command, scheduledTime, recurrence, tenantFilter, parameters } =
            args as {
              taskName: string;
              command: string;
              scheduledTime: string;
              recurrence?: string;
              tenantFilter?: string;
              parameters?: Record<string, unknown>;
            };
          result = await this.cippService.addScheduledItem({
            taskName,
            command,
            scheduledTime,
            ...(recurrence !== undefined && { recurrence }),
            ...(tenantFilter !== undefined && { tenantFilter }),
            ...(parameters !== undefined && { parameters }),
          });
          break;
        }

        // -----------------------------------------------------------------------
        // Core
        // -----------------------------------------------------------------------
        case 'cipp_ping': {
          result = await this.cippService.ping();
          break;
        }

        case 'cipp_get_version': {
          result = await this.cippService.getVersion();
          break;
        }

        case 'cipp_list_logs': {
          const { dateFilter } = args as { dateFilter?: string };
          result = await this.cippService.listLogs(
            dateFilter !== undefined ? { DateFilter: dateFilter } : undefined
          );
          break;
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool call failed: ${name}`, { error: message });
      throw new McpError(ErrorCode.InternalError, `Tool ${name} failed: ${message}`);
    }
  }
}
